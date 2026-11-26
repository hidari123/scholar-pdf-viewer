/**
 * E2E：**选区按【文档顺序】裁剪**（用 Chrome 原生当 oracle）
 *
 * ## 覆盖的场景
 *
 * 1. **选 1 个字符** —— 涂的宽度要 ≈ Chrome（不是整块）
 * 2. 页 2 反向拖（右栏行尾 -> 左栏）—— 用户反馈"第二栏上面没被选中"
 * 3. 页 3 跨栏拖（左栏 -> 右栏）
 * 4. 页 3 反向拖（右栏 -> 左栏）—— 用户反馈"反着选只有 2 行"
 *
 * ## ⚠️ 比较粒度必须是【项】，不是【行】
 *
 * -> 浏览器对同一视觉行会给多个 top 不同的 rect（行盒 vs 字形盒）
 * -> 按行分桶两边必然对不上
 * -> 唯一客观的粒度是**文本项**
 *
 * ## ⚠️ 也不能只比 raw text
 *
 * -> Chrome 的 `selection.toString()` 会截掉边界项的字符
 * -> 但【项的集合】两边一致
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

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 40000,
});
await page.waitForTimeout(3000);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** 读状态 */
const readState = () =>
  page.evaluate(() => {
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const all = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const nativeItems = range ? all.filter((el) => range.intersectsNode(el)) : [];
    const nativeSet = new Set(nativeItems);

    const drawn = [];
    for (const L of document.querySelectorAll('.scpdf-selection-layer')) {
      const lb = L.getBoundingClientRect();
      for (const el of L.querySelectorAll('rect')) {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));
        const w = Number(el.getAttribute('width'));
        const h = Number(el.getAttribute('height'));
        if (!(w > 0 && h > 0)) continue;
        drawn.push({ top: y + lb.top, left: x + lb.left, width: w, height: h });
      }
    }

    const covered = new Set();
    for (const el of all) {
      const b = el.getBoundingClientRect();
      for (const r of drawn) {
        const ox = Math.min(b.right, r.left + r.width) - Math.max(b.left, r.left);
        const oy = Math.min(b.bottom, r.top + r.height) - Math.max(b.top, r.top);
        if (ox > 1 && oy > 1) {
          covered.add(el);
          break;
        }
      }
    }

    let onlyNative = 0;
    let onlyCovered = 0;
    for (const el of all) {
      const inN = nativeSet.has(el);
      const inC = covered.has(el);
      if (inN && !inC) onlyNative += 1;
      else if (!inN && inC) onlyCovered += 1;
    }

    // ⚠️ **总宽度**比字符数更客观
    const rawRects = [];
    if (range) {
      for (const rr of range.getClientRects()) {
        if (rr.width > 0 && rr.height > 0)
          rawRects.push({ top: rr.top, left: rr.left, width: rr.width, height: rr.height });
      }
    }

    return {
      nativeItemCount: nativeItems.length,
      coveredItemCount: covered.size,
      onlyNative,
      onlyCovered,
      nativeItemSet: nativeItems.map((el) => all.indexOf(el)).sort((a, b) => a - b),
      coveredItemSet: [...covered].map((el) => all.indexOf(el)).sort((a, b) => a - b),
      nativeWidth: rawRects.reduce((a, r) => a + r.width, 0),
      drawnWidth: drawn.reduce((a, r) => a + r.width, 0),
      drawnCount: drawn.length,
      dbg: window.__dbgR ?? null,
    };
  });

async function drag(pts) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const q of pts.slice(1)) await page.mouse.move(q.x, q.y, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
}

/* ============ 1. 字符级精度 ============ */
console.log('\n[1] 选 1 个字符 —— 涂的宽度要 ≈ Chrome');
await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const el = [...document.querySelectorAll('.scpdf-text-layer__item')].find(
    (e) => (e.textContent ?? '').length > 10 && e.getBoundingClientRect().left > 200,
  );
  if (el) {
    const b = el.getBoundingClientRect();
    c.scrollTop += b.top - 300;
  }
});
await page.waitForTimeout(1800);

const target = await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const cb = c.getBoundingClientRect();
  const el = [...document.querySelectorAll('.scpdf-text-layer__item')].find(
    (e) =>
      (e.textContent ?? '').length > 10 &&
      e.getBoundingClientRect().top >= cb.top + 20 &&
      e.getBoundingClientRect().top <= cb.bottom - 120 &&
      e.getBoundingClientRect().left > 200,
  );
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { text: el.textContent, x: b.left, y: b.top, w: b.width, h: b.height };
});
console.log(`  目标项: ${JSON.stringify(target?.text)} (w=${target?.w.toFixed(0)})`);

if (target) {
  const midX = target.x + target.w / 2;
  const midY = target.y + target.h / 2;
  await drag([
    { x: midX, y: midY },
    { x: midX + 30, y: midY },
  ]);
  const s = await readState();
  console.log(`  Chrome 宽度 ${s.nativeWidth.toFixed(0)}px | 我们 ${s.drawnWidth.toFixed(0)}px`);
  console.log(`  dbg ${JSON.stringify(s.dbg)}`);
  const ratio = s.nativeWidth > 0 ? s.drawnWidth / s.nativeWidth : 1;
  check(
    '涂的宽度 ≈ Chrome（不是整块）',
    ratio > 0.5 && ratio < 2,
    `比例 ${ratio.toFixed(2)}（Chrome ${s.nativeWidth.toFixed(0)}px / 我们 ${s.drawnWidth.toFixed(0)}px）`,
  );
  check(
    '项数与 Chrome 一致',
    s.nativeItemCount === s.coveredItemCount,
    `原生 ${s.nativeItemCount} / 我们 ${s.coveredItemCount}`,
  );
}

