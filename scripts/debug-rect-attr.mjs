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
  const el = spans.find(x => {
    const r = x.getBoundingClientRect();
    return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + r.height/2 };
});

await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 400, t.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);

// 检查: 每个 rect 对应哪个 span
const result = await page.evaluate(() => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { error: 'no sel' };
  const range = sel.getRangeAt(0);
  const rects = [...range.getClientRects()].map(r => ({
    top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), left: Math.round(r.left), w: Math.round(r.width)
  }));

  // 每个 rect 落在哪些 span 上
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const attribution = rects.slice(0, 8).map((rect, idx) => {
    const hits = spans.filter(s => {
      const r = s.getBoundingClientRect();
      const ox = Math.min(rect.left+rect.w, r.right) - Math.max(rect.left, r.left);
      const oy = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top);
      return ox > 0 && oy > 0;
    }).map(s => ({
      text: (s.textContent ?? '').slice(0, 14),
      top: Math.round(s.getBoundingClientRect().top),
      h: Math.round(s.getBoundingClientRect().height),
      fs: getComputedStyle(s).fontSize,
      lh: getComputedStyle(s).lineHeight,
    }));
    return { rect: idx, ...rect, spans: hits };
  });

  // 检查 span 的 line-height
  const sample = spans.slice(0, 3).map(s => {
    const cs = getComputedStyle(s);
    return { fs: cs.fontSize, lh: cs.lineHeight, display: cs.display, verticalAlign: cs.verticalAlign };
  });

  return { rectCount: rects.length, attribution, sample };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
