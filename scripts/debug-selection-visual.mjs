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

// 选中一段文字，看视觉
const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => (x.textContent ?? '').trim().length > 30);
  const r = el.getBoundingClientRect();
  return { x: r.left + 3, y: r.top + r.height / 2 };
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 250, t.y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);

// 截图选中区域
const clip = await page.evaluate(() => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return {
    x: Math.max(0, r.left - 30),
    y: Math.max(0, r.top - 20),
    width: Math.min(600, r.width + 60),
    height: r.height + 40,
  };
});
if (clip) {
  await page.screenshot({ path: 'e2e-shots/selection-visual.png', clip });
  console.log('已截图选中区域');
}

// 检查 ::selection 的实际生效
const selStyle = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans[0];
  const cs = getComputedStyle(el);
  return { color: cs.color, opacity: cs.opacity, background: cs.backgroundColor };
});
console.log('文本层 item 样式:', JSON.stringify(selStyle));
await browser.close();
