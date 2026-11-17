import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
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
await page.goto(process.env.E2E_BASE_URL ?? 'http://localhost:5201', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
    const r = x.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(x).fontSize);
    return fs > 18 && (x.textContent ?? '').trim().length > 60 && r.width > 400;
  });
  const el = spans[0];
  const r = el.getBoundingClientRect();
  return { x: r.left + 30, y: r.top + 10 };
});

// 页面内原生拖动 + 帧间隔
const res = await page.evaluate(async (t) => {
  const el = document.elementFromPoint(t.x, t.y);
  const fire = (type, x, y) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
  const frames = [];
  let last = performance.now();
  let raf;
  const tick = () => {
    const n = performance.now();
    frames.push(n - last);
    last = n;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  let selChanges = 0;
  const count = () => {
    selChanges++;
  };
  document.addEventListener('selectionchange', count, true);

  const t0 = performance.now();
  fire('mousedown', t.x, t.y);
  for (let i = 1; i <= 40; i++) {
    fire('mousemove', t.x + i * 9, t.y + i * 2);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const elapsed = performance.now() - t0;
  fire('mouseup', t.x + 360, t.y + 80);
  await new Promise((r) => requestAnimationFrame(r));
  cancelAnimationFrame(raf);
  document.removeEventListener('selectionchange', count, true);

  const gaps = frames.slice(1).filter((f) => f > 0).sort((a, b) => a - b);
  return {
    elapsed: +elapsed.toFixed(1),
    frames: gaps.length,
    p50: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
    p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
    max: +gaps[gaps.length - 1].toFixed(1),
    over32: gaps.filter((g) => g > 32).length,
    selChanges,
  };
}, t);
console.log('拖动 40 帧:', JSON.stringify(res));

// mouseup -> 浮层出现
await page.evaluate(() => {
  window.__t = {};
  const mo = new MutationObserver(() => {
    if (document.querySelector('.scpdf-selection-popover') && !window.__t.pop) {
      window.__t.pop = performance.now();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mousedown', () => { window.__t.down = performance.now(); }, true);
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 40, t.y + 5, { steps: 4 });
await page.waitForTimeout(50);
await page.mouse.up();
await page.waitForTimeout(400);
const pop = await page.evaluate(() => {
  const t = window.__t;
  return { downToPop: t.down && t.pop ? +(t.pop - t.down).toFixed(1) : null };
});
console.log('mousedown → 浮层出现:', JSON.stringify(pop));

await browser.close();
