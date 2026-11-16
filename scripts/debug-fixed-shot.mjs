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
await page.goto('http://localhost:5193', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

// 应用 line-height:0 + multiply
await page.addStyleTag({
  content: `
  .scpdf-text-layer__item { line-height: 0 !important; }
  .scpdf-text-layer ::selection { background: rgba(13,104,189,0.24) !important; mix-blend-mode: multiply !important; }
`,
});
await page.waitForTimeout(300);

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => {
    const r = x.getBoundingClientRect();
    return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
  });
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + r.height / 2 };
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 400, t.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);

const clip = await page.evaluate(() => {
  const sel = window.getSelection();
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return {
    x: Math.max(0, r.left - 20),
    y: Math.max(0, r.top - 20),
    width: Math.min(650, r.width + 40),
    height: Math.min(320, r.height + 40),
  };
});
await page.screenshot({ path: 'e2e-shots/overlap-fixed.png', clip });
console.log('已截图 e2e-shots/overlap-fixed.png');
await browser.close();
