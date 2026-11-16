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
  const measure = () => {
    const sel = window.getSelection();
    const rects = [...sel.getRangeAt(0).getClientRects()].map(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }));
    const groups = [];
    for (const r of rects) {
      let g = groups.find(g => r.top < g.bottom && r.bottom > g.top && r.left < g.right && r.right > g.left);
      if (!g) { g = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, n: 1 }; groups.push(g); }
      else { g.top=Math.min(g.top,r.top); g.bottom=Math.max(g.bottom,r.bottom); g.left=Math.min(g.left,r.left); g.right=Math.max(g.right,r.right); g.n++; }
    }
    const counts = {};
    for (const g of groups) counts[g.n] = (counts[g.n]||0)+1;
    const sample = (x,y) => { let c=0; for (const r of rects) if (x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom) c++; return c; };
    const dist = {};
    for (const g of groups) { const c = sample((g.left+g.right)/2, (g.top+g.bottom)/2); dist[c]=(dist[c]||0)+1; }
    return { rects: rects.length, lines: groups.length, rectsPerLine: counts, paintDist: dist };
  };

  const before = measure();

  // 试验: 给所有 span 加 line-height:0 (让行盒高度=0, 不产生独立行盒)
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const saved = spans.map(s => s.style.lineHeight);
  spans.forEach(s => { s.style.lineHeight = '0'; });
  const afterLineHeight0 = measure();

  // 恢复
  spans.forEach((s,i) => { s.style.lineHeight = saved[i]; });
  return { before, afterLineHeight0 };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
