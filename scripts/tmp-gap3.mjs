import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
  .sort((a, b) => b.v - a.v);
let exe;
for (const d of dirs) {
  const e = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
  if (existsSync(e)) {
    exe = e;
    break;
  }
}

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(1500);

// 选一段连续的正文（多行）
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

await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 120, t.y + 150, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(900);

const result = await page.evaluate(() => {
  const container = document.querySelector('.scpdf-container');
  const pageEl = document.querySelector('.scpdf-page');
  const _cr = container.getBoundingClientRect();
  const pr = pageEl.getBoundingClientRect();

  // 原生 client rects（视口坐标）
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

  // 画出来的（页内坐标）
  const svg = document.querySelector('.scpdf-selection-layer');
  const drawn = [...(svg?.querySelectorAll('clipPath rect') ?? [])].map((r) => ({
    l: Math.round(Number(r.getAttribute('x'))),
    t: Math.round(Number(r.getAttribute('y'))),
    w: Math.round(Number(r.getAttribute('width'))),
    h: Math.round(Number(r.getAttribute('height'))),
  }));

  // 逐个原生 rect 找有没有被覆盖（垂直有重叠 + 水平重叠）
  const uncovered = native.filter((n) => {
    return !drawn.some(
      (d) =>
        // 垂直方向有重叠（画出来的是"字形盒"，比浏览器的"行盒"矮 → 不能要求完全包含）
        Math.min(n.t + n.h, d.t + d.h) - Math.max(n.t, d.t) > 2 &&
        Math.min(n.l + n.w, d.l + d.w) - Math.max(n.l, d.l) > -2,
    );
  });

  return { nativeCount: native.length, drawnCount: drawn.length, uncovered, native, drawn };
});

console.log(
  JSON.stringify(
    {
      nativeCount: result.nativeCount,
      drawnCount: result.drawnCount,
      uncoveredCount: result.uncovered.length,
      uncovered: result.uncovered,
    },
    null,
    1,
  ),
);

await browser.close();
