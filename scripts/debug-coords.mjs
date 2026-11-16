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

// 读包的 selection 数据 —— 通过 demo 的提示? 用 React devtools 不行
// 改为: 检查 .scpdf-page 的位置 和 span 的 position
const geo = await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const cr = c.getBoundingClientRect();
  const p = document.querySelector('.scpdf-page');
  const pr = p.getBoundingClientRect();
  const tl = document.querySelector('.scpdf-text-layer');
  const tr = tl.getBoundingClientRect();
  const span = document.querySelector('.scpdf-text-layer__item');
  const sr = span.getBoundingClientRect();
  return {
    container: { top: cr.top, left: cr.left, scrollTop: c.scrollTop },
    page: { top: pr.top, left: pr.left },
    textLayer: { top: tr.top, left: tr.left },
    span: { top: sr.top, left: sr.left },
    pageStyleTop: p.style.top,
  };
});
console.log(JSON.stringify(geo, null, 2));
await browser.close();
