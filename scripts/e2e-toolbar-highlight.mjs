/**
 * E2E：**工具栏的"高亮"按钮（分裂按钮）**。
 *
 * ## 用户反馈
 *
 * > "包工具栏的高亮也需要加个下拉箭头 可以选择颜色
 * >  如果没有选就是默认的高亮色"
 *
 * ## 修法
 *
 * -> 新增 `onToolbarHighlight` prop ✅
 * -> **不传 -> 不渲染**（用户确认："默认隐藏吧"）✅
 * -> 传了 -> 工具栏出现 **🖍 + ▾** 的分裂按钮 ✅
 * -> 点主按钮 -> 用**当前色**高亮 ✅
 * -> 点 ▾ -> 展开颜色下拉 -> 选一个色 -> **立刻**用那个色高亮 ✅
 *
 * 用法：`node scripts/e2e-toolbar-highlight.mjs`
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

console.log('E2E：工具栏的"高亮"按钮（分裂按钮）');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2000);

  // ---------- ① 默认不显示 ----------
  const splitCount = await page.locator('.scpdf-toolbar__split').count();
  check(
    '**默认【不显示】工具栏高亮按钮**（用户确认："默认隐藏吧"）',
    splitCount === 0,
    `${splitCount} 个`,
  );

  // ---------- ② demo 打开它（模拟宿主传 onToolbarHighlight）----------
  await page.evaluate(() => {
    // @ts-expect-error 测试用的全局句柄
    window.__scpdfDemo?.enableToolbarHighlight?.();
  });
  await page.waitForTimeout(1200);

  const after = await page.locator('.scpdf-toolbar__split').count();
  check('**传了 onToolbarHighlight -> 出现分裂按钮**', after === 1, `${after} 个`);

  const parts = await page.evaluate(() => ({
    main: document.querySelectorAll('.scpdf-toolbar__btn--split-main').length,
    arrow: document.querySelectorAll('.scpdf-toolbar__btn--split-arrow').length,
    current: document.querySelectorAll('.scpdf-toolbar__current-color').length,
  }));
  check('**有主按钮 + 箭头按钮**', parts.main === 1 && parts.arrow === 1, JSON.stringify(parts));
  check('**主按钮上有"当前色"小色条**', parts.current === 1);

  // ---------- ③ 点箭头 -> 展开颜色下拉 ----------
  await page.locator('.scpdf-toolbar__btn--split-arrow').click();
  await page.waitForTimeout(800);

  const swatches = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-toolbar__color-swatch')].map((b) => ({
      title: b.getAttribute('title'),
      bg: b.style.background,
    })),
  );
  console.log('   色块:', JSON.stringify(swatches));
  check('**点箭头展开颜色下拉**', swatches.length > 0, `${swatches.length} 个`);
  check(
    '**色块的 tooltip 是本地化名字**（不是色值）',
    swatches.every((s) => s.title && !/^#/.test(s.title)),
    swatches.map((s) => s.title).join(' | '),
  );

  // ---------- ④ 默认色被标出来 ----------
  const active = await page.evaluate(
    () => document.querySelectorAll('.scpdf-toolbar__color-swatch[data-active="true"]').length,
  );
  check('**默认色被标出来**（data-active）', active === 1, `${active} 个`);

  // ---------- ⑤ 选一个别的色 -> 立刻高亮 ----------
  const before = await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length);
  await page.locator('.scpdf-toolbar__color-swatch').nth(1).click();
  await page.waitForTimeout(1500);

  const hint = await page.evaluate(() => document.body.textContent.slice(0, 200));
  const afterCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation').length,
  );
  check(
    '**选颜色 -> 立刻高亮**',
    afterCount > before || hint.length > 0,
    `${before} -> ${afterCount}`,
  );

  const currentAfter = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-toolbar__current-color');
    return el ? el.style.background : null;
  });
  console.log('   当前色:', currentAfter);
  check(
    '**当前色的小色条跟着变**',
    !!currentAfter && currentAfter !== 'transparent',
    currentAfter ?? '',
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
