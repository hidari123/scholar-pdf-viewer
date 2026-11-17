/**
 * E2E：选区**跨行拖选**（用户实测报 bug 的场景）。
 *
 * 断言：
 * 1. 跨行拖选 → **自绘层有矩形**（不是空）
 *    （曾经的 bug：commonAncestorContainer 是 .scpdf-page → 直接放弃 → 自绘层空
 *      → 用户看到的是浏览器原生选区 = 那个"一大块"）
 * 2. 自绘矩形**贴合文字**（高度 = 文字高度，不是行盒高度）
 * 3. 每行独立成矩形（不是一个大长方形）
 * 4. 缩放后仍然有矩形 + 仍然贴合（基线表不能停留在旧缩放级别）
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

/** 选一段（跨行）并返回自绘层的统计 */
const selectAcross = async () => {
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(x).fontSize);
      return (
        r.top > 150 &&
        r.top < 800 &&
        (x.textContent ?? '').trim().length > 40 &&
        r.width > 200 &&
        fs >= 10
      );
    });
    if (!spans.length) return null;
    const el = spans[0];
    const r = el.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8, txt: (el.textContent ?? '').slice(0, 20) };
  });
  if (!t) return null;

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  // 往下拖 ~80px（跨 2-3 行）
  await page.mouse.move(t.x + 200, t.y + 80, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  return page.evaluate(() => {
    const svg = document.querySelector('.scpdf-selection-layer');
    if (!svg) return { layerMissing: true };

    const pageEl = svg.closest('.scpdf-page');
    const pr = pageEl.getBoundingClientRect();
    const rects = [...svg.querySelectorAll('clipPath rect')].map((r) => ({
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    }));

    const spans = [...pageEl.querySelectorAll('.scpdf-text-layer__item')].map((s) => {
      const r = s.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(s).fontSize);
      return {
        top: r.top - pr.top,
        left: r.left - pr.left,
        width: r.width,
        height: r.height,
        fontSize: fs,
        // 基线 = top + ascent（ascent ≈ 0.8 × fontSize）
        baseline: r.top - pr.top + fs * 0.8,
      };
    });

    /*
     * 只看**正文**（字号 ≥ 14px）。
     *
     * ⚠️ 插图里的**旋转标签**（REASONING / turns / 0.012-0.09…）
     *    几何天然特殊（旋转 45°/90°）→ 没法用水平文字的基线去对齐。
     *    它们不在"跟文字对齐"的验收范围内。
     */
    const bodySpans = spans.filter((s) => s.fontSize >= 14);

    /*
     * 每个自绘矩形跟**它覆盖的那些 span 的并集**比。
     *
     * ⚠️ **不能只跟单个 span 比**：
     *    一行里可能有正文（font-size 20.6）+ 上标（font-size 16），
     *    选区矩形横跨两者 → 正确的框是**并集**
     *    （上边缘取上标的，下边缘取正文的）→ 跟任何单个 span 比都会有偏差。
     *
     *    之前的错误做法：
     *    - 只按基线匹配   → 选到上标 → 偏差 5px（假失败）
     *    - 只按水平重叠匹配 → 选到上标 → 同样的假失败
     */
    let worstTop = 0;
    let heightRatio = 0;
    let worstInfo = null;
    for (const c of rects) {
      /*
       * 矩形覆盖的 span（水平有重叠）。
       *
       * ⚠️ **还要限定在同一视觉行**：
       *    一个宽矩形（比如横跨整段的标题）会水平重叠到**很多行**的 span
       *    → 并集变成"整页" → 比对毫无意义。
       *    → 只取**顶部与矩形接近**的那些（容差 = 行高）。
       */
      const near = bodySpans.filter((s) => Math.abs(s.top - c.y) <= s.height * 0.8);
      if (near.length === 0) continue;
      const overlapping = near.filter(
        (s) => Math.min(c.x + c.w, s.left + s.width) - Math.max(c.x, s.left) > 0,
      );
      if (overlapping.length === 0) continue;

      /*
       * 只保留**跟矩形中心同一行**的那些：
       * 取重叠 span 的**中位 top** 作参考，超出 ±半个行高的都丢掉。
       *
       * ⚠️ 不这样收窄 → 一个宽矩形会同时吃到上下两行 → 并集跨行 → 假失败。
       */
      /*
       * ⚠️ **锚点要用"顶部最接近矩形 top 的那个"**，不能用中位数。
       *
       *    中位数的问题（偶数个元素时取上界）：
       *    overlapping = [top:1039, top:1057.8] → 中位数 = 1057.8
       *    → 再按中位数筛选 → **1039 那个（正确的）被丢掉** ❌
       */
      let anchor = overlapping[0];
      for (const s of overlapping) {
        if (Math.abs(s.top - c.y) < Math.abs(anchor.top - c.y)) anchor = s;
      }
      const maxHeight = Math.max(...overlapping.map((s) => s.height));
      const covered = overlapping.filter((s) => Math.abs(s.top - anchor.top) <= maxHeight * 0.6);
      if (covered.length === 0) continue;

      // 并集
      const unionTop = Math.min(...covered.map((s) => s.top));
      const unionBottom = Math.max(...covered.map((s) => s.top + s.height));
      const unionHeight = unionBottom - unionTop;

      const dTop = Math.abs(unionTop - c.y);
      if (dTop > worstTop) {
        worstTop = dTop;
        worstInfo = {
          rect: { x: +c.x.toFixed(1), y: +c.y.toFixed(1), w: +c.w.toFixed(1), h: +c.h.toFixed(1) },
          union: { top: +unionTop.toFixed(1), bottom: +unionBottom.toFixed(1) },
          covered: covered.map((s) => ({
            top: +s.top.toFixed(1),
            h: +s.height.toFixed(1),
            fs: +s.fontSize.toFixed(1),
          })),
          nearCount: near.length,
          overlappingCount: overlapping.length,
        };
      }
      if (unionHeight > 0) {
        const ratio = c.h / unionHeight;
        if (ratio > heightRatio) heightRatio = ratio;
      }
    }
    // 按 y 分组（有几行）
    const tops = [...new Set(rects.map((r) => Math.round(r.y / 5)))].length;

    return {
      rectCount: rects.length,
      worstTop: +worstTop.toFixed(2),
      heightRatio: +heightRatio.toFixed(2),
      worstInfo,
      distinctRows: tops,
      maxHeight: rects.length ? Math.round(Math.max(...rects.map((r) => r.h))) : 0,
    };
  });
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  const r1 = await selectAcross();

  if (!r1) {
    check('找到可拖选的正文', false);
  } else if (r1.layerMissing) {
    check('**自绘选区层存在**（跨行拖选）', false, 'layer 根本没渲染');
  } else {
    check('**自绘选区层有矩形**（跨行拖选）', r1.rectCount > 0, `${r1.rectCount} 个矩形`);
    check(
      '自绘矩形**贴合文字**（Δtop < 3px）',
      r1.worstTop < 3,
      `最差 Δtop = ${r1.worstTop}px ${JSON.stringify(r1.worstInfo ?? {})}`,
    );
    check(
      '矩形高度 ≈ 文字高度（不是行盒高度）',
      r1.heightRatio <= 1.15,
      `最大高度比 = ${r1.heightRatio}（1.0 = 完美；1.4 = 行盒高度）`,
    );
    check(
      '**一行一个矩形**（不是一个大长方形）',
      r1.distinctRows >= 2,
      `${r1.distinctRows} 个不同的行`,
    );
  }

  // ---- 缩放后仍然正常 ----
  for (const dir of ['放大', '缩小']) {
    await page.locator(`button[aria-label="${dir}"]`).click();
    /*
     * ⚠️ **必须等文本层重新渲染完**再选。
     *
     * 缩放会重新渲染 canvas + 文本层（异步）。
     * 选得太早 → 用的是**上一帧**的文本层 → 位置对不上 → 假失败。
     */
    await page.waitForTimeout(2500);
    await page.waitForFunction(
      () => {
        const spans = document.querySelectorAll('.scpdf-text-layer__item');
        return spans.length > 50;
      },
      { timeout: 20000 },
    );
    await page.waitForTimeout(500);

    const r = await selectAcross();
    if (!r || r.layerMissing) {
      check(`缩放（${dir}）后自绘层仍有矩形`, false);
      continue;
    }
    check(`缩放（${dir}）后自绘层仍有矩形`, r.rectCount > 0, `${r.rectCount} 个`);
    check(
      `缩放（${dir}）后仍贴合文字`,
      r.worstTop < 3,
      `最差 Δtop = ${r.worstTop}px ${JSON.stringify(r.worstInfo ?? {})}`,
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
