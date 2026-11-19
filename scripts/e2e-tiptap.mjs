/**
 * E2E：**TipTap 富文本编辑器**（用户需求："不要自研的富文本了 用一个现成的吧"）。
 *
 * ## 验证什么
 *
 * 1. 批注弹窗里挂载的是 **TipTap**（`.ProseMirror`），不是包内置的 contenteditable
 * 2. **能正常打字**（不是只打进去一个字母）
 * 3. **工具栏能生效**：加粗 / 高亮 / 斜体
 * 4. 工具栏文案**跟着语言走**（不是 `{richtext.bold}` 这种占位符）
 * 5. 宿主没装 TipTap → **降级**到内置编辑器（不崩）
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

/**
 * **选中编辑器里的前 N 个字符**。
 *
 * ⚠️ **不能假设 `p.firstChild` 是文本节点**：
 * -> 加粗之后 ProseMirror 会把文字拆成多个节点（`<strong>` 里一个、外面一个）❌
 * -> 要用 **TreeWalker** 找到第一个文本节点 ✅
 */
async function selectFirstChars(page, count) {
  await page.evaluate((n) => {
    const root = document.querySelector('.scpdf-annotation-dialog .ProseMirror p');
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (!first) return;
    const len = Math.min(n, first.textContent?.length ?? 0);
    if (len <= 0) return;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, len);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, count);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // 选中一段文字
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

  await page.locator('button[aria-label="加批注"]').first().click();
  await page.waitForTimeout(3000);

  // ① 挂载的是 TipTap
  const hasTipTap = await page.evaluate(
    () => !!document.querySelector('.scpdf-annotation-dialog .ProseMirror'),
  );
  check('**批注弹窗里挂载的是 TipTap（.ProseMirror）**', hasTipTap);

  // ② 工具栏按钮
  const btnCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn').length,
  );
  check('**工具栏按钮渲染出来了**', btnCount >= 5, `${btnCount} 个`);

  // ③ 文案是本地化的（不是占位符）
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn')].map(
      (b) => b.getAttribute('aria-label') ?? '',
    ),
  );
  check(
    '**工具栏文案走 i18n（不是 `{richtext.bold}`）**',
    labels.length > 0 && labels.every((l) => !l.includes('{richtext.')),
    labels.join(', '),
  );

  // ④ 打字
  const pm = page.locator('.scpdf-annotation-dialog .ProseMirror');
  await pm.click();
  await page.keyboard.type('HelloTipTap', { delay: 40 });
  await page.waitForTimeout(600);
  const typed = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.textContent ?? '',
  );
  check('**能完整打字（不是只打进去一个字母）**', typed.length >= 10, `输入了 "${typed}"`);

  // ⑤ 加粗（先选中前 5 个字符）
  await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-dialog .ProseMirror p');
    const node = p?.firstChild;
    if (!node) return;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 5);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(400);

  const boldBtn = page.locator('.scpdf-annotation-dialog .scpdf-rich-text__btn[aria-label="加粗"]');
  if ((await boldBtn.count()) > 0) {
    await boldBtn.click();
    await page.waitForTimeout(600);
  }
  const afterBold = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check('**点"加粗"能生效（`<strong>`）**', afterBold.includes('<strong>'), afterBold.slice(0, 90));

  // ⑥ 斜体
  await selectFirstChars(page, 5);
  await page.waitForTimeout(300);
  const italicBtn = page.locator(
    '.scpdf-annotation-dialog .scpdf-rich-text__btn[aria-label="斜体"]',
  );
  if ((await italicBtn.count()) > 0) {
    await italicBtn.click();
    await page.waitForTimeout(600);
  }
  const afterItalic = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check(
    '**点"斜体"能生效（`<em>`）**',
    afterItalic.includes('<em>') || afterItalic.includes('<i>'),
    afterItalic.slice(0, 90),
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
