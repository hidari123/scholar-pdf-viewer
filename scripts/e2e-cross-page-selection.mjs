/**
 * E2E：**跨页选择**。
 *
 * 用户反馈："现在不能跨页选择 我需要有跨页选择的功能"
 *
 * ## 实测（修复前）
 *
 * ```
 * 选中文本长度: 2553   ← 浏览器选中了跨页的文字
 * 选区层数: 0          ← 但自绘层是空的（用户看不到高亮）
 * ```
 *
 * ## 根因
 *
 * 跨页选区的 `range.commonAncestorContainer` 是 **`.scpdf-pages`**（页容器），
 * 既不是 `.scpdf-page` 也不是 `.scpdf-text-layer`
 * → 旧逻辑 `if (!inTextLayer && !inPage) return false;` → **整个选区被丢弃**。
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

  // 滚到"第 1 页底部 + 第 2 页顶部"都可见的位置 → 两页的文本层都已渲染
  const target = await page.evaluate(() => {
    const container = document.querySelector('.scpdf-container');
    const pages = [...document.querySelectorAll('.scpdf-page')];
    const p2 = pages[1].getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    container.scrollTop = p2.top - cr.top - 300;
    return 1;
  });
  if (target !== 1) throw new Error('滚动失败');
  await page.waitForTimeout(2500);

  const t = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.scpdf-page')];
    const p2 = pages[1].getBoundingClientRect();
    const all1 = [...pages[0].querySelectorAll('.scpdf-text-layer__item')]
      .map((x) => ({ r: x.getBoundingClientRect() }))
      .filter((o) => o.r.width > 80 && o.r.height > 8 && o.r.bottom < p2.top)
      .sort((a, b) => b.r.top - a.r.top);
    const all2 = [...pages[1].querySelectorAll('.scpdf-text-layer__item')]
      .map((x) => ({ r: x.getBoundingClientRect() }))
      .filter((o) => o.r.width > 80 && o.r.height > 8)
      .sort((a, b) => a.r.top - b.r.top);
    if (!all1.length || !all2.length) return null;
    const a = all1[0].r;
    const b = all2[0].r;
    return {
      from: { x: a.left + 10, y: a.top + a.height / 2 },
      to: { x: b.left + 30, y: b.top + b.height / 2 },
    };
  });

  if (!t) {
    check('找到跨页的起止位置', false);
  } else {
    await page.mouse.move(t.from.x, t.from.y);
    await page.mouse.down();
    await page.mouse.move(t.to.x, t.to.y, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(900);

    const r = await page.evaluate(() => {
      const sel = window.getSelection();
      const perPage = [...document.querySelectorAll('.scpdf-page')].map((p, i) => ({
        page: i + 1,
        n: p.querySelectorAll('.scpdf-selection-layer rect').length,
      }));
      return {
        textLen: sel?.toString().length ?? 0,
        perPage: perPage.filter((p) => p.n > 0),
        layers: document.querySelectorAll('.scpdf-selection-layer').length,
      };
    });

    console.log(
      `  选中 ${r.textLen} 字；${r.perPage.map((p) => `第 ${p.page} 页 ${p.n} 个矩形`).join('，')}`,
    );

    check('浏览器选中了文字', r.textLen > 10, `${r.textLen} 字`);
    check('**自绘选区层不是空的**（跨页不再被丢弃）', r.layers > 0, `${r.layers} 层`);
    check('**第 1 页有选区块**', (r.perPage.find((p) => p.page === 1)?.n ?? 0) > 0);
    check('**第 2 页也有选区块**（真的跨页了）', (r.perPage.find((p) => p.page === 2)?.n ?? 0) > 0);
    check('**涉及 2 页**', r.perPage.length === 2, `${r.perPage.length} 页`);
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
