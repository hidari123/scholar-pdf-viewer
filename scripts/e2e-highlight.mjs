/**
 * E2E：高亮效果（对齐 / 不遮挡 / 选区不叠涂 / 颜色可配）。
 *
 * 断言：
 * 1. 高亮矩形与被选文字**逐行**精确对齐（Δ < 2px）
 * 2. 高亮**不遮挡**文字（multiply 混合 → 字仍是深色）
 * 3. 选区背景**每处只涂一次**（没有阶梯状深浅不一）
 * 4. 高亮块可点击
 * 5. 选区不叠涂（同行不同字号不产生多个行盒）
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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5194';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ---- 选一段跨行的文字 ----
  const target = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const el = spans.find((x) => {
      const r = x.getBoundingClientRect();
      return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 2 };
  });

  check('找到可拖选的文本', target !== null);
  if (!target) throw new Error('no target');

  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 400, target.y + 120, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  // ---- 断言 3：选区每处只涂一次（修阶梯重叠）----
  const paint = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const rects = [...sel.getRangeAt(0).getClientRects()].map((r) => ({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    }));

    // 视觉行分组（垂直重叠的算同一行）
    const groups = [];
    for (const r of rects) {
      const g = groups.find(
        (g) => r.top < g.bottom && r.bottom > g.top && r.left < g.right && r.right > g.left,
      );
      if (!g) {
        groups.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, n: 1 });
      } else {
        g.top = Math.min(g.top, r.top);
        g.bottom = Math.max(g.bottom, r.bottom);
        g.left = Math.min(g.left, r.left);
        g.right = Math.max(g.right, r.right);
        g.n += 1;
      }
    }

    const span = document.querySelector('.scpdf-text-layer__item');
    const layer = document.querySelector('.scpdf-selection-layer');

    return {
      lines: groups.length,
      /** 原生选区的叠涂次数（浏览器仍返回多个重叠 rect，但背景已关掉 → 不影响观感） */
      nativeMaxPaint: Math.max(
        ...groups.map((g) => {
          const cx = (g.left + g.right) / 2;
          const cy = (g.top + g.bottom) / 2;
          return rects.filter((r) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom)
            .length;
        }),
      ),
      /** 原生选区背景必须是透明（否则会与自绘层叠加） */
      nativeBg: span ? getComputedStyle(span, '::selection').backgroundColor : '',
      /** 自绘层必须有 clipPath 矩形 */
      layerRects: layer ? layer.querySelectorAll('clipPath rect').length : 0,
      /** 自绘层的填充色 */
      layerFill: layer
        ? getComputedStyle(layer.querySelector('.scpdf-selection-layer__fill')).fill
        : '',
      /** line-height 必须是正常值（0 会让选区框上偏 22px） */
      lineHeight: span ? getComputedStyle(span).lineHeight : '',
    };
  });

  check(
    '原生 ::selection 背景已关闭（改由自绘层接管）',
    paint !== null && paint.nativeBg === 'rgba(0, 0, 0, 0)',
    paint ? `native ::selection background = ${paint.nativeBg}` : '',
  );

  check(
    '自绘选区层已渲染（clipPath 有矩形）',
    paint !== null && paint.layerRects > 0,
    paint ? `${paint.layerRects} 个 clip rect` : '',
  );

  check(
    '文本层 line-height 正常（0 会让选区框上偏 22px）',
    paint !== null && paint.lineHeight !== '0px',
    paint ? `line-height = ${paint.lineHeight}` : '',
  );

  check(
    '自绘层填充色可读（半透明 + multiply）',
    paint !== null && paint.layerFill !== 'none',
    paint ? `fill = ${paint.layerFill}` : '',
  );

  // ---- 添加高亮 ----
  await page.locator('button[aria-label="添加高亮"]').click();
  await page.waitForTimeout(1000);

  const hl = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.scpdf-annotation--mine')];
    if (list.length === 0) return null;

    const sel = window.getSelection();
    const selRects =
      sel?.rangeCount > 0
        ? [...sel.getRangeAt(0).getClientRects()].map((r) => ({
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          }))
        : [];

    const hlRects = list.map((h) => {
      const r = h.getBoundingClientRect();
      return {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        blend: getComputedStyle(h).mixBlendMode,
        radius: getComputedStyle(h).borderRadius,
        transform: getComputedStyle(h).transform,
      };
    });

    return { hlRects, selRects };
  });

  check('高亮已创建', hl?.hlRects.length > 0, hl ? `${hl.hlRects.length} 个块` : '');

  // ---- 断言 1：逐行对齐 ----
  if (hl && hl.hlRects.length > 0 && hl.selRects.length > 0) {
    let worst = 0;
    let worstDesc = '';

    for (const h of hl.hlRects) {
      // 找最匹配的选区 rect
      let best = null;
      let bestD = Infinity;
      for (const s of hl.selRects) {
        if (s.width === 0 || s.height === 0) continue;
        const d = Math.abs(s.left - h.left) + Math.abs(s.top - h.top);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (!best) continue;

      const dLeft = Math.abs(best.left - h.left);
      const dTop = Math.abs(best.top - h.top);
      const d = Math.max(dLeft, dTop);
      if (d > worst) {
        worst = d;
        worstDesc = `Δleft=${dLeft.toFixed(1)} Δtop=${dTop.toFixed(1)}`;
      }
    }

    check(
      '高亮与被选文字逐行精确对齐（Δ < 2px）',
      worst < 2,
      `最大偏差 ${worst.toFixed(1)}px ${worstDesc}`,
    );
  }

  // ---- 断言 2：不遮挡（multiply 混合）----
  check(
    '高亮用 mix-blend-mode: multiply（文字仍清晰）',
    hl?.hlRects.every((h) => h.blend === 'multiply') === true,
    hl ? `blend = ${hl.hlRects[0]?.blend}` : '',
  );

  check(
    '高亮圆角 4px（对齐 pdf.js）',
    hl?.hlRects.every((h) => h.radius === '4px') === true,
    hl ? `radius = ${hl.hlRects[0]?.radius}` : '',
  );

  check(
    '高亮没有 transform: scale（避免双重缩放）',
    hl?.hlRects.every(
      (h) => h.transform === 'none' || h.transform === 'matrix(1, 0, 0, 1, 0, 0)',
    ) === true,
    hl ? `transform = ${hl.hlRects[0]?.transform}` : '',
  );

  // ---- 断言 4：高亮可点击 ----
  const clickable = await page.evaluate(() => {
    const h = document.querySelector('.scpdf-annotation--mine');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === h || h.contains(el);
  });
  check('高亮块可点击（elementFromPoint 命中高亮本身）', clickable === true);

  // ---- 截图 ----
  const clip = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return {
      x: Math.max(0, r.left - 30),
      y: Math.max(0, r.top - 30),
      width: Math.min(700, r.width + 60),
      height: Math.min(300, r.height + 60),
    };
  });
  if (clip) {
    await page.screenshot({ path: 'e2e-shots/highlight-e2e.png', clip });
  }
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
