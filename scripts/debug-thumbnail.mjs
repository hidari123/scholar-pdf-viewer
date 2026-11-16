/**
 * 调试：缩略图与原文的差异。
 *
 * 检查：
 * 1) 缩略图的宽高比 vs PDF 页面宽高比
 * 2) 缩略图渲染的 scale vs 主页面渲染的 scale
 * 3) 缩略图 canvas 的像素尺寸 vs CSS 尺寸（DPR 问题）
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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5186';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });

// 打开缩略图面板
const thumbBtn = page.locator('.scpdf-toolbar__btn[aria-label="缩略图"]');
if ((await thumbBtn.count()) > 0) {
  await thumbBtn.click();
  await page.waitForTimeout(4000);
}

const data = await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll('.scpdf-thumbnail__img')];
  const canvas = document.querySelector('.scpdf-page canvas.scpdf-canvas');
  const pageEl = document.querySelector('.scpdf-page');

  const thumbInfo = thumbs.slice(0, 4).map((img) => {
    const r = img.getBoundingClientRect();
    return {
      // 渲染出的实际像素尺寸
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      // CSS 显示尺寸
      cssWidth: Math.round(r.width),
      cssHeight: Math.round(r.height),
      aspect: Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000,
      cssAspect: Math.round((r.width / r.height) * 1000) / 1000,
      styleWidth: img.style.width,
      styleHeight: img.style.height,
    };
  });

  const cRect = canvas?.getBoundingClientRect();
  const pRect = pageEl?.getBoundingClientRect();

  return {
    devicePixelRatio: window.devicePixelRatio,
    thumbs: thumbInfo,
    mainCanvas: cRect
      ? {
          cssWidth: Math.round(cRect.width),
          cssHeight: Math.round(cRect.height),
          aspect: Math.round((cRect.width / cRect.height) * 1000) / 1000,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          pixelAspect: Math.round((canvas.width / canvas.height) * 1000) / 1000,
        }
      : null,
    pageBox: pRect
      ? {
          cssWidth: Math.round(pRect.width),
          cssHeight: Math.round(pRect.height),
          aspect: Math.round((pRect.width / pRect.height) * 1000) / 1000,
        }
      : null,
  };
});

console.log('--- 缩略图 ---');
console.log(JSON.stringify(data, null, 2));

await browser.close();
