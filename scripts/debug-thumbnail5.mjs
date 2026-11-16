/**
 * 调试：缩略图 vs 主页面渲染 —— 同一页、同一相对尺寸下对比内容边界。
 *
 * 关键：如果主页面渲染的内容占满整页，而缩略图不满，
 *       说明是缩略图渲染路径的问题。
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

const result = await page.evaluate(async () => {
  const pdfjs = await import('/node_modules/.vite/deps/pdfjs-dist.js');
  pdfjs.GlobalWorkerOptions.workerSrc =
    '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';

  const response = await fetch('/samples/local.pdf');
  const data = new Uint8Array(await response.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  /** 渲染并测内容边界 */
  async function renderMeasure(pageNumber, scale, label) {
    const p = await doc.getPage(pageNumber);
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (img[i] < 245 || img[i + 1] < 245 || img[i + 2] < 245) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      label,
      canvas: `${canvas.width}x${canvas.height}`,
      box: maxX < 0 ? '空白' : `${minX},${minY}→${maxX},${maxY}`,
      leftMarginPct: maxX < 0 ? 0 : Math.round((minX / canvas.width) * 1000) / 10,
      bottomMarginPct: maxX < 0 ? 0 : Math.round(((canvas.height - maxY - 1) / canvas.height) * 1000) / 10,
    };
  }

  const out = [];
  // 主页面用的是 227% 缩放
  out.push(await renderMeasure(1, 2.27, '页1 @227% (主页面同 scale)'));
  out.push(await renderMeasure(1, 120 / 612, '页1 @缩略图 scale'));
  out.push(await renderMeasure(2, 2.27, '页2 @227%'));
  out.push(await renderMeasure(2, 120 / 612, '页2 @缩略图 scale'));

  return out;
});

console.log(JSON.stringify(result, null, 2));

await browser.close();
