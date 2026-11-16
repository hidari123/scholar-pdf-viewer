/**
 * 调试：选区高亮的"阶梯状重叠"。
 *
 * 用户截图显示: 选中的多行文字, 每行的选区矩形**互相重叠**,
 * 形成阶梯状的深浅不一。
 *
 * 假设: range.getClientRects() 返回的每行矩形**高度 > 行间距**,
 *       所以相邻行的矩形在垂直方向重叠 -> ::selection 叠加 -> 变深。
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function resolveChromium() {
  const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const dirs = readdirSync(cacheRoot)
    .filter((n) => n.startsWith('chromium-'))
    .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
    .sort((a, b) => b.v - a.v);
  for (const d of dirs) {
    const exe = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5193';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

// 拖选多行
const target = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  // 找正文里连续的 span（多行）
  const el = spans.find((x) => {
    const r = x.getBoundingClientRect();
    return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + r.height / 2 };
});

if (target) {
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 400, target.y + 120, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

const data = await page.evaluate(() => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { error: 'no selection' };

  const rects = [...sel.getRangeAt(0).getClientRects()].map((r) => ({
    left: Math.round(r.left),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }));

  // 相邻矩形的垂直重叠量
  const overlaps = [];
  for (let i = 1; i < rects.length; i++) {
    const prev = rects[i - 1];
    const cur = rects[i];
    const overlap = prev.bottom - cur.top;
    if (overlap > 0) {
      overlaps.push({
        between: `${i - 1}→${i}`,
        overlapPx: Math.round(overlap),
        prevHeight: prev.height,
        curHeight: cur.height,
        gap: cur.top - prev.bottom,
      });
    }
  }

  // 文本层 span 的行高/基线
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const spanInfo = spans
    .map((s) => {
      const r = s.getBoundingClientRect();
      return { text: (s.textContent ?? '').slice(0, 20), top: Math.round(r.top), h: Math.round(r.height) };
    })
    .filter((s) => s.top > 250 && s.top < 700)
    .slice(0, 8);

  return {
    text: sel.toString().slice(0, 40),
    rectCount: rects.length,
    rects: rects.slice(0, 8),
    overlaps,
    spanInfo,
  };
});

console.log(JSON.stringify(data, null, 2));

// 截图放大
const clip = await page.evaluate(() => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top - 20), width: Math.min(650, r.width + 40), height: Math.min(300, r.height + 40) };
});
if (clip) {
  await page.screenshot({ path: 'e2e-shots/overlap-zoom.png', clip });
  console.log('\n已截图: e2e-shots/overlap-zoom.png');
}

await browser.close();
