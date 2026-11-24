/**
 * E2E：**打印时不能出现便签和浮层**（隐私）。
 *
 * ## 用户反馈
 *
 * > "导出带高亮的pdf的时候 如果悬浮在pdf上 会有黄色框的便签展示出高亮pdf的内容
 *   不要这个 排查一下是什么问题"
 *
 * ## 根因（实测，打印媒体下）
 *
 * ```
 * stickyNotes:  { display: "block", visibility: "visible" }  ❌ 没藏
 * stickyIcon:   { display: "flex",  visibility: "visible" }  ❌ 黄色便签框会印出来
 * annotations:  { display: "none" }                         ✅ 高亮藏对了
 * ```
 *
 * -> 打印 CSS 的隐藏清单里**有** `.scpdf-annotations`（高亮）✅
 * -> 但**没有** `.scpdf-sticky-notes`（便签）❌
 * -> 便签带着**批注正文**（用户的私人内容）-> **会被打印出来** ❌
 *
 * ## 修法
 *
 * -> 把**所有浮层**（便签 / 详情面板 / 批注弹窗 / 链接弹窗 / 颜色面板）都加进隐藏清单 ✅
 *
 * 用法：`node scripts/e2e-print-hide-overlays.mjs`
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

console.log('E2E：打印时便签和浮层都被藏起来');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1500);

  /** 拖选一段文字 */
  const dragSelect = async (y, len = 60) => {
    const t = await page.evaluate((yy) => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
        (s) => (s.textContent ?? '').trim().length > 20,
      );
      const sp = spans.find((s) => {
        const r = s.getBoundingClientRect();
        return r.width > r.height * 2 && r.top > yy && r.top < yy + 150;
      });
      if (!sp) return null;
      const r = sp.getBoundingClientRect();
      return { x: r.x + 4, y: r.y + r.height / 2 };
    }, y);
    if (!t || typeof t.x !== 'number' || typeof t.y !== 'number') {
      console.log('  FAIL 拖选失败（没找到文字）');
      return false;
    }
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + len, t.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    return true;
  };

  // ---- ① 建一条带内容的批注 ----
  await dragSelect(250);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('批注'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    ed?.focus();
    document.execCommand('insertText', false, '机密内容SECRET123');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-annotation-dialog__btn')].find((x) =>
      /保存|Save/i.test(x.getAttribute('aria-label') ?? x.textContent ?? ''),
    );
    b?.click();
  });
  await page.waitForTimeout(2200);

  const hasNote = await page.evaluate(() => !!document.querySelector('.scpdf-sticky-notes'));
  check('**建好了一条便签**', hasNote);

  // ---- ② 切到打印媒体 ----
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(500);

  const visibility = await page.evaluate(() => {
    const display = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : null;
    };
    return {
      stickyNotes: display('.scpdf-sticky-notes'),
      annotations: display('.scpdf-annotations'),
      toolbar: display('.scpdf-toolbar'),
      textLayer: display('.scpdf-text-layer'),
      panel: display('.scpdf-annotation-panel'),
      dialog: display('.scpdf-annotation-dialog'),
      palette: display('.scpdf-rich-text__palette'),
    };
  });

  check(
    '**打印时便签被藏起来**（不会泄露批注正文）',
    visibility.stickyNotes === 'none',
    String(visibility.stickyNotes),
  );
  check(
    '**打印时高亮被藏起来**',
    visibility.annotations === 'none',
    String(visibility.annotations),
  );
  check('**打印时工具栏被藏起来**', visibility.toolbar === 'none', String(visibility.toolbar));
  check('**打印时文本层被藏起来**', visibility.textLayer === 'none', String(visibility.textLayer));
  check(
    '**打印时详情面板被藏起来**',
    visibility.panel === null || visibility.panel === 'none',
    String(visibility.panel),
  );
  check(
    '**打印时批注弹窗被藏起来**',
    visibility.dialog === null || visibility.dialog === 'none',
    String(visibility.dialog),
  );
  check(
    '**打印时颜色面板被藏起来**',
    visibility.palette === null || visibility.palette === 'none',
    String(visibility.palette),
  );

  // ---- ③ 生成的 PDF 里不能有批注正文 ----
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  const pdfText = Buffer.from(pdf).toString('latin1');
  check(
    '**打印出来的 PDF 里没有批注正文**（没有"机密内容"）',
    !pdfText.includes('SECRET') && !pdfText.includes('机密'),
    `${pdf.length} 字节`,
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
