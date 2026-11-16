import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot).filter(n=>n.startsWith('chromium-')).map(n=>({n,v:parseInt(n.replace('chromium-',''))||0})).sort((a,b)=>b.v-a.v);
let exe; for (const d of dirs) { const e = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe'); if (existsSync(e)) { exe = e; break; } }
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5193', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find(x => (x.textContent ?? '').trim().length > 20);
  const r = el.getBoundingClientRect();
  const c = document.querySelector('.scpdf-container');
  const cr = c.getBoundingClientRect();
  const pageEl = el.closest('.scpdf-page');
  const pr = pageEl.getBoundingClientRect();
  return {
    drag: { x: r.left + 5, y: r.top + r.height/2 },
    spanRect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    containerRect: { left: Math.round(cr.left), top: Math.round(cr.top) },
    pageRect: { left: Math.round(pr.left), top: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) },
    scrollTop: Math.round(c.scrollTop),
  };
});
console.log('几何:', JSON.stringify(t, null, 2));

await page.mouse.move(t.drag.x, t.drag.y);
await page.mouse.down();
await page.mouse.move(t.drag.x + 180, t.drag.y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(800);

// 读取包的 selection 数据（通过 demo 的提示文字看不到 norm，改读高亮元素属性）
// 直接 hook: 监听 react 不行 -> 改为在添加高亮后读 .scpdf-annotation--mine 的 style
await page.locator('button[aria-label="添加高亮"]').click();
await page.waitForTimeout(1000);

const style = await page.evaluate(() => {
  const h = document.querySelector('.scpdf-annotation--mine');
  if (!h) return null;
  const pageEl = h.closest('.scpdf-page');
  const pr = pageEl.getBoundingClientRect();
  return {
    inlineStyle: h.getAttribute('style'),
    computed: { left: getComputedStyle(h).left, top: getComputedStyle(h).top, width: getComputedStyle(h).width, height: getComputedStyle(h).height, transform: getComputedStyle(h).transform },
    pageRect: { left: Math.round(pr.left), top: Math.round(pr.top) },
    scaleText: document.querySelector('.scpdf-toolbar__scale')?.textContent,
  };
});
console.log('\n高亮 style:', JSON.stringify(style, null, 2));
await browser.close();

