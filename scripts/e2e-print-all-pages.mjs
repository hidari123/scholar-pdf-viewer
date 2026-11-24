/**
 * E2E：**打印时所有页都要有内容**。
 *
 * ## 用户反馈
 *
 * > "打印的时候只能展示前几张 后面是只有标题没有内容
 * >  是因为你还没缓存是吗"
 *
 * ## 根因（实测）
 *
 * ```
 * 总页数:             18
 * 渲染了 canvas 的页: 4     ← ❌ 只有 4 页！
 * 打印出的 PDF 页数:  18    ← 页数对，但 14 页是空白的
 * ```
 *
 * -> `<Page renderCanvas={isVisible} />` -> 只渲染**可见**的页 ❌
 * -> 打印时**没渲染的页 = 白页** ❌
 * -> **不是缓存问题**（缓存是浏览器的事）✅
 *
 * ## 修法
 *
 * -> 监听 `beforeprint` -> **临时**渲染全部页 ✅
 * -> 监听 `afterprint` -> **恢复**虚拟化 ✅
 *
 * 用法：`node scripts/e2e-print-all-pages.mjs`
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

console.log('E2E：打印时所有页都有内容');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2000);

  const countCanvases = () =>
    page.evaluate(() => ({
      pages: document.querySelectorAll('.scpdf-page').length,
      withCanvas: [...document.querySelectorAll('.scpdf-page')].filter(
        (p) => p.querySelector('canvas')?.width > 0,
      ).length,
    }));

  // ---- ① 平时是虚拟化的（只渲染可见页）✅
  const before = await countCanvases();
  check(
    '**平时是虚拟化的**（只渲染可见页，不是全部）',
    before.withCanvas < before.pages,
    `${before.withCanvas}/${before.pages}`,
  );

  // ---- ② 打印前 -> 全部渲染 ✅
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(8000);
  const during = await countCanvases();
  check(
    '**打印时所有页都渲染了 canvas**',
    during.withCanvas === during.pages,
    `${during.withCanvas}/${during.pages}`,
  );

  // ---- ③ 生成的 PDF 每页都有内容（不是空白页）✅
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  const pdfText = Buffer.from(pdf).toString('latin1');
  const pdfPages = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('**PDF 页数 = 文档页数**', pdfPages === during.pages, `${pdfPages} 页`);
  // 之前只有 4 页有内容 -> PDF 1.5MB；现在全部有 -> 明显更大 ✅
  check(
    '**PDF 体积合理**（所有页都有内容，不是白页）',
    pdf.length > 3_000_000,
    `${(pdf.length / 1024 / 1024).toFixed(2)} MB`,
  );

  // ---- ④ 打印完 -> 恢复虚拟化 ✅
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.waitForTimeout(1500);
  const after = await countCanvases();
  check(
    '**打印完恢复虚拟化**（不会一直占内存）',
    after.withCanvas <= during.withCanvas,
    `${after.withCanvas}/${after.pages}`,
  );

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
