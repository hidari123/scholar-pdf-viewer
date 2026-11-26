/**
 * E2E：**工具栏的主题选择按钮**。
 *
 * ## 用户反馈
 *
 * > "主题应该是包里面内置的 然后宿主可以进行选择配置
 * >  包在工具栏那里也可以加上一个按钮让用户进行选择"
 *
 * ## 现状（❌ -> ✅）
 *
 * -> 之前：`core/theme` 里有 7 个内置主题
 * -> 但**包的工具栏没有入口** ❌ -> 宿主要自己另外写切换 UI ❌
 * -> 现在：工具栏有 🎨 按钮 -> 点它选主题
 *
 * 用法：`node scripts/e2e-theme-picker.mjs`
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

console.log('E2E：工具栏的主题选择按钮');

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

  // ---- ① 工具栏有主题按钮 ----
  const hasButton = await page.evaluate(
    () => !!document.querySelector('.scpdf-toolbar__btn[aria-label="主题"]'),
  );
  check('**工具栏有主题按钮**', hasButton);

  // ---- ② 点它 -> 展开菜单，列出全部内置主题 ----
  await page.getByRole('button', { name: '主题' }).click();
  await page.waitForTimeout(700);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-theme-picker__item')].map((i) =>
      (i.textContent ?? '').replace(/当前主题$/, '').trim(),
    ),
  );
  check('**点开有主题列表**', items.length >= 7, `${items.length} 个: ${items.join(', ')}`);
  for (const name of ['亮色', '暗色', '跟随系统', '纸张', '护眼', '高对比度', '极简']) {
    check(`**有"${name}"主题**`, items.includes(name));
  }

  // ---- ③ 当前主题被标记 ----
  const activeCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-theme-picker__item[data-active="true"]').length,
  );
  check('**当前主题被标记了**', activeCount === 1, `${activeCount} 个`);

  // ---- ④ 选一个主题 -> root 的 class 变了 ----
  const before = await page.evaluate(() => document.querySelector('.scpdf-root')?.className ?? '');
  await page.evaluate(() => {
    const list = [...document.querySelectorAll('.scpdf-theme-picker__item')];
    list.find((i) => i.textContent?.includes('暗色'))?.click();
  });
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => document.querySelector('.scpdf-root')?.className ?? '');
  check('**切换主题后 root 的 class 变了**', before !== after, `${before} -> ${after}`);
  check('**切到了暗色主题**', after.includes('scpdf-root--dark'), after);

  // ---- ⑤ 菜单自动关闭 ----
  check('**选完菜单自动关闭**', (await page.locator('.scpdf-theme-picker__menu').count()) === 0);

  // ---- ⑥ 点外面也能关闭 ----
  await page.getByRole('button', { name: '主题' }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  await page.waitForTimeout(500);
  check('**点外面关闭菜单**', (await page.locator('.scpdf-theme-picker__menu').count()) === 0);

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
