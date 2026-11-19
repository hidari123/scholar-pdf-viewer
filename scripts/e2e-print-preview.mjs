/**
 * E2E：**打印预览**（用户反馈"目前的打印预览效果还是不对"）。
 *
 * ## 修了哪些 bug
 *
 * 1. **打印变量只在 `print()` 里写** → Ctrl+P（浏览器的打印预览）拿不到 → **页被裁掉**
 * 2. **CSS 变量名对不上**：JS 写 `--scpdf-print-page-height`，CSS 读 `--scpdf-page-height`
 *    → 变量永远取不到 → 布局盒没缩 → **一堆空白页**
 * 3. **缩放算的是"物理比例"**（0.861）却乘到**屏幕像素**（1408）上
 *    → 缩出来 322mm ≫ A4 → **18 页印成 33 页**
 * 4. **内联样式盖过打印 CSS** → `height: auto` / `transform` 都不生效
 * 5. **`transform: scale()` + `calc()` 缩两次** → 视觉缩过头
 * 6. **`zoom` 加在页上** → canvas 被继承又缩一次 → **canvas 比页还宽** → 右边被裁掉
 *
 * ## 验证什么
 *
 * 1. `--scpdf-print-scale` **一直存在**（不点打印按钮也有）→ Ctrl+P 也能用
 * 2. 页的**视觉尺寸 == canvas 的尺寸**（没有被裁掉）
 * 3. 打印出来的 PDF **页数 == 原 PDF 页数**（没有多余的空白页）
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { E2E_BASE_URL } from './e2e-base.mjs';

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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const outDir = join(process.cwd(), '.tmp-e2e-print');
mkdirSync(outDir, { recursive: true });

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2000);

  const domPageCount = await page.evaluate(() => document.querySelectorAll('.scpdf-page').length);

  // ---- 1. 不点打印按钮，变量也应该在 ----
  const scaleVar = await page.evaluate(() => {
    const root = document.querySelector('.scpdf-root');
    return root?.style.getPropertyValue('--scpdf-print-scale') ?? '';
  });
  check(
    '**打印缩放变量一直存在**（不点打印按钮也有 → Ctrl+P 也能用）',
    scaleVar !== '' && Number.parseFloat(scaleVar) > 0 && Number.parseFloat(scaleVar) < 1,
    scaleVar,
  );

  // ---- 2. 打印态：页和 canvas 的尺寸一致 ----
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(1200);

  const printGeom = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-page');
    const c = p?.querySelector('canvas');
    if (!p || !c) return null;
    const pr = p.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const pages = [...document.querySelectorAll('.scpdf-page')];
    const tops = pages.map((x) => Math.round(x.getBoundingClientRect().top));
    return {
      pageW: Math.round(pr.width),
      pageH: Math.round(pr.height),
      canvasW: Math.round(cr.width),
      canvasH: Math.round(cr.height),
      pageCount: pages.length,
      firstTops: tops.slice(0, 4),
      pagesContainerH: Math.round(
        document.querySelector('.scpdf-pages')?.getBoundingClientRect().height ?? 0,
      ),
    };
  });

  if (!printGeom) {
    check('找到页和 canvas', false);
  } else {
    console.log(`  打印态几何: ${JSON.stringify(printGeom)}`);
    check(
      '**页和 canvas 的宽度一致**（内容没被裁掉）',
      Math.abs(printGeom.pageW - printGeom.canvasW) <= 2,
      `page=${printGeom.pageW} canvas=${printGeom.canvasW}`,
    );
    check(
      '**页和 canvas 的高度一致**',
      Math.abs(printGeom.pageH - printGeom.canvasH) <= 2,
      `page=${printGeom.pageH} canvas=${printGeom.canvasH}`,
    );

    // 页间距应该 ≈ 页高 + 12px（缩放后的）→ 没有大段空白
    const gap = printGeom.firstTops[1] - printGeom.firstTops[0];
    check(
      '**页之间没有大段空白**（间距 ≈ 页高）',
      gap > 0 && gap <= printGeom.pageH + 30,
      `间距=${gap} 页高=${printGeom.pageH}`,
    );

    check(
      '**页容器的高度是缩放后的**（不是未缩放的 33093px）',
      printGeom.pagesContainerH < printGeom.pageH * printGeom.pageCount * 1.2,
      `${printGeom.pagesContainerH}px`,
    );
  }

  // ---- 3. 真实打印：页数应该 == 原 PDF 页数 ----
  const pdfPath = join(outDir, 'print.pdf');
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });

  const { PDFDocument } = await import('pdf-lib');
  const bytes = readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes);
  const printedPages = doc.getPages().length;

  console.log(`  原 PDF ${domPageCount} 页 → 打印出来 ${printedPages} 页`);
  check(
    '**打印的页数 == 原 PDF 页数**（没有多余的空白页）',
    printedPages === domPageCount,
    `${domPageCount} → ${printedPages}`,
  );

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
