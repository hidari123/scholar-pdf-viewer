/**
 * E2E：**缩放比例可以填写**（上下限可配）。
 *
 * ## 用户反馈
 *
 * > "放大缩小这个 是可以用户进行填写比例的
 * >  包默认最大是250%，最小是20%，这个上限下限宿主也可以配置，
 * >  包括是否用户可以填写 这个宿主也要可以进行配置"
 *
 * ## 行为
 *
 * -> 平时显示当前比例（只读文本 -> 可点击的按钮）
 * -> 点一下 -> 变成输入框
 * -> 填数字 + 回车 -> 生效（**夹到上下限** + **量化到 10%**）
 *
 * 用法：`node scripts/e2e-scale-input.mjs`
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

console.log('E2E：缩放比例可以填写');

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

  // ---- ① 平时是一个按钮，显示百分比 ----
  const display = await page.evaluate(() => ({
    hasButton: !!document.querySelector('.scpdf-toolbar__scale--editable'),
    text: document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
  }));
  check('**平时显示百分比**', /^\d+%$/.test(display.text.trim()), display.text);
  check('**是个可点击的按钮**', display.hasButton);

  // ---- ② 点一下 -> 输入框 ----
  await page.locator('.scpdf-toolbar__scale--editable').click();
  await page.waitForTimeout(600);
  check('**点一下变成输入框**', (await page.locator('.scpdf-toolbar__scale-input').count()) === 1);

  // ---- ③ 填 137 -> 量化到 140 ----
  await page.fill('.scpdf-toolbar__scale-input', '137');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const after137 = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent?.trim() ?? '',
  );
  check('**填 137% -> 量化到 140%**', after137 === '140%', after137);

  // ---- ④ 填 999 -> 夹到最大值 250% ----
  await page.locator('.scpdf-toolbar__scale--editable').click();
  await page.waitForTimeout(400);
  await page.fill('.scpdf-toolbar__scale-input', '999');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const after999 = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent?.trim() ?? '',
  );
  check('**填 999% -> 夹到最大 250%**', after999 === '250%', after999);

  // ---- ⑤ 填 5 -> 夹到最小值 20% ----
  await page.locator('.scpdf-toolbar__scale--editable').click();
  await page.waitForTimeout(400);
  await page.fill('.scpdf-toolbar__scale-input', '5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const after5 = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent?.trim() ?? '',
  );
  check('**填 5% -> 夹到最小 20%**', after5 === '20%', after5);

  // ---- ⑥ Esc 放弃修改 ----
  await page.locator('.scpdf-toolbar__scale--editable').click();
  await page.waitForTimeout(400);
  await page.fill('.scpdf-toolbar__scale-input', '150');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const afterEsc = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent?.trim() ?? '',
  );
  check('**Esc 放弃修改**', afterEsc === '20%', afterEsc);

  // ---- ⑦ +/- 按钮在到边界时置灰 ----
  const zoomOutDisabled = await page.evaluate(
    () => document.querySelector('[aria-label="缩小"]')?.hasAttribute('disabled') ?? false,
  );
  check('**到最小值时"缩小"按钮置灰**', zoomOutDisabled);

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
