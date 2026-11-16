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
await page.goto('http://localhost:5192', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => (x.textContent ?? '').trim().length > 20);
  const r = el.getBoundingClientRect();
  return {
    x: r.left + 5,
    y: r.top + r.height / 2,
    text: (el.textContent ?? '').slice(0, 30),
    rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width) },
  };
});
console.log('目标 span:', JSON.stringify(t));

await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 180, t.y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(800);

const sel = await page.evaluate(() => {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0) return null;
  const rects = [...s.getRangeAt(0).getClientRects()].map((r) => ({
    left: Math.round(r.left),
    top: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  }));
  return { text: s.toString().slice(0, 40), rects };
});
console.log('选区:', JSON.stringify(sel));

const btn = page.locator('button[aria-label="添加高亮"]');
await btn.click();
await page.waitForTimeout(1200);

const hl = await page.evaluate(() => {
  const h = document.querySelector('.scpdf-annotation--mine');
  if (!h) return null;
  const r = h.getBoundingClientRect();
  const pageEl = h.closest('.scpdf-page');
  const pr = pageEl?.getBoundingClientRect();
  return {
    rect: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
    pageNumber: pageEl?.dataset.pageNumber,
    pageTop: pr ? Math.round(pr.top) : null,
    // 页内坐标
    inPage: pr ? { left: Math.round(r.left - pr.left), top: Math.round(r.top - pr.top) } : null,
  };
});
console.log('高亮:', JSON.stringify(hl));

const spansNear = await page.evaluate(() => {
  const h = document.querySelector('.scpdf-annotation--mine');
  if (!h) return null;
  const hr = h.getBoundingClientRect();
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  // 找中心点最近的
  const cx = hr.left + hr.width / 2,
    cy = hr.top + hr.height / 2;
  const near = spans
    .map((s) => {
      const r = s.getBoundingClientRect();
      return {
        text: (s.textContent ?? '').slice(0, 25),
        left: Math.round(r.left),
        top: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        d: Math.round(
          Math.hypot(
            Math.max(r.left - cx, 0, cx - r.right),
            Math.max(r.top - cy, 0, cy - r.bottom),
          ),
        ),
      };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  return { hlCenter: { x: Math.round(cx), y: Math.round(cy) }, near };
});
console.log('最近的 span:', JSON.stringify(spansNear, null, 2));
await browser.close();
