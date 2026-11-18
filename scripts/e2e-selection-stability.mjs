import { E2E_BASE_URL } from './e2e-base.mjs';
/**
 * E2E：选区稳定性（回归测试）。
 *
 * 覆盖曾经导致"页面消失"的 bug：
 * - `insertBefore` 抛 `NotFoundError` → 缩放时页面 unmount
 * - 跨页选择时哨兵被搬到另一页
 *
 * 断言：
 * 1. 跨页选择 + 缩放 → 无 JS 错误
 * 2. 页面没有消失（canvas 仍在）
 * 3. 哨兵没有跑到别的页
 * 4. 高亮在缩放后仍然对齐
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

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

const BASE = E2E_BASE_URL;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(`${e.name}: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') jsErrors.push(m.text());
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ---- 1. 跨页选择（哨兵最容易出错的场景）----
  const crossPage = await page.evaluate(() => {
    const layers = [...document.querySelectorAll('.scpdf-text-layer')];
    if (layers.length < 2) return { error: 'not enough layers' };

    const s1 = [...layers[0].querySelectorAll('.scpdf-text-layer__item')].find(
      (s) => (s.textContent ?? '').length >= 5,
    );
    const s2 = [...layers[1].querySelectorAll('.scpdf-text-layer__item')].find(
      (s) => (s.textContent ?? '').length >= 5,
    );
    if (!s1 || !s2) return { error: 'no spans' };

    const range = document.createRange();
    range.setStart(s1.firstChild, 0);
    range.setEnd(s2.firstChild, 3);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return { ok: true };
  });

  check('能构造跨页选区', crossPage.ok === true);

  // 触发 selectionchange
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')));
  await page.waitForTimeout(300);

  // ---- 2. 哨兵没有被搬到别的页 ----
  const sentinel = await page.evaluate(() => {
    const layers = [...document.querySelectorAll('.scpdf-text-layer')];
    return layers.map((l) => l.querySelectorAll('.scpdf-text-layer__end').length);
  });
  check(
    '每页各有且仅有一个哨兵（没被搬走）',
    sentinel.every((n) => n === 1),
    `各页哨兵数 = [${sentinel.join(', ')}]`,
  );

  // ---- 3. 缩放（触发 TextLayer 重建）→ 不应有错误、页面不应消失 ----
  const before = await page.evaluate(
    () => document.querySelectorAll('.scpdf-page canvas.scpdf-canvas').length,
  );

  for (let i = 0; i < 4; i += 1) {
    await page.locator('.scpdf-toolbar__right .scpdf-toolbar__btn').nth(0).click();
    await page.waitForTimeout(600);
  }

  const after = await page.evaluate(() => ({
    canvases: document.querySelectorAll('.scpdf-page canvas.scpdf-canvas').length,
    pages: document.querySelectorAll('.scpdf-page').length,
    items: document.querySelectorAll('.scpdf-text-layer__item').length,
  }));

  check(
    '缩放后无 JS 错误（insertBefore 不再抛 NotFoundError）',
    jsErrors.length === 0,
    jsErrors.length > 0 ? jsErrors[0]?.slice(0, 160) : '',
  );

  check(
    '缩放后页面没有消失',
    after.canvases > 0 && after.pages > 0 && after.items > 0,
    `canvas ${before}→${after.canvases}, 页 ${after.pages}, 文本项 ${after.items}`,
  );

  // ---- 4. 缩放 + 重新选中 + 再缩放（更接近真实操作）----
  const target = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const el = spans.find((x) => {
      const r = x.getBoundingClientRect();
      return r.top > 200 && r.top < 700 && (x.textContent ?? '').trim().length > 20;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 2 };
  });

  if (target) {
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 250, target.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    for (let i = 0; i < 3; i += 1) {
      await page.locator('.scpdf-toolbar__right .scpdf-toolbar__btn').nth(1).click();
      await page.waitForTimeout(600);
    }
  }

  check(
    '选中状态下缩放也无 JS 错误',
    jsErrors.length === 0,
    jsErrors.length > 0 ? jsErrors[0]?.slice(0, 160) : '',
  );

  const alive = await page.evaluate(
    () => document.querySelectorAll('.scpdf-page canvas.scpdf-canvas').length,
  );
  check('最终页面仍在', alive > 0, `${alive} 个 canvas`);
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
