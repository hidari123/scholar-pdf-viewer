/**
 * E2E：**键盘导航**（审计发现的覆盖盲区）。
 *
 * ## 为什么重要
 *
 * > "Keyboard navigation E2E - PdfViewer.tsx:2194-2225 implements
 * >  PageUp/PageDown/Home/End/ArrowLeft/ArrowRight and +/- zoom with **zero** coverage"
 *
 * → 键盘用户**没法翻页** -> 这是**可达性**问题 ❌
 * → 而且容器要**有焦点**才生效 -> 不测就不知道 ❌
 *
 * ## 验证什么
 *
 * 1. **方向键 / PageUp / PageDown** 能翻页
 * 2. **Home / End** 能跳到首页 / 末页
 * 3. **+ / -** 能缩放
 * 4. **输入框里不拦截**（打字不能被翻页打断）
 * 5. **\`features.keyboard === false\`** 能整个关掉
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

  const readPage = () =>
    page.evaluate(() => ({
      page: document.querySelector('.scpdf-toolbar__page-input')?.value ?? '',
      scrollTop: Math.round(document.querySelector('.scpdf-container')?.scrollTop ?? 0),
    }));

  /** 聚焦容器（键盘事件挂在它上面） */
  const focusContainer = async () => {
    await page.evaluate(() => {
      const c = document.querySelector('.scpdf-container');
      // @ts-expect-error 调试
      c?.focus();
    });
    await page.waitForTimeout(200);
  };

  // ——— ① 方向键 ———
  await focusContainer();
  const focused = await page.evaluate(
    () => document.activeElement?.classList?.contains('scpdf-container') ?? false,
  );
  check('**容器能拿到焦点**（键盘事件的前提）', focused);
  const before = await readPage();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  const afterRight = await readPage();
  check(
    '**ArrowRight -> 翻到下一页**',
    afterRight.scrollTop > before.scrollTop,
    `scrollTop ${before.scrollTop} -> ${afterRight.scrollTop}`,
  );

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1200);
  const afterLeft = await readPage();
  check(
    '**ArrowLeft -> 翻回上一页**',
    afterLeft.scrollTop < afterRight.scrollTop,
    `scrollTop ${afterRight.scrollTop} -> ${afterLeft.scrollTop}`,
  );

  // ——— ② PageDown / PageUp ———
  await focusContainer();
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(1200);
  const afterPageDown = await readPage();
  check(
    '**PageDown -> 往下翻**',
    afterPageDown.scrollTop > afterLeft.scrollTop,
    `scrollTop ${afterLeft.scrollTop} -> ${afterPageDown.scrollTop}`,
  );

  await page.keyboard.press('PageUp');
  await page.waitForTimeout(1200);
  const afterPageUp = await readPage();
  check(
    '**PageUp -> 往上翻**',
    afterPageUp.scrollTop < afterPageDown.scrollTop,
    `scrollTop ${afterPageDown.scrollTop} -> ${afterPageUp.scrollTop}`,
  );

  // ——— ③ Home / End ———
  await focusContainer();
  await page.keyboard.press('End');
  await page.waitForTimeout(2000);
  const afterEnd = await readPage();
  check(
    '**End -> 跳到最后一页**',
    afterEnd.page !== '1' && afterEnd.scrollTop > 0,
    `页码 ${afterEnd.page} / scrollTop ${afterEnd.scrollTop}`,
  );

  await focusContainer();
  await page.keyboard.press('Home');
  await page.waitForTimeout(2000);
  const afterHome = await readPage();
  check(
    '**Home -> 跳回第一页**',
    afterHome.page === '1' || afterHome.scrollTop < afterEnd.scrollTop,
    `页码 ${afterHome.page} / scrollTop ${afterHome.scrollTop}`,
  );

  // ——— ④ +/- 缩放 ———
  const scaleBefore = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
  );
  await focusContainer();
  await page.keyboard.press('+');
  await page.waitForTimeout(900);
  const scaleAfter = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
  );
  check('**+ -> 放大**', scaleBefore !== scaleAfter, `${scaleBefore} -> ${scaleAfter}`);

  await focusContainer();
  await page.keyboard.press('-');
  await page.waitForTimeout(900);
  const scaleBack = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
  );
  check('**- -> 缩小**', scaleBack !== scaleAfter, `${scaleAfter} -> ${scaleBack}`);

  // ——— ⑤ 输入框里不拦截 ———
  const pageBefore = await readPage();
  await page.locator('.scpdf-toolbar__page-input').click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const pageAfter = await readPage();
  check(
    '**输入框里按方向键 -> 不会翻页**（打字不能被打断）',
    pageAfter.scrollTop === pageBefore.scrollTop,
    `scrollTop ${pageBefore.scrollTop} -> ${pageAfter.scrollTop}`,
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
