/**
 * E2E：**选中高亮后按退格键删除**（用户需求：
 * "选中高亮的时候如果点击退格键可以删除高亮"）。
 *
 * ## 验证什么
 *
 * 1. 选中高亮 → 按 `Backspace` → **高亮被删掉**
 * 2. 按 `Delete` 也一样
 * 3. **没选中高亮**时按退格 → **不删任何东西**（不能误删）
 * 4. 焦点在输入框里 → **不删**（不能打断打字）
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

/** 选一段文字并加高亮 */
async function addHighlight() {
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
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('.scpdf-toolbar__btn')) {
      if ((b.getAttribute('aria-label') ?? '').includes('添加高亮')) {
        b.click();
        break;
      }
    }
  });
  await page.waitForTimeout(1200);
}

/** 点中某个高亮（按坐标） */
async function clickHighlight(index = 0) {
  const pos = await page.evaluate((i) => {
    const els = [...document.querySelectorAll('[data-highlight-id]')];
    const el = els[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, index);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(800);
  return true;
}

const countHighlights = () =>
  page.evaluate(() => document.querySelectorAll('[data-highlight-id]').length);

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // 准备 2 条高亮
  await addHighlight();
  await addHighlight();
  const before = await countHighlights();
  check('**先加两条高亮**', before >= 2, `${before} 条`);

  // ① 选中一条 → 按 Backspace
  const clicked = await clickHighlight(0);
  check('**能点中一条高亮**', clicked);
  const active = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation--active').length,
  );
  check('**高亮进入选中态**', active > 0, `${active} 个 active`);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1000);
  const afterBackspace = await countHighlights();
  check(
    '**按 Backspace → 删掉这条高亮**',
    afterBackspace === before - 1,
    `${before} → ${afterBackspace}`,
  );

  // ② Delete 键也一样
  await clickHighlight(0);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(1000);
  const afterDelete = await countHighlights();
  check(
    '**按 Delete → 也删掉**',
    afterDelete === afterBackspace - 1,
    `${afterBackspace} → ${afterDelete}`,
  );

  // ③ 没选中高亮 → 按退格 → 不删
  await page.evaluate(() => {
    // 点空白处 → 取消选中
    const c = document.querySelector('.scpdf-container');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: Math.round(r.left + 40),
        clientY: Math.round(r.top + 40),
      }),
    );
  });
  await page.waitForTimeout(800);
  const activeAfter = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation--active').length,
  );
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1000);
  const afterNoSel = await countHighlights();
  check(
    '**没选中高亮时按退格 → 不删（不能误删）**',
    afterNoSel === afterDelete,
    `${afterDelete} → ${afterNoSel}（active=${activeAfter}）`,
  );

  // ④ 输入框里按退格 → 不删
  await clickHighlight(0);
  const searchInput = page.locator('.scpdf-search__input');
  if ((await searchInput.count()) > 0) {
    await searchInput.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(800);
  }
  const afterInput = await countHighlights();
  check(
    '**输入框里按退格 → 不删高亮**',
    afterInput === afterNoSel,
    `${afterNoSel} → ${afterInput}`,
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
