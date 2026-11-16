/**
 * 调试：缩略图与原文的**内容**差异（不只是尺寸）。
 *
 * 截取缩略图面板的截图 + 主页面截图，肉眼对比。
 * 同时把缩略图放大，看是否内容被裁切/错位。
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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5186';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });

const thumbBtn = page.locator('.scpdf-toolbar__btn[aria-label="缩略图"]');
if ((await thumbBtn.count()) > 0) {
  await thumbBtn.click();
  await page.waitForTimeout(5000);
}

// 1) 缩略图面板截图
const panel = page.locator('.scpdf-panel--thumbnails');
if ((await panel.count()) > 0) {
  await panel.screenshot({ path: 'e2e-shots/thumb-panel.png' });
}

// 2) 把第 1 张缩略图单独截出来（放大看）
const first = page.locator('.scpdf-thumbnail__img').first();
if ((await first.count()) > 0) {
  const src = await first.getAttribute('src');
  const buf = Buffer.from(src.split(',')[1], 'base64');
  const { writeFileSync } = await import('node:fs');
  writeFileSync('e2e-shots/thumb-raw.jpg', buf);
  console.log(
    '缩略图原始尺寸:',
    await first.evaluate((el) => `${el.naturalWidth}x${el.naturalHeight}`),
  );
}

// 3) 主页面第 1 页截图（同样大小以便对比）
const pageBox = page.locator('.scpdf-page').first();
if ((await pageBox.count()) > 0) {
  await pageBox.screenshot({ path: 'e2e-shots/page-raw.png' });
  const box = await pageBox.boundingBox();
  console.log('主页面尺寸:', box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'n/a');
}

await browser.close();
