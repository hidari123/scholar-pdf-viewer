/**
 * 调试：缩略图内容不满幅的原因。
 *
 * 假设：pdf.js v6 的 page.render 忽略了传入的 viewport，
 *      而是用 canvas 的尺寸（或某种默认值）来渲染 → 内容不满幅。
 *
 * 验证：分别用不同的 canvas 尺寸渲染同一页，
 *      看输出图片的内容边界是否一致。
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
  const p = await doc.getPage(2);

  const base = p.getViewport({ scale: 1 });
  const scale = 120 / base.width;
  const viewport = p.getViewport({ scale });

  /** 渲染并返回内容边界（非白像素的范围） */
  async function renderAndMeasure(label, canvasW, canvasH, useViewport, passCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    const params = { canvasContext: ctx };
    if (passCanvas) params.canvas = canvas;
    if (useViewport) params.viewport = viewport;

    await p.render(params).promise;

    // 扫描像素找内容边界
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        // 非白像素
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
      canvas: `${canvasW}x${canvasH}`,
      viewport: useViewport ? `${viewport.width.toFixed(1)}x${viewport.height.toFixed(1)}` : '无',
      contentBox:
        maxX < 0
          ? '空白'
          : `${minX},${minY} → ${maxX},${maxY} (${maxX - minX + 1}x${maxY - minY + 1})`,
      contentBottomPct:
        maxX < 0 ? 0 : Math.round(((maxY + 1) / canvas.height) * 1000) / 10,
      contentRightPct:
        maxX < 0 ? 0 : Math.round(((maxX + 1) / canvas.width) * 1000) / 10,
    };
  }

  const results = [];
  // pdf.js v6 必须有 viewport（否则 beginDrawing 报错）
  // A: 当前 demo 的做法（传 canvas + viewport，canvas 尺寸=viewport）
  results.push(
    await renderAndMeasure(
      '当前做法(canvas=viewport 尺寸)',
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
      true,
      true,
    ),
  );
  // B: canvas 尺寸比 viewport 大（多出白边）
  results.push(await renderAndMeasure('canvas 更大(300x400)', 300, 400, true, true));
  // C: canvas 尺寸比 viewport 小
  results.push(await renderAndMeasure('canvas 更小(60x78)', 60, 78, true, true));
  // D: 不传 canvas（只有 context）
  results.push(
    await renderAndMeasure(
      '不传 canvas',
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
      true,
      false,
    ),
  );
  // E: 用 scale=1 的 viewport（原始尺寸）配小 canvas
  // pdf.js v6 必须有 viewport，否则 beginDrawing 报 transform undefined

  return { viewport: `${viewport.width.toFixed(2)}x${viewport.height.toFixed(2)}`, results };
});

console.log(JSON.stringify(result, null, 2));

await browser.close();
