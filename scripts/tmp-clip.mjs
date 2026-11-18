import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: parseInt(n.replace('chromium-', ''), 10) || 0 }))
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
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('TMP-DEBUG')) console.log(t.slice(0, 400));
});
await page.addInitScript(() => {
  globalThis.__DBG__ = true;
});
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(1200);
const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
    const r = x.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(x).fontSize);
    return (
      fs >= 12 &&
      r.top > 200 &&
      r.top < 600 &&
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
await page.mouse.move(t.x + 200, t.y + 200, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(1000);
await browser.close();
