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
await page.goto('http://localhost:5195', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// 检查预设色按钮
const presets = await page.locator('.scpdf-toolbar__btn, button[aria-label^="高亮色"]').count();
console.log('色板按钮数:', presets);
const labels = await page.locator('button[aria-label^="高亮色"]').count();
console.log('预设色按钮:', labels);
const custom = await page.locator('input[type="color"]').count();
console.log('取色器:', custom);

// 选粉色 -> 添加高亮 -> 检查颜色
await page.locator('button[aria-label="高亮色 粉"]').click();
await page.waitForTimeout(300);

// 选一段文字并加高亮
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
await page.mouse.move(t.x + 300, t.y, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.locator('button[aria-label="添加高亮"]').click();
await page.waitForTimeout(800);

const hl = await page.evaluate(() => {
  const h = document.querySelector('.scpdf-annotation--mine');
  if (!h) return null;
  const cs = getComputedStyle(h);
  return { background: cs.backgroundColor, blend: cs.mixBlendMode };
});
console.log('高亮样式:', JSON.stringify(hl));
await page.screenshot({
  path: 'e2e-shots/picker.png',
  clip: { x: 0, y: 0, width: 1400, height: 120 },
});
await browser.close();
