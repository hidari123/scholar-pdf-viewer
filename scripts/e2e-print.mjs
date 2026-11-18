/**
 * E2E：**打印效果**。
 *
 * 用户反馈："当前打印出来的展示的页面效果不对"
 *
 * ## 实测（修复前）
 *
 * ```
 * 打印态: {
 *   toolbarVisible: true,       ← ❌ 工具栏会被打印出来
 *   containerOverflow: "auto",  ← ❌ 打印时仍是滚动容器
 *   containerHeight: "811px",   ← ❌ 只有一屏高
 *   pagesHeight: "33093px",     ← 18 页全在里面，但被裁掉
 * }
 * ```
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

  // ---- 先加一条高亮（验证"打印保留高亮"）----
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
  if (t) {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + Math.max(30, Math.min(180, t.w - 24)), t.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    // 先加高亮（会清掉选区）
    await page.locator('[aria-label="添加高亮"]').click();
    await page.waitForTimeout(800);

    /*
     * ⚠️ **再选一次** → 让选区层 / 浮层**存在**
     * → 才能验证"打印时它们被隐藏"。
     */
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + Math.max(30, Math.min(180, t.w - 24)), t.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }

  // ---- 切到 print 媒体 ----
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(600);

  const printState = await page.evaluate(() => {
    /*
     * ⚠️ **元素可能不存在**（比如没有选区时就没有选区层）。
     * → 不存在时返回 `null`（"不适用"），**不是** `false`。
     */
    const hidden = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return getComputedStyle(el).display === 'none';
    };
    const container = document.querySelector('.scpdf-container');
    const pages = document.querySelector('.scpdf-pages');
    const page1 = document.querySelector('.scpdf-page');
    const cs = container ? getComputedStyle(container) : null;

    return {
      toolbarHidden: hidden('.scpdf-toolbar'),
      textLayerHidden: hidden('.scpdf-text-layer'),
      selectionLayerHidden: hidden('.scpdf-selection-layer'),
      annotationHidden: hidden('.scpdf-annotations'),
      popoverHidden: hidden('.scpdf-selection-popover'),
      containerOverflow: cs?.overflow,
      /*
       * ⚠️ **高度不能断言成 `auto`**。
       *
       * 容器摊平后 `height: auto` → **按内容算** → 就是所有页的总高
       * （实测 33093px = 18 页）。
       * → 关键不是"高度是多少"，而是"**没有上限**"（不再是 811px 的一屏）。
       */
      containerHeight: cs?.height,
      containerMaxHeight: cs?.maxHeight,
      pagesHeight: pages ? getComputedStyle(pages).height : null,
      pageCount: document.querySelectorAll('.scpdf-page').length,
      firstPageBreakAfter: page1 ? getComputedStyle(page1).breakAfter : null,
      firstPageShadow: page1 ? getComputedStyle(page1).boxShadow : null,
      /*
       * ⚠️ **页必须是"静态流"**（不是绝对定位）。
       *
       * 屏幕上页是 `position: absolute` + 内联 `top`（用于虚拟滚动的定位）
       * → 打印时如果**不改**：
       *   1. 18 个绝对定位的页 → 浏览器按绝对位置分页 → **重叠 / 空白页**
       *   2. 绝对定位的页**不撑开父元素** → 打印流里只剩第一页的位置 → **后面的页全丢**
       *
       * → 打印 CSS 必须 `position: static`（实测修好后：rectTop 8 / 1842 / 3675 顺序排列）。
       */
      firstPagePosition: page1 ? getComputedStyle(page1).position : null,
      /** 几页的 top 是递增的（= 在正常流里，没有重叠） */
      pageTops: [...document.querySelectorAll('.scpdf-page')]
        .slice(0, 5)
        .map((p) => Math.round(p.getBoundingClientRect().top)),
      annotationVisible: (() => {
        const a = document.querySelector('.scpdf-annotation');
        if (!a) return null;
        const cs2 = getComputedStyle(a);
        return {
          display: cs2.display,
          colorAdjust: cs2.printColorAdjust || cs2.webkitPrintColorAdjust,
        };
      })(),
    };
  });

  console.log(`  打印态: ${JSON.stringify(printState, null, 1).slice(0, 900)}`);

  check('**打印时工具栏隐藏**', printState.toolbarHidden === true);
  check('**打印时文本层隐藏**（避免幽灵文字）', printState.textLayerHidden === true);
  check(
    '打印时选区层隐藏（没选区时元素不存在 → 不适用）',
    printState.selectionLayerHidden === null || printState.selectionLayerHidden === true,
    String(printState.selectionLayerHidden),
  );
  check(
    '打印时浮层隐藏（没选区时元素不存在 → 不适用）',
    printState.popoverHidden === null || printState.popoverHidden === true,
    String(printState.popoverHidden),
  );
  check(
    '**打印时容器摊平**（overflow: visible）',
    printState.containerOverflow === 'visible',
    printState.containerOverflow,
  );
  /*
   * ⚠️ **"没有高度上限"** 才是关键。
   *
   * 屏幕上是 `height: 811px`（一屏）→ 18 页只印出第一屏。
   * 摊平后 `height: auto` → 按内容算 → 33093px（18 页全在）。
   * → 断言"高度 > 一屏"（而不是"等于 auto"）。
   */
  check(
    '**打印时容器不再限制高度**（18 页全在，不是只有一屏）',
    Number.parseFloat(printState.containerHeight ?? '0') > 2000,
    printState.containerHeight,
  );
  check(
    '**打印时每页都换页**（break-after: page）',
    printState.firstPageBreakAfter === 'page',
    printState.firstPageBreakAfter,
  );
  /*
   * ⚠️ **页必须在正常流里**（`position: static`）—— 否则打印出来是重叠 / 空白页。
   */
  check(
    '**打印时页是静态流**（不是绝对定位 → 不会重叠 / 丢页）',
    printState.firstPagePosition === 'static',
    printState.firstPagePosition,
  );
  check(
    '**打印时各页依次排列**（top 递增 → 没有重叠）',
    Array.isArray(printState.pageTops) &&
      printState.pageTops.every((top, i) => i === 0 || top > (printState.pageTops[i - 1] ?? 0)),
    JSON.stringify(printState.pageTops),
  );
  check(
    '打印时页阴影去掉（省墨）',
    printState.firstPageShadow === 'none',
    printState.firstPageShadow,
  );
  check(
    '**打印时高亮保留**（用户要求）',
    printState.annotationVisible?.display !== 'none',
    `display = ${printState.annotationVisible?.display}`,
  );
  check(
    '打印时高亮用 print-color-adjust: exact（否则省墨印不出来）',
    printState.annotationVisible?.colorAdjust === 'exact',
    printState.annotationVisible?.colorAdjust,
  );

  // ---- "只打印原 PDF"模式 ----
  const originalMode = await page.evaluate(() => {
    // 模拟 printMode="original"：给根节点加类
    const root = document.querySelector('.scpdf-root');
    if (!root) return null;
    root.classList.add('scpdf-root--print-original');
    const a = document.querySelector('.scpdf-annotation');
    return a ? getComputedStyle(a).display : null;
  });
  check('**"只打印原 PDF"模式：高亮被隐藏**', originalMode === 'none', `display = ${originalMode}`);

  await page.emulateMedia({ media: null });
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
