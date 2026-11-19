/**
 * E2E：**多行选择的"行尾"覆盖**（用户截图的 bug）。
 *
 * 用户反馈："现在选择文字的时候如果选择了多行 中间有的会没有出现底色，
 *            就是看起来漏选了一些地方"
 *
 * ## 实测（修复前）
 *
 * 真实 PDF 的 figure caption（用户截图的那一段）：
 *
 * ```
 * 拖动:  x=171 → 471
 * 选区:  x=166 → 1242     ← 浏览器把**整行**都选上了
 *
 * 漏掉的 span（9 个）：
 *   944,1530 " "
 *   953,1530 "(a)"
 *   985,1530 "An Agent Task Protocol"
 *   1066,1598 "correctness"
 *   1192,1598 "spans"
 *   …
 * ```
 *
 * → 根因：`filterByDragOrigin` 按"离拖动范围 ≤ 450px"过滤
 * → **行尾离拖动终点 473~635px** → 被丢掉 → **行尾整段没底色**
 *
 * ## 修复
 *
 * 改成按**"同一视觉行内的连续性"**判断（段和段之间的空隙，而不是段和拖动范围的��离）。
 *
 * ## 验证什么
 *
 * **每一个被浏览器选中的文字 span，都必须有底色**（覆盖率 ≥ 90%）。
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
 * 拖选一段，然后统计"每个被选中的 span 的覆盖率"。
 */
const selectAndMeasure = async (dragDy, dragDx) => {
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return fs >= 12 && r.top > 250 && r.top < 500 && r.width > 150;
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  });
  if (!t) return null;

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + dragDx, t.y + dragDy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const pageEl = document.querySelector('.scpdf-page');
    const pr = pageEl.getBoundingClientRect();
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const svg = document.querySelector('.scpdf-selection-layer');
    const drawn = [...(svg?.querySelectorAll('clipPath rect') ?? [])].map((r) => ({
      l: Number(r.getAttribute('x')),
      t: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    }));

    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) =>
      range?.intersectsNode(x),
    );

    const rows = spans.map((x) => {
      const r = x.getBoundingClientRect();
      const l = r.left - pr.left;
      const t = r.top - pr.top;
      let covered = 0;
      for (const d of drawn) {
        const ox = Math.max(0, Math.min(l + r.width, d.l + d.w) - Math.max(l, d.l));
        const oy = Math.max(0, Math.min(t + r.height, d.t + d.h) - Math.max(t, d.t));
        covered += (ox * oy) / Math.max(1, r.width * r.height);
      }
      return {
        cover: Math.round(covered * 100),
        txt: (x.textContent ?? '').slice(0, 24),
        l: Math.round(l),
        t: Math.round(t),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });

    return { total: rows.length, missed: rows.filter((r) => r.cover < 90), rows, drawn };
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

  // ---- 1. 拖到行的中间（浏览器会扩展到整行）----
  const r1 = await selectAndMeasure(90, 300);
  if (!r1) {
    check('找到可拖选的正文', false);
  } else {
    console.log(
      `  选中 ${r1.total} 个 span，漏选 ${r1.missed.length} 个` +
        (r1.missed.length
          ? `：${r1.missed.map((m) => `"${m.txt}"(${m.cover}% @${m.l},${m.t} ${m.w}x${m.h})`).join(', ')}`
          : ''),
    );
    if (r1.missed.length) {
      console.log('  画出来的矩形:', JSON.stringify(r1.drawn));
    }
    check(
      '**每个被选中的 span 都有底色**（行尾也不能漏）',
      r1.missed.length === 0,
      `${r1.missed.length} 个漏选`,
    );
  }

  // ---- 2. 拖到行的更靠右 ----
  const r2 = await selectAndMeasure(150, 500);
  if (r2) {
    console.log(`  大范围：选中 ${r2.total} 个 span，漏选 ${r2.missed.length} 个`);
    check('大范围拖选：也没有漏选', r2.missed.length === 0, `${r2.missed.length} 个漏选`);
  }

  // ---- 3. 单行 ----
  const r3 = await selectAndMeasure(0, 200);
  if (r3) {
    console.log(`  单行：选中 ${r3.total} 个 span，漏选 ${r3.missed.length} 个`);
    check('单行拖选：也没有漏选', r3.missed.length === 0, `${r3.missed.length} 个漏选`);
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
