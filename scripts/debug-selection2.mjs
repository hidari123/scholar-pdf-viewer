/**
 * 调试：文本层 span 与 canvas 真实文字的位置对齐。
 *
 * 验证方式：
 * 1) 文本层 span 的位置（left/top/width）
 * 2) 该行文字在 PDF 里的真实起点（从 pdf.js 的 text item transform 算）
 * 3) 两者对比
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

// 对比：文本层 span 的位置 vs pdf.js 原始 text item 的位置
const comparison = await page.evaluate(async () => {
  // 找到第 1 页的文本层 span
  const layer = document.querySelector('.scpdf-text-layer');
  const spans = [...layer.querySelectorAll('.scpdf-text-layer__item')];

  // 取几个"看起来正常"的行（宽度在合理范围）
  const normal = spans.filter((s) => {
    const w = s.getBoundingClientRect().width;
    return w > 200 && w < 1200;
  });

  return {
    totalSpans: spans.length,
    normalCount: normal.length,
    // 宽度异常的（超长 = 多个 item 被错误合并到一行）
    oversized: spans
      .filter((s) => s.getBoundingClientRect().width > 2000)
      .map((s) => ({
        text: (s.textContent ?? '').slice(0, 40),
        width: Math.round(s.getBoundingClientRect().width),
        top: Math.round(s.getBoundingClientRect().top),
      })),
    // 正常行的位置（用于和 pdf.js 原始坐标对比）
    sample: normal.slice(0, 6).map((s) => {
      const r = s.getBoundingClientRect();
      const page = s.closest('.scpdf-page');
      const pr = page.getBoundingClientRect();
      return {
        text: (s.textContent ?? '').slice(0, 28),
        // 相对页面的坐标（应该等于 PDF 坐标 × scale）
        relLeft: Math.round(r.left - pr.left),
        relTop: Math.round(r.top - pr.top),
        width: Math.round(r.width),
        fontSize: getComputedStyle(s).fontSize,
      };
    }),
  };
});

console.log('--- 对比 ---');
console.log(JSON.stringify(comparison, null, 2));

// 再取 pdf.js 的原始数据对比
const raw = await page.evaluate(async () => {
  const response = await fetch('/samples/local.pdf');
  const data = new Uint8Array(await response.arrayBuffer());
  const pdfjs = await import('/node_modules/.vite/deps/pdfjs-dist.js').catch(() => null);
  if (!pdfjs) return { error: 'pdfjs 不可用' };

  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  // 取正文的前几个 item（跳过页眉）
  const items = content.items
    .filter((i) => 'transform' in i && i.str.trim().length > 0)
    .slice(0, 40)
    .map((i) => ({
      str: i.str.slice(0, 28),
      transform: i.transform.map((n) => Math.round(n * 100) / 100),
      width: i.width,
      hasEOL: i.hasEOL,
      fontHeight: i.height,
    }));

  return { viewportScale: viewport.scale, items };
});

console.log('\n--- pdf.js 原始 text item（前 12 个）---');
if (raw.error) {
  console.log(raw.error);
} else {
  for (const item of raw.items.slice(0, 12)) {
    console.log(
      `  "${item.str}" | transform=[${item.transform.join(', ')}] | w=${Math.round(item.width)} | h=${item.fontHeight} | EOL=${item.hasEOL}`,
    );
  }
}

await browser.close();
