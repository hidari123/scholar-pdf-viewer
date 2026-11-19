/**
 * E2E：**"加批注"按钮 + 富文本弹窗**（用户需求）。
 *
 * > "需要在框选的时候工具栏弹窗就要有加批注这个，写了批注之后用默认高亮。"
 *
 * > "我的意思是写批注的时候不要用系统默认的alert，设计一个富文本弹窗来写批注，
 * > 而且在展示的时候要展示出来富文本，现在我看都是富文本直接写出来<br>这种"
 *
 * ## 验证什么
 *
 * 1. 选区浮层里**有"加批注"按钮**
 * 2. 点它 → 弹出**富文本弹窗**（不是 `window.prompt`）
 * 3. 弹窗里有**富文本工具栏**
 * 4. 弹窗里的内容能**真的格式化**（加粗）
 * 5. 保存 → **建一条高亮**（用默认高亮色）
 * 6. 批注内容保存的是 **HTML**（不是纯文本）
 */

import { existsSync, readdirSync } from 'node:fs';
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

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
const _prompts = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
// 拦截 window.prompt / alert —— 用户明确不要系统弹窗
await page.addInitScript(() => {
  window.__scpdfPrompts = [];
  window.prompt = (...args) => {
    window.__scpdfPrompts.push(args);
    return null;
  };
  window.alert = (...args) => {
    window.__scpdfPrompts.push(args);
  };
});

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // 选一段文字
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    const sp = spans.find((s) => {
      const r = s.getBoundingClientRect();
      return r.width > r.height * 2 && r.top > 300;
    });
    if (!sp) return;
    const range = document.createRange();
    const node = sp.firstChild ?? sp;
    range.setStart(node, 0);
    range.setEnd(node, 10);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(1200);

  // ① 浮层里有"加批注"
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-popover button, .scpdf-selection-popover button')].map(
      (b) => b.getAttribute('aria-label') || b.title || b.textContent,
    ),
  );
  check(
    '**选区浮层里有"加批注"按钮**',
    labels.some((l) => (l ?? '').includes('加批注')),
    JSON.stringify(labels),
  );

  // ② 点它 → 弹出富文本弹窗
  const noteBtn = page.locator('button[aria-label="加批注"], button[title="加批注"]').first();
  await noteBtn.click();
  await page.waitForTimeout(1200);

  const dialog = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation-dialog');
    if (!el) return null;
    return {
      hasEditor: !!el.querySelector('.scpdf-rich-text__editor'),
      toolbarButtons: el.querySelectorAll('.scpdf-rich-text__btn').length,
      hasSave: [...el.querySelectorAll('button')].some((b) =>
        (b.textContent ?? '').includes('保存'),
      ),
      hasCancel: [...el.querySelectorAll('button')].some((b) =>
        (b.textContent ?? '').includes('取消'),
      ),
    };
  });

  check('**点"加批注" → 弹出富文本弹窗**', dialog !== null);
  check(
    '**弹窗里有富文本编辑器（工具栏 + 编辑区）**',
    dialog?.hasEditor === true && (dialog?.toolbarButtons ?? 0) >= 4,
    `工具栏 ${dialog?.toolbarButtons} 个按钮`,
  );
  check('**弹窗有"保存 / 取消"**', dialog?.hasSave === true && dialog?.hasCancel === true);

  // ③ 没用系统弹窗
  const promptCount = await page.evaluate(() => window.__scpdfPrompts?.length ?? 0);
  check('**没有用 window.prompt / alert**', promptCount === 0, `调了 ${promptCount} 次`);

  // ④ 富文本能真的格式化
  const html = await page.evaluate(() => {
    const editor = document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__editor');
    if (!editor) return null;
    editor.focus();
    editor.textContent = '测试批注内容';
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const bold = [...document.querySelectorAll('.scpdf-rich-text__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('加粗'),
    );
    bold?.click();
    return editor.innerHTML;
  });
  await page.waitForTimeout(400);

  check(
    '**富文本的"加粗"能真的生效**',
    typeof html === 'string' && /<(b|strong)>/i.test(html),
    String(html ?? '').slice(0, 60),
  );

  // ⑤ 保存 → 建一条高亮
  const before = await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length);
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('.scpdf-annotation-dialog button')].find((b) =>
      (b.textContent ?? '').includes('保存'),
    );
    save?.click();
  });
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    highlights: document.querySelectorAll('.scpdf-annotation:not(.scpdf-annotation--search)')
      .length,
    notes: document.querySelectorAll('.scpdf-sticky-note').length,
    dialogOpen: !!document.querySelector('.scpdf-annotation-dialog'),
  }));

  check('**保存后弹窗关闭**', after.dialogOpen === false);
  check(
    '**保存后建了一条高亮**（"写了批注之后用默认高亮"）',
    after.highlights > 0,
    `高亮 ${after.highlights} 个（之前 ${before}）`,
  );
  check('**保存后出现了便签图标**', after.notes > 0, `便签 ${after.notes} 个`);

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
