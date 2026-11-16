import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: parseInt(n.replace('chromium-', '')) || 0 }))
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
await page.goto('http://localhost:5194', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.waitForTimeout(2000);

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => {
    const r = x.getBoundingClientRect();
    return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
  });
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + 2 };
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 400, t.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);

const test = async (label, css) => {
  if (css) {
    await page.addStyleTag({ content: css });
  }
  const res = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rects = [...sel.getRangeAt(0).getClientRects()].map((r) => ({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    }));
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
        g.n++;
      }
    }
    const sample = (x, y) => {
      let c = 0;
      for (const r of rects) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) c++;
      return c;
    };
    const counts = groups.map((g) => sample((g.left + g.right) / 2, (g.top + g.bottom) / 2));
    const span = document.querySelector('.scpdf-text-layer__item');
    const cs = getComputedStyle(span);
    return {
      lines: groups.length,
      maxPaint: Math.max(...counts),
      rectH: span.getBoundingClientRect().height,
      lh: cs.lineHeight,
    };
  });
  console.log(label.padEnd(36), JSON.stringify(res));
  if (css) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    await page.waitForTimeout(1500);
    const t2 = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
      const el = spans.find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
      });
      const r = el.getBoundingClientRect();
      return { x: r.left + 5, y: r.top + 2 };
    });
    await page.mouse.move(t2.x, t2.y);
    await page.mouse.down();
    await page.mouse.move(t2.x + 400, t2.y + 120, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  return res;
};

await test('A) 当前 line-height:0', '');
await test('B) line-height: normal', '.scpdf-text-layer__item { line-height: normal !important; }');
await test('C) line-height: 1', '.scpdf-text-layer__item { line-height: 1 !important; }');
await test('D) display:inline', '.scpdf-text-layer__item { display: inline !important; }');
await test('E) line-height: 0.001', '.scpdf-text-layer__item { line-height: 0.001 !important; }');
await test(
  'F) lh:0 + overflow:hidden',
  '.scpdf-text-layer__item { line-height: 0 !important; overflow: hidden !important; }',
);
await browser.close();
