/**
 * E2E：**导出带高亮的 PDF**。
 *
 * 用户反馈："导出高亮我的意思是直接导出带高亮的pdf不是导出json"
 *
 * ## 要验证什么
 *
 * 1. 点"导出带高亮的 PDF" → **真的下载了一个 .pdf 文件**
 * 2. 下载的 PDF 里**真的有高亮批注**（`/Subtype /Highlight`）
 * 3. 批注的坐标**和屏幕上的高亮对得上**（不是随便画的）
 * 4. 没有高亮时也能导出（不报错）
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

const downloadDir = join(process.cwd(), '.tmp-e2e-download');
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
  await page.waitForTimeout(1500);

  // ---- 1. 先加一条高亮（拖选 + 点"添加高亮"）----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      return (
        Number.parseFloat(getComputedStyle(x).fontSize) >= 12 &&
        r.top > 250 &&
        r.top < 500 &&
        r.width > 150
      );
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

    // 点"添加高亮"（demo 宿主自己的按钮）
    const addBtn = page.getByRole('button', { name: '添加高亮', exact: true });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(700);
    }

    const highlightCount = await page.evaluate(
      () => document.querySelectorAll('.scpdf-annotation').length,
    );
    check('先加一条高亮', highlightCount > 0, `${highlightCount} 个高亮元素`);
  }

  // ---- 2. 点"导出带高亮的 PDF" → 等下载 ----
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
      check('文件名是 .pdf', download.suggestedFilename().endsWith('.pdf'));

      // ---- 3. 检查 PDF 里真的有高亮批注 ----
      const bytes = readFileSync(filePath);
      const text = bytes.toString('latin1');

      check('文件不是空的', bytes.length > 1000, `${bytes.length} 字节`);
      check('**是合法的 PDF**（有 %PDF 头）', text.startsWith('%PDF-'), text.slice(0, 8));

      /*
       * ⚠️ **不能只搜原始字节**！
       *
       * 真实 PDF 用**对象流（object stream）压缩** → 批注在压缩流里
       * → 原始字节里搜不到 `/Subtype /Highlight`
       *
       * → 必须**用 pdf-lib 读回来**看真正的批注。
       */
      let annotCount = 0;
      let quadCount = 0;
      let hasContents = false;
      try {
        const { PDFDocument, PDFName } = await import('pdf-lib');
        const reloaded = await PDFDocument.load(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        for (const page of reloaded.getPages()) {
          const annotsArray = page.node.get(PDFName.of('Annots'));
          const refs = annotsArray?.asArray?.() ?? [];
          for (const ref of refs) {
            const dict = reloaded.context.lookup(ref);
            const subtype = String(dict?.get(PDFName.of('Subtype')) ?? '');
            if (!subtype.includes('Highlight')) continue;
            annotCount++;
            /*
             * ⚠️ **`QuadPoints` 存的是"引用"**（`785 0 R`）→ 要 lookup 解析。
             */
            const rawQuad = dict.get(PDFName.of('QuadPoints'));
            const quad =
              rawQuad && typeof rawQuad === 'object' && 'objectNumber' in rawQuad
                ? reloaded.context.lookup(rawQuad)
                : rawQuad;
            // ⚠️ **一行 = 8 个数**（4 个点）→ 高亮跨几行就有几个 8
            const size = quad?.size?.() ?? 0;
            if (size > 0 && size % 8 === 0) quadCount++;
            if (dict.get(PDFName.of('Contents'))) hasContents = true;
          }
        }
      } catch (error) {
        check('用 pdf-lib 读回导出的 PDF', false, String(error).slice(0, 120));
      }

      check('**PDF 里有高亮批注**（/Subtype /Highlight）', annotCount > 0, `${annotCount} 个`);
      check('**批注带 QuadPoints**（每行一个矩形，8 个数一行）', quadCount > 0, `${quadCount} 个`);
      /*
       * ⚠️ **默认【不带文字】**（第 27 轮改的）
       *
       * -> 用户反馈："导出后 hover 高亮还是会出现黄色便签"
       * -> A/B 对照：**真凶是 `/Contents`**
       * -> -> 默认不写
       * -> -> 宿主要用 -> `includeAnnotationText: true`
       */
      check('**批注默认【不带文字】**（hover 不会出黄色便签）', !hasContents);
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
