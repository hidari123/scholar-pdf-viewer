/**
 * E2E：**导出带高亮的 PDF —— 批注文字的编码**。
 *
 * 用户反馈："导出带高亮的pdf之后 hover到pdf的高亮上会出来乱码批注 明明没有批注"
 *
 * ## 根因
 *
 * ```ts
 * dict.set(PDFName.of('Contents'), PDFHexString.of(contents));
 * ```
 *
 * → `PDFHexString.of` 把字符串**当原始字节**写进 PDF
 * → 阅读器按 **PDFDocEncoding** 解码 → 中文全变乱码
 * → 用户 hover 高亮 → 弹出的批注提示是乱码
 *
 * ## 修法
 *
 * → 用 `PDFHexString.fromText()`（**UTF-16BE + BOM**）→ 阅读器能正确识别
 *
 * ## 验证什么
 *
 * 1. 导出的 PDF 里，`/Contents` 是 **UTF-16BE + BOM**（`FEFF` 开头）
 * 2. 用 pdf-lib 读回来 → 能**解码出正确的中文**（不是乱码）
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

const downloadDir = join(process.cwd(), '.tmp-e2e-encoding');
rmSync(downloadDir, { recursive: true, force: true });
mkdirSync(downloadDir, { recursive: true });

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
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
  await page.waitForTimeout(1200);

  /*
   * ⚠️ **这个 E2E 专门测 `/Contents` 的编码**
   * -> 第 27 轮改成**默认不写** `/Contents`  （Chrome hover 不出黄色便签）
   * -> -> 这里**显式打开**
   */
  await page.evaluate(() => {
    // @ts-expect-error 测试用的全局句柄
    window.__scpdfDemo?.setIncludeAnnotationText?.(true);
  });
  await page.waitForTimeout(600);

  // ---- 加一条高亮 ----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return fs >= 12 && r.top > 250 && r.top < 500 && r.width > 150;
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  });

  if (!t) {
    check('找到可拖选的正文', false);
  } else {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 200, t.y + 60, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    const addBtn = page.getByRole('button', { name: '添加高亮', exact: true });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(900);
    }

    const highlightCount = await page.evaluate(
      () => document.querySelectorAll('.scpdf-annotation').length,
    );
    check('先加一条高亮', highlightCount > 0, `${highlightCount} 个`);
  }

  // ---- 导出 ----
  const exportBtn = page.getByRole('button', { name: '导出带高亮的 PDF' });
  if ((await exportBtn.count()) === 0) {
    check('找到"导出带高亮的 PDF"按钮', false);
  } else {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      exportBtn.first().click(),
    ]);

    if (!download) {
      check('**触发了下载**', false, '没有 download 事件');
    } else {
      const filePath = join(downloadDir, download.suggestedFilename());
      await download.saveAs(filePath);
      check('**触发了下载**', true, download.suggestedFilename());

      const bytes = readFileSync(filePath);
      const _raw = bytes.toString('latin1');

      /*
       * ⚠️ **不能只在原始字节里搜**（PDF 用对象流压缩）。
       * → 必须用 pdf-lib 读回来。
       */
      const { PDFDocument, PDFName } = await import('pdf-lib');
      const reloaded = await PDFDocument.load(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );

      let contentsHex = null;
      let decoded = null;
      for (const p of reloaded.getPages()) {
        const annotsArray = p.node.get(PDFName.of('Annots'));
        const refs = annotsArray?.asArray?.() ?? [];
        for (const ref of refs) {
          const dict = reloaded.context.lookup(ref);
          const subtype = String(dict?.get(PDFName.of('Subtype')) ?? '');
          if (!subtype.includes('Highlight')) continue;
          const raw2 = dict.get(PDFName.of('Contents'));
          if (raw2) {
            contentsHex = String(raw2);
            // 用 pdf-lib 的解码器还原 → 应该是原文，不是乱码
            try {
              const asString = raw2.asString?.() ?? String(raw2);
              decoded = asString;
            } catch {
              decoded = null;
            }
          }
        }
      }

      console.log(`  /Contents 原始值: ${contentsHex}`);

      check('**批注里有 /Contents**（hover 会显示的文字）', contentsHex !== null);
      check(
        '**是 UTF-16BE + BOM**（FEFF 开头 → 阅读器能正确识别中文）',
        contentsHex !== null && /FEFF/i.test(contentsHex),
        contentsHex?.slice(0, 24),
      );
      check(
        '**没有裸的中文字符**（`of` 写出来的就是乱码源）',
        contentsHex !== null && !/[一-龥]/.test(contentsHex),
      );
      check(
        '**解码出来是原文**（不是乱码）',
        decoded !== null && !/[�]/.test(decoded),
        decoded?.slice(0, 30),
      );
    }
  }

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error).slice(0, 200));
} finally {
  await browser.close();
  rmSync(downloadDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
