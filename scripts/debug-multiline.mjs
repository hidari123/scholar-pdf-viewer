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

const info = await page.evaluate(() => {
  const s = window.getSelection();
  const rects = [...s.getRangeAt(0).getClientRects()].map((r) => ({
    top: Math.round(r.top),
    left: Math.round(r.left),
    w: Math.round(r.width),
    h: Math.round(r.height),
  }));
  const pageEl = document.querySelector('.scpdf-page');
  const pr = pageEl.getBoundingClientRect();
  return { rects: rects.slice(0, 10), pageTop: Math.round(pr.top), pageLeft: Math.round(pr.left) };
});
console.log('页面 top/left:', info.pageTop, info.pageLeft);
console.log('选区 rects (前 10 个):');
for (const r of info.rects)
  console.log(
    '  top=' + r.top,
    'left=' + r.left,
    'w=' + r.w,
    'h=' + r.h,
    ' 页内top=' + (r.top - info.pageTop),
  );

await page.locator('button[aria-label="添加高亮"]').click();
await page.waitForTimeout(1000);

const hl = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.scpdf-annotation--mine')];
  return list.map((h) => {
    const r = h.getBoundingClientRect();
    return {
      inline: h.getAttribute('style'),
      rect: {
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
    };
  });
});
console.log('\n高亮块数量:', hl.length);
for (const h of hl) console.log('  ', JSON.stringify(h));
await browser.close();
