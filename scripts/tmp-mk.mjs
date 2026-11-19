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
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(1200);
// 拖选 → 加高亮
const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
    const r = x.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(x).fontSize);
    return fs >= 12 && r.top > 250 && r.top < 500 && r.width > 150;
  });
  const r = spans[0].getBoundingClientRect();
  return { x: r.left + 30, y: r.top + 8 };
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 200, t.y + 60, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(700);
const btn = page.getByRole('button', { name: '添加高亮', exact: true });
if (await btn.count()) {
  await btn.first().click();
  await page.waitForTimeout(900);
}
console.log(
  '高亮数:',
  await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length),
);
await browser.close();
