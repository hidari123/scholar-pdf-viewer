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

// 实验: 同一个 span, 有/无 scaleX 时 getClientRects() 的差异
const result = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => {
    const t = x.style.transform ?? '';
    return t.includes('scaleX') && (x.textContent ?? '').trim().length > 10;
  });
  if (!el?.firstChild) return { error: 'no span' };

  const range = document.createRange();
  range.setStart(el.firstChild, 0);
  range.setEnd(el.firstChild, 5);

  const withTransform = [...range.getClientRects()].map((r) => ({
    top: Math.round(r.top),
    h: Math.round(r.height),
    w: Math.round(r.width),
  }));

  // 去掉 scaleX
  const saved = el.style.transform;
  el.style.transform = saved.replace(/scaleX\([^)]*\)\s*/, '');
  const withoutTransform = [...range.getClientRects()].map((r) => ({
    top: Math.round(r.top),
    h: Math.round(r.height),
    w: Math.round(r.width),
  }));
  el.style.transform = saved;

  return {
    text: (el.textContent ?? '').slice(0, 20),
    styleTransform: saved,
    withTransform,
    withoutTransform,
    countWith: withTransform.length,
    countWithout: withoutTransform.length,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
