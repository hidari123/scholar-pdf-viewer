/**
 * E2E：**切换文档时高亮 / 选区要重置**。
 *
 * 用户反馈："如果已经高亮或者选中了文字 切换文档的时候还是会展示在文档上
 *              →切换文档时高亮要重置"
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { E2E_BASE_URL } from './e2e-base.mjs';

function resolveChromium() {
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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

/** 读当前状态 */
const state = () =>
  page.evaluate(() => ({
    nativeSel: window.getSelection()?.toString().length ?? 0,
    selectionLayer: document.querySelectorAll('.scpdf-selection-layer').length,
    popover: document.querySelectorAll('.scpdf-selection-popover').length,
    annotations: document.querySelectorAll('.scpdf-annotation').length,
    pages: document.querySelectorAll('.scpdf-page').length,
  }));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1500);

  // ---- 1. 选中 + 高亮 ----
  const t = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.scpdf-text-layer__item')].find((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return fs > 10 && (x.textContent ?? '').trim().length > 20 && r.width > 150 && r.top > 150;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.min(r.left + 12, r.right - 20), y: r.top + r.height * 0.3, w: r.width };
  });
  if (!t) throw new Error('没找到正文');

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + Math.max(30, Math.min(180, t.w - 24)), t.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(800);

  const before = await state();
  check('切文档前：有高亮', before.annotations === 1, `${before.annotations} 个`);

  // ---- 2. 切换文档 ----
  const sampleBtn = page.getByRole('button', { name: '载入内置样张' });
  if ((await sampleBtn.count()) === 0) {
    throw new Error('没有"载入内置样张"按钮');
  }
  await sampleBtn.click();
  await page.waitForTimeout(4000);

  const after = await state();
  check(
    '切换文档后：页数变了（确实换了文档）',
    after.pages !== before.pages,
    `${before.pages} → ${after.pages}`,
  );
  check('**切换文档后：选区块已清除**', after.selectionLayer === 0, `${after.selectionLayer} 个`);
  check('**切换文档后：原生选区已清除**', after.nativeSel === 0, `${after.nativeSel} 字符`);
  check('**切换文档后：浮层已关闭**', after.popover === 0, `${after.popover} 个`);
  check(
    '**切换文档后：高亮已重置**（按文档隔离）',
    after.annotations === 0,
    `${after.annotations} 个`,
  );

  // ---- 3. 切回原文档 → 高亮还在（按文档隔离，不是清空）----
  const localBtn = page.getByRole('button', { name: '载入本地真实文档' });
  if ((await localBtn.count()) > 0) {
    await localBtn.click();
    await page.waitForTimeout(4000);
    const back = await state();
    check('切回原文档：高亮还在（按文档隔离）', back.annotations === 1, `${back.annotations} 个`);
  }

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
