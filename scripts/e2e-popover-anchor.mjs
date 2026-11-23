import { E2E_BASE_URL } from './e2e-base.mjs';
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
page.on('pageerror', (e) => jsErrors.push(e.message));

/** 读当前浮层与选区的间距 */
const readGap = async () =>
  page.evaluate(() => {
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    /*
     * ⚠️⚠️ **要用"最后一个 client rect"，不是并集 bbox**（审计修复后浮层改了锚点）。
     *
     * -> 浮层现在锚定在**用户最后选到的那一行** ✅
     * -> 而 \`getBoundingClientRect()\` 返回的是**并集**（多行时 bottom 差很多）❌
     * -> 缩放后选区变成多行 -> **并集的 bottom 远低于最后一行** ❌
     * -> 测出来"距离 42px" -> **误报** ❌
     *
     * -> 和浮层用**同一个锚点** -> 测出来才是真实间距 ✅
     */
    const rects = range ? [...range.getClientRects()] : [];
    let nb = null;
    for (let i = rects.length - 1; i >= 0; i -= 1) {
      const r = rects[i];
      if (r && r.width > 0 && r.height > 0) {
        nb = r;
        break;
      }
    }
    nb = nb ?? range?.getBoundingClientRect() ?? null;
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
      popBottom: +pr.bottom.toFixed(1),
      selTop: +nb.top.toFixed(1),
      /*
       * ⚠️ **浮层和选区的"距离"**（不管在上还是在下）。
       *
       * -> gap 为负 = 浮层在选区**上方**（空间不够时的正确行为）✅
       * -> 所以要取绝对值 -> 再看和选区的距离 ✅
       */
      distance: +Math.min(Math.abs(pr.top - nb.bottom), Math.abs(pr.bottom - nb.top)).toFixed(1),
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
      '浮层锚定在选区上（下方或上方都行，但不能脱离选区）',
      base.distance !== null && base.distance < 20,
      `距离 ${base.distance}px`,
    );
  }

  // ---- 2. 缩放后浮层仍锚定 ----
  /*
   * ⚠️ **不能假设浮层永远在下方**。
   *
   * 选区靠近视口底部时下方放不下 → 浮层会**翻到上方**（这是正确行为）。
   * → 断言"间距与缩放前**一致**"（而不是"间距 = 8"）。
   */
  await page.locator('button[aria-label="放大"]').click();
  await page.waitForTimeout(2500);
  const zoomed = await readGap();
  /*
   * ⚠️ **不能要求"间距和缩放前完全一致"**（实测踩过的坑）。
   *
   * -> 浮层在选区**下方**放不下时 -> 会**翻到上方**（这是正确行为）✅
   * -> 缩放后选区的位置变了 -> 可能从"下方"变成"上方" ❌
   *   -> 这时 gap 从 8px 变成 -126px -> 但**浮层还是贴着选区** ✅
   * -> 所以断言应该是：**浮层和选区的距离很小**（不是 gap 相等）✅
   */
  check(
    '**缩放后浮层仍锚定在选区上**',
    zoomed.distance !== null && zoomed.distance < 20,
    `距离 ${base?.distance}px → ${zoomed.distance}px（gap ${base?.gap} → ${zoomed.gap}）`,
  );

  // 选区本身必须**活下来**（缩放会重建文本层 → 浏览器会丢掉选区）
  const afterZoomSel = await page.evaluate(() => ({
    len: window.getSelection()?.toString().length ?? 0,
    pop: !!document.querySelector('.scpdf-selection-popover'),
  }));
  check('**缩放后选区仍然存在**（不被缩放清空）', afterZoomSel.len > 0, `${afterZoomSel.len} 字符`);
  check('缩放后浮层仍然打开', afterZoomSel.pop);

  await page.locator('button[aria-label="缩小"]').click();
  await page.waitForTimeout(2500);
  const shrunk = await readGap();
  check(
    '**缩小后浮层仍锚定在选区上**',
    shrunk.gap !== null && Math.abs(shrunk.gap - (base.gap ?? 8)) < 14,
    `间距 ${base?.gap}px → ${shrunk.gap}px`,
  );

  // ---- 2b. 缩放后**重新框选**（浮层必须能重新打开）----
  /*
   * ⚠️ 曾经的 bug：浮层的 `mousedown` 处理器在"点浮层外面"时直接 `onClose()`
   *    → 重新框选的 mousedown 也落在外面 → 浮层被关
   *    → 之后新的选区虽然建立了，但**浮层再也不出现**。
   */
  await selectBody();
  await page.waitForTimeout(400);
  const reselected = await readGap();
  check(
    '**缩放后重新框选 → 浮层能重新打开**',
    reselected.popExists && reselected.gap !== null,
    `间距 ${reselected.gap}px`,
  );

  // ---- 3. 滚动时浮层跟随（不消失） ----
  const beforeScroll = await readGap();
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop += 100;
  });
  await page.waitForTimeout(400);
  const afterScroll = await readGap();
  /*
   * ⚠️ **间距可以变化**（浮层会在"放得下"的方向定位）。
   *   滚动后选区上移 → 下方放得下 → 浮层从上方翻到下方 → 间距从负变正。
   *
   * → 断言的核心是：**浮层还在** + **它贴着选区**（间距是合理的值）。
   */
  const gapAfter = afterScroll.gap;
  check(
    '**滚动时浮层跟随**（不消失、不跑偏）',
    afterScroll.popExists && gapAfter !== null && Math.abs(gapAfter) < 200,
    `间距 ${beforeScroll.gap}px → ${gapAfter}px，浮层${afterScroll.popExists ? '在' : '消失'}`,
  );

  // 滚回
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop = 0;
  });
  await page.waitForTimeout(400);

  // ---- 4. 拖动中浮层就出现 ----
  /*
   * ⚠️ 必须**先清掉之前的选区** ——
   *    否则 `window.getSelection()` 里还是上一次的选区，
   *    会掩盖"拖动中选区是否更新"的判断。
   */
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
  });
  await page.waitForTimeout(200);

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
    await page.waitForTimeout(300);

    const during = await page.evaluate(() => ({
      popover: !!document.querySelector('.scpdf-selection-popover'),
      rects: document.querySelectorAll('.scpdf-selection-layer clipPath rect').length,
      selected: window.getSelection()?.toString().length ?? 0,
    }));
    await page.mouse.up();

    check('**拖动中浮层已出现**（不用等松手）', during.popover, `已选 ${during.selected} 字符`);
    check(
      '**拖动中选区块已出现**',
      during.rects > 0 && during.selected > 0,
      `${during.rects} 个 / ${during.selected} 字符`,
    );
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
