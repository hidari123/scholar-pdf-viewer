/**
 * 调试：缩略图内容偏移的根因。
 *
 * 假设：pdf.js v6 的 viewport 有 offsetCanvas（用于页面旋转/裁剪），
 *      渲染到非默认尺寸的 canvas 时需要手动应用 transform。
 *
 * 验证：打印 viewport 的所有属性，并测试"手动应用 offsetCanvas"的效果。
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

  // viewport 的所有属性
  const viewportProps = {};
  for (const key of Object.keys(viewport)) {
    const v = viewport[key];
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      viewportProps[key] = v;
    } else if (Array.isArray(v)) {
      viewportProps[key] = v.map((n) => Math.round(n * 1000) / 1000);
    } else if (v && typeof v === 'object' && 'transform' in v) {
      viewportProps[key] = { transform: v.transform, width: v.width, height: v.height };
    } else {
      viewportProps[key] = typeof v;
    }
  }

  /** 测内容边界 */
  async function measure(label, canvasW, canvasH, applyOffset, preTransform) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    if (preTransform) {
      ctx.setTransform(...preTransform);
    }

    const params = { canvas, canvasContext: ctx, viewport };
    await p.render(params).promise;

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
      canvas: `${canvasW}x${canvasH}`,
      box: maxX < 0 ? '空白' : `${minX},${minY}→${maxX},${maxY}`,
      fillPct: maxX < 0 ? 0 : Math.round(((maxX - minX + 1) / canvas.width) * 1000) / 10,
      fillYPct: maxX < 0 ? 0 : Math.round(((maxY - minY + 1) / canvas.height) * 1000) / 10,
      applyOffset,
    };
  }

  const results = [];
  results.push(await measure('基线(120x156)', 120, 156, false, null));
  results.push(await measure('canvas 精确=ceil(viewport)', Math.ceil(viewport.width), Math.ceil(viewport.height), false, null));

  // 关键：viewport.transform 是 [scale,0,0,-scale,0,height]
  // 若 canvas 尺寸 != viewport 尺寸，需要按比例缩放 context
  const sx = 120 / viewport.width;
  const sy = 156 / viewport.height;
  results.push(
    await measure('按比例 setTransform', 120, 156, false, [sx, 0, 0, sy, 0, 0]),
  );

  // 检查 viewport.transform 与 offsetCanvas
  return {
    viewportProps,
    results,
    pageRotate: p.rotate,
  };
});

console.log(JSON.stringify(result, null, 2));

await browser.close();
