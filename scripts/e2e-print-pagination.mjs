/**
 * E2E：**打印要一页一张纸**。
 *
 * ## 用户反馈
 *
 * > "打印还是只能看到前几页 都是之前页面缓存过的才能看到
 * >  而且横向打印有很多空白页"
 *
 * ## 真因（实测）
 *
 * -> 缩放在 **`.scpdf-pages`** 上 ❌
 * -> 页的宽高是**内联样式**（`style={{ width, height }}`）❌
 * -> **Chrome 的打印分页按 layout box 算** ❌
 *    -> 页的 computed height 还是 **1821px** ❌
 *    -> 一张 A4 只有 1032px ❌ -> 每页占 **2 张纸** ❌
 * -> -> 18 页印成 **16~36 张**，后面全是空白 ❌
 *
 * ## 修法
 *
 * -> 打印时用 **`calc()` 把页的宽高写死成"原尺寸 × 缩放"** ✅
 * -> canvas 也是内联尺寸 -> 打印时拉回 **100%** ✅
 *
 * 用法：`node scripts/e2e-print-pagination.mjs`
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5180';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
let executablePath;
try {
  for (const dir of readdirSync(cacheRoot)) {
    if (!dir.startsWith('chromium-')) continue;
    const candidate = join(cacheRoot, dir, 'chrome-win64', 'chrome.exe');
    if (existsSync(candidate)) {
      executablePath = candidate;
      break;
    }
  }
} catch {
  // 用 playwright 自带的
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1442, height: 732 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('E2E：打印要一页一张纸');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2500);

  const pageCount = await page.evaluate(() => document.querySelectorAll('.scpdf-page').length);
  check('**PDF 有多页**', pageCount > 3, `${pageCount} 页`);

  // 触发打印模式（和真实打印一样）
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeprint'));
  });
  await page.waitForTimeout(6000);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(1500);

  // ---------- ① 页的尺寸要真的被缩放 ----------
  const sizes = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.scpdf-page')];
    const first = all[0];
    const cs = first ? getComputedStyle(first) : null;
    const canvas = document.querySelector('.scpdf-canvas');
    const ccs = canvas ? getComputedStyle(canvas) : null;
    return {
      pageCount: all.length,
      computedH: Number.parseFloat(cs?.height ?? '0'),
      computedW: Number.parseFloat(cs?.width ?? '0'),
      inlineH: Number.parseFloat(first?.style.height ?? '0'),
      inlineW: Number.parseFloat(first?.style.width ?? '0'),
      canvasW: Number.parseFloat(ccs?.width ?? '0'),
      canvasH: Number.parseFloat(ccs?.height ?? '0'),
    };
  });
  console.log('   尺寸:', JSON.stringify(sizes));

  check(
    '**页的 layout box 被缩放了**（分页算法看的就是这个）',
    sizes.computedH > 0 && sizes.computedH < sizes.inlineH * 0.9,
    `computed=${Math.round(sizes.computedH)} 内联=${Math.round(sizes.inlineH)}`,
  );
  check(
    '**canvas 跟着页缩**（不裁右边）',
    sizes.canvasW > 0 && sizes.canvasW <= sizes.computedW + 2,
    `canvas=${Math.round(sizes.canvasW)} 页=${Math.round(sizes.computedW)}`,
  );

  // ---------- ② 每页的高度要放得进一张纸 ----------
  //
  // ⚠️ **不能只按"位置"算分页** ❌
  // -> `break-after: page` 会让每页**从新的一张纸开始** ✅
  // -> 所以真正的判据是"**一页的高度 <= 一张纸的高度**" ✅
  const pagination = await page.evaluate(() => {
    // A4 纵向去掉 12mm 边距 = 703 × 1032 px @96dpi
    const paperH = 1032;
    const all = [...document.querySelectorAll('.scpdf-page')];
    const heights = all.map((p) => Math.round(p.getBoundingClientRect().height));
    return {
      total: all.length,
      maxHeight: Math.max(...heights),
      tooTall: all
        .filter((p) => p.getBoundingClientRect().height > paperH)
        .map((p) => p.getAttribute('data-page-number')),
    };
  });
  console.log('   分页:', JSON.stringify(pagination));

  check(
    '**每页都放得进一张纸**（高度 <= 可印高度）',
    pagination.tooTall.length === 0,
    pagination.tooTall.length
      ? `太高的页: ${pagination.tooTall.join(',')}`
      : `最高 ${pagination.maxHeight}px`,
  );
  check(
    '**页高明显被缩过了**（原来 1822px）',
    pagination.maxHeight < 1032,
    `${pagination.maxHeight}px`,
  );

  // ---------- ③ 生成真的打印 PDF（竖向）----------
  {
    const pdf = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync('e2e-shots/print-portrait.pdf', pdf);

    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdf);
    const sheets = doc.getPages().length;
    check(
      '**竖向打印：纸数 == PDF 页数**',
      sheets === pageCount,
      `${sheets} 张纸 / ${pageCount} 页`,
    );
  }

  // ---------- ④ 横向打印（宿主指定 printOrientation="landscape"）----------
  //
  // ⚠️ **横向时缩放必须按【横向纸张】算** ✅
  // -> 横向 A4 的可印区是 297 × 210mm（不是 210 × 297）✅
  // -> 不换 -> 按纵向的高度算 -> 缩放太大 ❌ -> 每页占 2 张纸 ❌
  // -> 实测（修复前）：18 页印成 **36 张** ❌
  await page.emulateMedia({ media: null });
  await page.evaluate(() => {
    // @ts-expect-error 测试用的全局句柄
    window.__scpdfDemo?.setPrintOrientation?.('landscape');
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeprint'));
  });
  await page.waitForTimeout(6000);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(1500);

  const landscapeSizes = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.scpdf-page')];
    const first = all[0];
    const cs = first ? getComputedStyle(first) : null;
    return {
      computedH: Number.parseFloat(cs?.height ?? '0'),
      computedW: Number.parseFloat(cs?.width ?? '0'),
      maxHeight: Math.max(...all.map((p) => p.getBoundingClientRect().height)),
      count: all.length,
    };
  });
  console.log('   横向:', JSON.stringify(landscapeSizes));

  // 横向 A4 的可印高度 = 210mm - 24mm = 186mm = 703px @96dpi
  check(
    '**横向：每页放得进横向的纸**（高度 <= 703px）',
    landscapeSizes.maxHeight <= 703,
    `最高 ${Math.round(landscapeSizes.maxHeight)}px`,
  );
  // ⚠️ **横向的页仍然是【竖版形状】** ✅
  // -> 缩放按"高度"算（703px 可印高）✅
  // -> 宽度就只剩 543px ✅
  // -> **不需要旋转** ✅（用户看到的是"竖版内容印在横向纸上"✅）
  check(
    '**横向：缩放按【横向纸张的高度】算**',
    landscapeSizes.computedH <= 703 && landscapeSizes.computedH > 690,
    `${Math.round(landscapeSizes.computedW)} × ${Math.round(landscapeSizes.computedH)}`,
  );
  check(
    '**横向：比纵向缩得更小**',
    landscapeSizes.computedH < 910,
    `纵向 910 -> 横向 ${Math.round(landscapeSizes.computedH)}`,
  );

  {
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync('e2e-shots/print-landscape.pdf', pdf);

    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdf);
    const sheets = doc.getPages().length;
    check(
      '**横向打印：纸数 == PDF 页数**',
      sheets === pageCount,
      `${sheets} 张纸 / ${pageCount} 页`,
    );
  }

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
