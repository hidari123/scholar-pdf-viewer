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
  const el = spans.find(x => { const r = x.getBoundingClientRect(); return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20; });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + r.height/2 };
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 400, t.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);

const result = await page.evaluate(() => {
  const sel = window.getSelection();
  const range = sel.getRangeAt(0);
  const rects = [...range.getClientRects()].map(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }));

  // 按"行"分组: 垂直重叠的 rect 属于同一行
  const groups = [];
  for (const r of rects) {
    let g = groups.find(g => r.top < g.bottom && r.bottom > g.top && r.left < g.right && r.right > g.left);
    if (!g) { g = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, n: 1 }; groups.push(g); }
    else { g.top = Math.min(g.top, r.top); g.bottom = Math.max(g.bottom, r.bottom); g.left = Math.min(g.left, r.left); g.right = Math.max(g.right, r.right); g.n++; }
  }

  // 每个行组的矩形数分布
  const counts = {};
  for (const g of groups) counts[g.n] = (counts[g.n] || 0) + 1;

  // 计算"重叠像素被涂了几次"
  // 采样网格
  const sample = (x, y) => {
    let c = 0;
    for (const r of rects) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) c++;
    return c;
  };
  const maxPaint = {};
  for (const g of groups) {
    const cx = (g.left + g.right) / 2, cy = (g.top + g.bottom) / 2;
    const c = sample(cx, cy);
    maxPaint[c] = (maxPaint[c] || 0) + 1;
  }

  return {
    totalRects: rects.length,
    visualLines: groups.length,
    rectsPerLine: counts,
    paintCountDistribution: maxPaint,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
