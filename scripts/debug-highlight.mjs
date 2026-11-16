/**
 * 调试：高亮错位 + 遮挡问题。
 *
 * 检查：
 * 1) 高亮矩形的几何 vs 文本层 span 的几何（错位量）
 * 2) 高亮的 CSS（不透明度 / z-index / 层叠顺序）
 * 3) 文本层的 color/opacity（双层叠加变深）
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5181';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

// 1) 选一段文字（用真实鼠标拖选，触发容器的 mouseup）
const target = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => (x.textContent ?? '').trim().length > 20);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + r.height / 2 };
});

if (target) {
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 180, target.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}

const selText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
console.log('选中文字:', JSON.stringify(selText.slice(0, 40)));

// 2) 点"添加高亮"
const addBtn = page.locator('button[aria-label="添加高亮"]');
if ((await addBtn.count()) > 0) {
  await addBtn.click();
  await page.waitForTimeout(1500);
}

// 3) 对比高亮矩形 vs 文本 span
const analysis = await page.evaluate(() => {
  const hl = document.querySelector('.scpdf-annotation--mine');
  if (!hl) return { error: 'no highlight' };

  const hr = hl.getBoundingClientRect();
  const hlStyle = getComputedStyle(hl);

  // 找与高亮**重叠**的文本 span（重叠面积最大）
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  let best = null;
  let bestOverlap = 0;

  for (const s of spans) {
    const r = s.getBoundingClientRect();
    const ox = Math.min(hr.right, r.right) - Math.max(hr.left, r.left);
    const oy = Math.min(hr.bottom, r.bottom) - Math.max(hr.top, r.top);
    const overlap = ox * oy;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = { s, r };
    }
  }

  if (!best || bestOverlap <= 0) {
    return {
      error: '高亮与任何文本都不重叠',
      highlight: {
        left: Math.round(hr.left),
        top: Math.round(hr.top),
        width: Math.round(hr.width),
        height: Math.round(hr.height),
      },
      overlapCount: 0,
    };
  }

  const sr = best.r;

  // 文本层的样式
  const layer = document.querySelector('.scpdf-text-layer');
  const layerStyle = layer ? getComputedStyle(layer) : null;
  const itemStyle = getComputedStyle(best.s);

  // 层叠顺序：谁在上面
  const hlZ = hlStyle.zIndex;
  const layerZ = layerStyle?.zIndex ?? 'auto';

  return {
    highlight: {
      left: Math.round(hr.left * 10) / 10,
      top: Math.round(hr.top * 10) / 10,
      width: Math.round(hr.width * 10) / 10,
      height: Math.round(hr.height * 10) / 10,
      background: hlStyle.backgroundColor,
      opacity: hlStyle.opacity,
      zIndex: hlZ,
      mixBlendMode: hlStyle.mixBlendMode,
      pointerEvents: hlStyle.pointerEvents,
    },
    text: {
      text: (best.s.textContent ?? '').slice(0, 25),
      left: Math.round(sr.left * 10) / 10,
      top: Math.round(sr.top * 10) / 10,
      width: Math.round(sr.width * 10) / 10,
      height: Math.round(sr.height * 10) / 10,
      color: itemStyle.color,
      opacity: itemStyle.opacity,
    },
    layer: {
      color: layerStyle?.color,
      opacity: layerStyle?.opacity,
      zIndex: layerZ,
      mixBlendMode: layerStyle?.mixBlendMode,
    },
    // 错位量
    deltaLeft: Math.round((hr.left - sr.left) * 10) / 10,
    deltaTop: Math.round((hr.top - sr.top) * 10) / 10,
    deltaWidth: Math.round((hr.width - sr.width) * 10) / 10,
    deltaHeight: Math.round((hr.height - sr.height) * 10) / 10,
  };
});

console.log(JSON.stringify(analysis, null, 2));

// 4) 截图
await page.screenshot({ path: 'e2e-shots/highlight-debug.png' });

// 5) 放大看高亮区域
const clip = analysis?.highlight
  ? {
      x: Math.max(0, analysis.highlight.left - 40),
      y: Math.max(0, analysis.highlight.top - 40),
      width: Math.min(700, analysis.highlight.width + 80),
      height: Math.min(200, analysis.highlight.height + 80),
    }
  : undefined;
if (clip) {
  await page.screenshot({ path: 'e2e-shots/highlight-zoom.png', clip });
}

await browser.close();
