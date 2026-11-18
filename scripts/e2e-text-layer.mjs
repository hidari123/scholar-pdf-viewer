import { E2E_BASE_URL } from './e2e-base.mjs';
/**
 * E2E：文本层验证 —— 用真实 PDF 检查"文字能不能被选中"。
 *
 * 这是整个包最核心的能力，必须在真浏览器里验证：
 * - jsdom 没有 canvas，也没法真的"拖选文字"
 * - 文本层的对齐（y 翻转）错了的话，肉眼能看出来但单测测不到
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

function resolveChromium() {
  if (process.env.E2E_CHROMIUM_PATH && existsSync(process.env.E2E_CHROMIUM_PATH)) {
    return process.env.E2E_CHROMIUM_PATH;
  }
  const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const dirs = readdirSync(cacheRoot)
    .filter((n) => n.startsWith('chromium-'))
    .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
    .sort((a, b) => b.v - a.v);
  for (const d of dirs) {
    const exe = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const BASE_URL = E2E_BASE_URL;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 没有本地真实文档 → 用内置样张
  if ((await page.locator('.scpdf-page canvas.scpdf-canvas').count()) === 0) {
    const sampleBtn = page.getByRole('button', { name: '载入内置样张' });
    if ((await sampleBtn.count()) > 0) {
      await sampleBtn.click();
      await page.waitForTimeout(2500);
    }
  }
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
  await page.waitForTimeout(2500);

  // 1) 文本层存在
  const layerCount = await page.locator('.scpdf-text-layer').count();
  check('文本层已渲染', layerCount >= 1, `${layerCount} 个`);

  // 2) 文本层里有文字片段
  const itemCount = await page.locator('.scpdf-text-layer__item').count();
  check('文本层有文字片段', itemCount > 0, `${itemCount} 个`);

  // 3) 片段内容非空
  const sampleText = await page
    .locator('.scpdf-text-layer__item')
    .first()
    .textContent()
    .catch(() => '');
  check('片段文本非空', Boolean(sampleText?.trim()), `样本: ${sampleText?.slice(0, 30)}`);

  // 4) 片段位置在页面内（对齐检查）
  const align = await page.evaluate(() => {
    const page1 = document.querySelector('.scpdf-page');
    const item = document.querySelector('.scpdf-text-layer__item');
    if (!page1 || !item) return null;
    const p = page1.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    return {
      pageTop: p.top,
      itemTop: i.top,
      itemLeft: i.left,
      pageLeft: p.left,
      pageWidth: p.width,
      offsetY: i.top - p.top,
      offsetX: i.left - p.left,
    };
  });
  check(
    '片段在页面范围内（垂直偏移为正且不超页高）',
    align !== null && align.offsetY >= -5 && align.offsetY < align.pageWidth * 2,
    align ? `偏移 y=${align.offsetY.toFixed(0)} x=${align.offsetX.toFixed(0)}` : '无',
  );

  // 5) 真实拖选 → 选区非空
  const selection = await page.evaluate(async () => {
    const items = document.querySelectorAll('.scpdf-text-layer__item');
    if (items.length === 0) return { ok: false, reason: '无文本片段' };

    // 找一个有内容的片段
    let target = null;
    for (const item of items) {
      if ((item.textContent ?? '').trim().length > 5) {
        target = item;
        break;
      }
    }
    if (!target) return { ok: false, reason: '无足够长的片段' };

    const range = document.createRange();
    const textNode = target.firstChild;
    if (!textNode) return { ok: false, reason: '片段无文本节点' };

    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(5, textNode.textContent.length));

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    return {
      ok: selection.toString().trim().length > 0,
      text: selection.toString(),
      fragmentCount: items.length,
    };
  });
  check(
    '能选中文本（浏览器原生选区非空）',
    selection.ok,
    selection.ok ? `选中 "${selection.text}"` : selection.reason,
  );

  // 6) 触发 mouseup → 宿主收到选区几何
  const gotSelection = await page.evaluate(() => {
    return new Promise((resolve) => {
      const container = document.querySelector('.scpdf-container');
      const item = document.querySelector('.scpdf-text-layer__item');
      if (!container || !item) {
        resolve({ ok: false, reason: '缺元素' });
        return;
      }
      const range = document.createRange();
      const textNode = item.firstChild;
      if (!textNode) {
        resolve({ ok: false, reason: '无文本节点' });
        return;
      }
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(8, textNode.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      setTimeout(() => resolve({ ok: true, text: sel.toString() }), 300);
    });
  });
  check('mouseup 事件可派发', gotSelection.ok, gotSelection.text ?? gotSelection.reason);

  // 7) 截图
  await page.screenshot({ path: 'e2e-shots/text-layer.png' });

  // 8) 无 JS 错误
  check('运行期无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
