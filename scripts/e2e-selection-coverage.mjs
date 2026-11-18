/**
 * E2E：**多行选择的"覆盖率"**（不能漏选）。
 *
 * 用户反馈："现在选择文字的时候如果选择了多行 中间有的会没有出现底色，
 *            就是看起来漏选了一些地方 之前这个bug是没有的"
 *
 * ## 实测（修复前）
 *
 * ```
 * nativeCount: 14   （浏览器选了 14 个矩形）
 * drawnCount:  6    （只画出来 6 个）
 * uncovered:   7    （7 个矩形没有底色！）← 用户看到的"漏选"
 * ```
 *
 * ## 根因
 *
 * 浏览器会把选区**扩展到行首**（实测拖动 x=487，选区扩到 x=108，差 380px）
 * → 之前按"和拖动范围有重叠"过滤 → **行首那部分被丢掉**
 * → 中间的行就没底色了。
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

/**
 * 拖选一段，然后统计"有多少原生矩形没有底色"。
 *
 * ⚠️ **判定用"垂直有重叠"**，不是"完全包含"：
 * 画出来的是**字形盒**（比浏览器的**行盒**矮）→ 不能要求完全包含。
 */
const selectAndMeasure = async (dragDy) => {
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return (
        fs >= 12 &&
        r.top > 250 &&
        r.top < 500 &&
        (x.textContent ?? '').trim().length > 30 &&
        r.width > 150
      );
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  });
  if (!t) return null;

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + 120, t.y + dragDy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const pageEl = document.querySelector('.scpdf-page');
    const pr = pageEl.getBoundingClientRect();

    const sel = window.getSelection();
    const native = sel?.rangeCount
      ? [...sel.getRangeAt(0).getClientRects()]
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({
            l: Math.round(r.left - pr.left),
            t: Math.round(r.top - pr.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
          }))
      : [];

    const svg = document.querySelector('.scpdf-selection-layer');
    const drawn = [...(svg?.querySelectorAll('clipPath rect') ?? [])].map((r) => ({
      l: Math.round(Number(r.getAttribute('x'))),
      t: Math.round(Number(r.getAttribute('y'))),
      w: Math.round(Number(r.getAttribute('width'))),
      h: Math.round(Number(r.getAttribute('height'))),
    }));

    const uncovered = native.filter(
      (n) =>
        !drawn.some(
          (d) =>
            Math.min(n.t + n.h, d.t + d.h) - Math.max(n.t, d.t) > 2 &&
            Math.min(n.l + n.w, d.l + d.w) - Math.max(n.l, d.l) > -2,
        ),
    );

    return { nativeCount: native.length, drawnCount: drawn.length, uncovered };
  });
};

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

  // ---- 1. 跨多行拖选 ----
  const r = await selectAndMeasure(150);
  if (!r) {
    check('找到可拖选的正文', false);
  } else {
    console.log(
      `  原生矩形 ${r.nativeCount} 个 / 画出来 ${r.drawnCount} 个 / 没底色 ${r.uncovered.length} 个`,
    );
    check('选到了多行', r.nativeCount >= 4, `${r.nativeCount} 个矩形`);
    check(
      '**多行选择：没有漏选**（每个原生矩形都有底色）',
      r.uncovered.length === 0,
      `${r.uncovered.length} 个没底色`,
    );
  }

  // ---- 2. 更大范围的多行 ----
  const r2 = await selectAndMeasure(260);
  if (r2) {
    console.log(
      `  大范围: 原生 ${r2.nativeCount} / 画出 ${r2.drawnCount} / 没底色 ${r2.uncovered.length}`,
    );
    check(
      '更大范围的多行：也没有漏选',
      r2.uncovered.length === 0,
      `${r2.uncovered.length} 个没底色`,
    );
  }

  // ---- 3. 单行拖选（不能被过滤掉）----
  const r3 = await selectAndMeasure(0);
  if (r3) {
    console.log(
      `  单行: 原生 ${r3.nativeCount} / 画出 ${r3.drawnCount} / 没底色 ${r3.uncovered.length}`,
    );
    check('单行拖选：也没有漏选', r3.uncovered.length === 0, `${r3.uncovered.length} 个没底色`);
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
