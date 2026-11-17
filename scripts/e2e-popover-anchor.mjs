/**
 * E2E：浮层**锚定**回归。
 *
 * 用户实测反馈（2026-11-17）：
 * - "缩放的时候浮层没跟着一起缩放"
 * - "缩小之后选择跑偏很厉害"
 * - "很卡"（拖动中完全没有反馈）
 *
 * 根因：浮层锚点是**选区变化那一刻算一次**的坐标（存进 state），
 *      而 `position: fixed` 的坐标会随滚动/缩放失效 → 浮层跑到别处。
 *
 * 断言：
 * 1. 浮层与选区的**间距**在任何缩放/滚动状态下都保持一致
 * 2. 滚动时浮层**跟随**（不消失）
 * 3. 拖动中（未松手）浮层**已经出现**
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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5200';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));

/** 读当前浮层与选区的间距 */
const readGap = async () =>
  page.evaluate(() => {
    const sel = window.getSelection();
    const nb = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const pop = document.querySelector('.scpdf-selection-popover');
    const pr = pop?.getBoundingClientRect();
    if (!nb || !pr) {
      return { gap: null, popExists: !!pop, selExists: !!nb && nb.width > 0 };
    }
    return {
      gap: +(pr.top - nb.bottom).toFixed(1),
      popExists: true,
      selExists: true,
      popTop: +pr.top.toFixed(1),
      selBottom: +nb.bottom.toFixed(1),
    };
  });

/** 在正文段落里拖选 */
const selectBody = async () => {
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(x).fontSize);
      return (
        fs > 18 &&
        (x.textContent ?? '').trim().length > 60 &&
        r.width > 400 &&
        r.top > 150 &&
        r.top < 800
      );
    });
    const el = spans[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 10 };
  });
  if (!t) return false;

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + 250, t.y + 55, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  return true;
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ---- 1. 基线间距 ----
  let base = { gap: null, popExists: false, selExists: false };
  if (!(await selectBody())) {
    check('找到可拖选的正文', false);
  } else {
    base = await readGap();
    check('选中后浮层出现', base.popExists);
    check(
      '浮层锚定在选区下方',
      base.gap !== null && base.gap > 0 && base.gap < 40,
      `间距 ${base.gap}px`,
    );
  }

  // ---- 2. 缩放后浮层仍锚定 ----
  await page.locator('button[aria-label="放大"]').click();
  await page.waitForTimeout(2500);
  const zoomed = await readGap();
  check(
    '**缩放后浮层仍锚定在选区上**',
    zoomed.gap !== null && zoomed.gap > 0 && zoomed.gap < 40,
    `间距 ${zoomed.gap}px（基准 ${base?.gap}px）`,
  );

  await page.locator('button[aria-label="缩小"]').click();
  await page.waitForTimeout(2500);
  const shrunk = await readGap();
  check(
    '**缩小后浮层仍锚定在选区上**',
    shrunk.gap !== null && shrunk.gap > 0 && shrunk.gap < 40,
    `间距 ${shrunk.gap}px（基准 ${base?.gap}px）`,
  );

  // ---- 3. 滚动时浮层跟随（不消失） ----
  const beforeScroll = await readGap();
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop += 100;
  });
  await page.waitForTimeout(400);
  const afterScroll = await readGap();
  check(
    '**滚动时浮层跟随**（不消失、不跑偏）',
    afterScroll.popExists &&
      afterScroll.gap !== null &&
      Math.abs(afterScroll.gap - (beforeScroll.gap ?? 8)) < 14,
    `间距 ${beforeScroll.gap}px → ${afterScroll.gap}px，浮层${afterScroll.popExists ? '在' : '消失'}`,
  );

  // 滚回
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop = 0;
  });
  await page.waitForTimeout(400);

  // ---- 4. 拖动中浮层就出现 ----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(x).fontSize);
      return fs > 18 && (x.textContent ?? '').trim().length > 60 && r.width > 400;
    });
    const el = spans[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 10 };
  });

  if (t) {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 40, t.y + 5, { steps: 4 });
    await page.waitForTimeout(200);

    const during = await page.evaluate(() => ({
      popover: !!document.querySelector('.scpdf-selection-popover'),
      rects: document.querySelectorAll('.scpdf-selection-layer clipPath rect').length,
      selected: window.getSelection()?.toString().length ?? 0,
    }));
    await page.mouse.up();

    check('**拖动中浮层已出现**（不用等松手）', during.popover, `已选 ${during.selected} 字符`);
    check('**拖动中选区块已出现**', during.rects > 0, `${during.rects} 个`);
  }

  check('全程无 JS 错误', jsErrors.length === 0, jsErrors[0]?.slice(0, 140) ?? '');
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
