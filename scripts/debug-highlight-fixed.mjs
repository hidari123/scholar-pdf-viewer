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

// 用 DOM 查询而不是 waitForSelector（line-height:0 让 span 高度为 0）
const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => {
    const r = x.getBoundingClientRect();
    return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.left + 5,
    y: r.top + 2,
    text: (el.textContent ?? '').slice(0, 20),
    rect: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
  };
});
console.log('目标 span:', JSON.stringify(t));

await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 400, t.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);

const sel = await page.evaluate(() => {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0) return null;
  const r = s.getRangeAt(0).getBoundingClientRect();
  return {
    text: s.toString().slice(0, 40),
    rect: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
  };
});
console.log('选区:', JSON.stringify(sel));

// 添加高亮
await page.locator('button[aria-label="添加高亮"]').click();
await page.waitForTimeout(1000);

const hl = await page.evaluate(() => {
  const h = document.querySelector('.scpdf-annotation--mine');
  if (!h) return null;
  const r = h.getBoundingClientRect();
  const cs = getComputedStyle(h);
  return {
    rect: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
    inlineStyle: h.getAttribute('style'),
    mixBlendMode: cs.mixBlendMode,
    background: cs.backgroundColor,
    borderRadius: cs.borderRadius,
  };
});
console.log('高亮:', JSON.stringify(hl, null, 2));

// 选区 vs 高亮 偏差
if (sel && hl) {
  console.log('\n=== 偏差 ===');
  console.log('Δleft =', hl.rect.left - sel.rect.left, 'px');
  console.log('Δtop  =', hl.rect.top - sel.rect.top, 'px');
}

// 截图
const clip = await page.evaluate(() => {
  const h = document.querySelector('.scpdf-annotation--mine');
  const s = window.getSelection();
  const el =
    s && s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : h?.getBoundingClientRect();
  if (!el) return null;
  return {
    x: Math.max(0, el.left - 30),
    y: Math.max(0, el.top - 30),
    width: Math.min(700, el.width + 60),
    height: Math.min(300, el.height + 60),
  };
});
if (clip) await page.screenshot({ path: 'e2e-shots/highlight-fixed.png', clip });
await browser.close();
