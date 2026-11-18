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

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
    const r = x.getBoundingClientRect();
    const fs = Number.parseFloat(getComputedStyle(x).fontSize);
    return (
      fs >= 12 &&
      r.top > 200 &&
      r.top < 600 &&
      (x.textContent ?? '').trim().length > 30 &&
      r.width > 150
    );
  });
  if (!spans.length) return null;
  const el = spans[0];
  const r = el.getBoundingClientRect();
  return { x: r.left + 30, y: r.top + 8 };
});

await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 200, t.y + 200, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(900);

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const container = document.querySelector('.scpdf-container');
      const pageEl = document.querySelector('.scpdf-page');
      const cr = container.getBoundingClientRect();
      const pr = pageEl.getBoundingClientRect();
      const pagesEl = document.querySelector('.scpdf-pages');
      const psr = pagesEl.getBoundingClientRect();

      const svg = document.querySelector('.scpdf-selection-layer');
      const rects = [...(svg?.querySelectorAll('clipPath rect') ?? [])].map((r) => ({
        x: Math.round(Number(r.getAttribute('x'))),
        y: Math.round(Number(r.getAttribute('y'))),
        w: Math.round(Number(r.getAttribute('width'))),
        h: Math.round(Number(r.getAttribute('height'))),
      }));

      // 被选中的行（用 span 的位置，而不是 client rect）
      const sel = window.getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      const selRows = [];
      if (range) {
        for (const s of document.querySelectorAll('.scpdf-text-layer__item')) {
          if (range.intersectsNode(s)) {
            const r = s.getBoundingClientRect();
            const key = Math.round(r.top / 5);
            if (!selRows.some((x) => x.key === key)) {
              selRows.push({
                key,
                top: Math.round(r.top),
                left: Math.round(r.left),
                txt: (s.textContent || '').slice(0, 20),
              });
            }
          }
        }
      }

      return {
        containerTop: Math.round(cr.top),
        scrollTop: container.scrollTop,
        pagesTop: Math.round(psr.top),
        pageTop: Math.round(pr.top),
        pageLeftInViewport: Math.round(pr.left - cr.left),
        drawn: rects,
        selRows,
      };
    }),
    null,
    1,
  ),
);

await browser.close();