/* ============ 2. 页 2 反向拖 ============ */
console.log('\n[2] 页 2 反向拖（右栏行尾 -> 左栏 Celecoxib）');
await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const el = [...document.querySelectorAll('.scpdf-text-layer__item')].find((e) =>
    (e.textContent ?? '').includes('Celecoxib'),
  );
  if (el) {
    const b = el.getBoundingClientRect();
    c.scrollTop += b.top - 300;
  }
});
await page.waitForTimeout(1800);
await drag([
  { x: 1448, y: 290 },
  { x: 1418, y: 295 },
  { x: 729, y: 315 },
]);
{
  const s = await readState();
  console.log(`  Chrome ${s.nativeItemCount} 项 | 我们 ${s.coveredItemCount} 项`);
  console.log(`  dbg ${JSON.stringify(s.dbg)}`);
  check('浏览器选中的项全部保留', s.onlyNative === 0, `丢 ${s.onlyNative} 个`);
  check('没有多选', s.onlyCovered === 0, `多 ${s.onlyCovered} 个`);
  check(
    '项集合与 Chrome 完全一致',
    JSON.stringify(s.nativeItemSet) === JSON.stringify(s.coveredItemSet),
    `Chrome ${s.nativeItemSet.length} 项 / 我们 ${s.coveredItemSet.length} 项`,
  );
}

/* ============ 3. 页 3 双栏 ============ */
console.log('\n[3] 页 3 双栏');
await page.evaluate(() => {
  const pg = document.querySelector('.scpdf-page[data-page-number="3"]');
  const c = document.querySelector('.scpdf-container');
  if (pg) c.scrollTop = pg.offsetTop + c.scrollTop - 60;
});
await page.waitForTimeout(1500);
const cols = await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const cb = c.getBoundingClientRect();
  const all = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const vis = all.filter((el) => {
    const b = el.getBoundingClientRect();
    return b.top >= cb.top + 10 && b.top <= cb.bottom - 80;
  });
  const rowsOf = (f) => {
    const m = new Map();
    for (const el of vis) {
      const b = el.getBoundingClientRect();
      if (!f(b)) continue;
      const k = Math.round(b.top / 8) * 8;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ l: b.left, r: b.left + b.width, h: b.height });
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  };
  const mk = (e) => ({
    k: e[0],
    l: Math.round(Math.min(...e[1].map((i) => i.l))),
    r: Math.round(Math.max(...e[1].map((i) => i.r))),
    h: e[1][0].h,
  });
  return {
    left: rowsOf((b) => b.left < 900 && b.right < 900).map(mk),
    right: rowsOf((b) => b.left > 900).map(mk),
  };
});

if (cols.left.length >= 2 && cols.right.length >= 2) {
  const L = cols.left[1];
  const R = cols.right[1];
  await drag([
    { x: L.l + 4, y: L.k + L.h / 2 },
    { x: L.r - 4, y: L.k + L.h / 2 },
    { x: R.l + 4, y: R.k + R.h / 2 },
    { x: R.r - 4, y: R.k + R.h / 2 },
  ]);
  const s = await readState();
  console.log(`  【跨栏】Chrome ${s.nativeItemCount} 项 | 我们 ${s.coveredItemCount} 项`);
  console.log(`  dbg ${JSON.stringify(s.dbg)}`);
  check('跨栏：浏览器选中的项全部保留', s.onlyNative === 0, `丢 ${s.onlyNative} 个`);
  check('跨栏：没有多选', s.onlyCovered === 0, `多 ${s.onlyCovered} 个`);
  check(
    '跨栏：项集合与 Chrome 完全一致',
    JSON.stringify(s.nativeItemSet) === JSON.stringify(s.coveredItemSet),
    `Chrome ${s.nativeItemSet.length} / 我们 ${s.coveredItemSet.length}`,
  );
}

if (cols.left.length >= 4 && cols.right.length >= 4) {
  const R = cols.right[3];
  const L = cols.left[3];
  await drag([
    { x: R.r - 6, y: R.k + R.h / 2 },
    { x: R.l + 6, y: R.k + R.h / 2 },
    { x: L.r - 6, y: L.k + L.h / 2 },
    { x: L.l + 6, y: L.k + L.h / 2 },
  ]);
  const s = await readState();
  console.log(`  【反向】Chrome ${s.nativeItemCount} 项 | 我们 ${s.coveredItemCount} 项`);
  console.log(`  dbg ${JSON.stringify(s.dbg)}`);
  check('反向：浏览器选中的项全部保留', s.onlyNative === 0, `丢 ${s.onlyNative} 个`);
  check('反向：没有多选', s.onlyCovered === 0, `多 ${s.onlyCovered} 个`);
  check(
    '反向：项集合与 Chrome 完全一致',
    JSON.stringify(s.nativeItemSet) === JSON.stringify(s.coveredItemSet),
    `Chrome ${s.nativeItemSet.length} / 我们 ${s.coveredItemSet.length}`,
  );
}

check('没有页面错误', errors.length === 0, errors.join(' | ').slice(0, 150));

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
await browser.close();
process.exit(failed.length ? 1 : 0);
