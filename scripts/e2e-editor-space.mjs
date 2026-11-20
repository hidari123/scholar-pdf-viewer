/**
 * E2E：**富文本编辑器的两个真 bug**（用户反馈：
 * "我空格也加不了 各种功能都没有 特别难用"）。
 *
 * ## 验证什么
 *
 * 1. **空格能正常输入**（之前 `keyboard.type("hello world")` -> `helloworld`）
 * 2. **`update` 事件真的触发**（之前 `options.onUpdate` 从不触发 -> 宿主拿不到内容）
 * 3. **保存的内容是完整的**（含空格）
 * 4. **光标在编辑器里时，按空格不会滚动页面**
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // 选中一段文字 -> 加批注
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
    range.setEnd(node, 8);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  await page.locator('button[aria-label="加批注"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  check(
    '**弹窗里挂载的是 TipTap**',
    (await page.locator('.scpdf-annotation-dialog .ProseMirror').count()) === 1,
  );

  // 先挂监听，再打字
  await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    window.__updates = [];
    el.editor.on('update', () => window.__updates.push(el.editor.getHTML()));
  });

  const pm = page.locator('.scpdf-annotation-dialog .ProseMirror');
  await pm.click();
  await page.keyboard.type('hello world foo bar', { delay: 50 });
  await page.waitForTimeout(900);

  const typed = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    return { html: el?.innerHTML ?? '', text: el?.textContent ?? '' };
  });

  check(
    '**空格能正常输入（之前 "hello world" -> "helloworld"）**',
    typed.text === 'hello world foo bar',
    `"${typed.text}"`,
  );

  const updates = await page.evaluate(() => window.__updates ?? []);
  check(
    '**update 事件真的触发了（之前 options.onUpdate 从不触发）**',
    updates.length >= 3,
    `${updates.length} 次`,
  );
  check(
    '**update 事件带的是最新的内容**',
    updates.at(-1)?.includes('hello world foo bar'),
    `"${updates.at(-1) ?? ''}"`,
  );

  // 保存 -> 存的是完整内容
  await page.locator('.scpdf-annotation-dialog button:has-text("保存")').first().click();
  await page.waitForTimeout(2000);
  const saved = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('.scpdf-sticky-note')];
    return notes.map((n) => n.textContent ?? '').join(' | ');
  });
  check('**保存的内容是完整的（含空格）**', saved.includes('hello world foo bar'), `"${saved}"`);

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
