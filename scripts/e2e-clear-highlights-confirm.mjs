/**
 * E2E：清除全部高亮的确认框。
 *
 * ## 覆盖
 *
 * 1. 点「清除全部高亮」-> **弹确认框**（不是直接清除 ✅）
 * 2. 点「取消」-> **不调**宿主的回调 ✅ -> 高亮还在 ✅
 * 3. 点「清除」-> **才调**宿主的回调 ✅ -> 高亮没了 ✅
 * 4. 按 Esc -> 关闭 ✅ -> 不清除 ✅
 * 5. 确认框是**自研的** ✅ -> 不用浏览器的 `window.confirm` ✅
 * 6. 危险按钮的样式（红色 ✅）-> 不会被 CSS 变量缺失搞成隐形 ✅
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

/** ⚠️ **浏览器默认弹窗**（`window.confirm`）⚠️ */
let nativeDialogs = 0;
page.on('dialog', async (d) => {
  nativeDialogs += 1;
  await d.dismiss().catch(() => undefined);
});

await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 40000,
});
await page.waitForTimeout(1200);

const CLEAR_BTN = '.scpdf-toolbar__btn[aria-label="清除全部高亮"]';

// [1] 工具栏有「清除全部高亮」按钮
const hasBtn = (await page.locator(CLEAR_BTN).count()) > 0;
check('工具栏有「清除全部高亮」按钮', hasBtn);

// [2] 先造一个高亮
//
// ⚠️ **用真的选字来造** ✅
// -> 直接往 localStorage 塞 ✅ -> 位置对不上 ✅ -> **画不出来** ✅
//    -> 归一化坐标必须和文档实际排版对得上 ✅ -> 手工造**不可靠** ✅
// -> 所以：**选中一段字** ✅ -> 点浮层的「高亮」✅ -> 让包自己算坐标 ✅
const sel = await page.evaluate(() => {
  const items = document.querySelectorAll('.scpdf-text-layer__item');
  if (items.length < 3) return null;
  const a = items[0].getBoundingClientRect();
  const c = items[2].getBoundingClientRect();
  return {
    x1: a.left + 1,
    y1: a.top + a.height / 2,
    x2: c.right - 1,
    y2: c.top + c.height / 2,
  };
});
check('找到可选的文字', sel !== null);

if (sel) {
  await page.mouse.move(sel.x1, sel.y1);
  await page.mouse.down();
  await page.mouse.move(sel.x2, sel.y2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  // ⚠️ **点选区浮层里的「高亮」** ✅
  const hlBtn = page.locator('.scpdf-selection-popover__btn[aria-label="高亮"]').first();
  if ((await hlBtn.count()) > 0) {
    await hlBtn.click();
    await page.waitForTimeout(900);
  }
}

// ⚠️ **高亮块的 class 是 `scpdf-annotation`** ✅（不是 `scpdf-highlight` ✅）
const hlCount = async () =>
  page.locator('.scpdf-annotation:not(.scpdf-annotation--search)').count();
const before = await hlCount();
check('造了一个高亮', before > 0, `count=${before}`);

// [3] 点按钮 -> 弹确认框
await page.locator(CLEAR_BTN).first().click();
await page.waitForTimeout(500);

const dialogInfo = await page.evaluate(() => {
  const d = document.querySelector('.scpdf-dialog--confirm');
  if (!d) return null;
  return {
    role: d.getAttribute('role'),
    title: d.querySelector('.scpdf-dialog__title')?.textContent ?? '',
    message: d.querySelector('.scpdf-dialog__message')?.textContent ?? '',
    buttons: Array.from(d.querySelectorAll('.scpdf-dialog__actions button')).map((b) => ({
      text: b.textContent ?? '',
      cls: b.className,
    })),
  };
});
check('点按钮弹出确认框', dialogInfo !== null);
check('确认框有标题', Boolean(dialogInfo?.title), dialogInfo?.title ?? '');
check('确认框有正文', Boolean(dialogInfo?.message), dialogInfo?.message ?? '');
check('确认框有两个按钮', dialogInfo?.buttons.length === 2, JSON.stringify(dialogInfo?.buttons));
check(
  '确认框是自研的（不是 window.confirm ✅）',
  nativeDialogs === 0,
  `nativeDialogs=${nativeDialogs}`,
);

// [4] 「清除」按钮是危险样式（红色 ✅）
const dangerStyle = await page.evaluate(() => {
  const btn = document.querySelector('.scpdf-dialog__actions .scpdf-btn--danger');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  return { bg: cs.backgroundColor, color: cs.color, w: btn.getBoundingClientRect().width };
});
check('确认框有「危险」按钮', dangerStyle !== null);
check(
  '危险按钮是红底白字（不是隐形 ✅）',
  Boolean(dangerStyle) &&
    dangerStyle.bg !== 'rgba(0, 0, 0, 0)' &&
    dangerStyle.bg !== 'transparent' &&
    dangerStyle.color === 'rgb(255, 255, 255)',
  JSON.stringify(dangerStyle),
);

// [5] 点「取消」-> 不清除
const cancelBtn = page.locator('.scpdf-dialog__actions .scpdf-btn:not(.scpdf-btn--danger)').first();
await cancelBtn.click();
await page.waitForTimeout(600);

const afterCancel = await page.evaluate(() => ({
  dialogOpen: document.querySelectorAll('.scpdf-dialog--confirm').length,
  highlights: document.querySelectorAll('.scpdf-annotation:not(.scpdf-annotation--search)').length,
}));
check('点取消后确认框关闭', afterCancel.dialogOpen === 0);
check('点取消后高亮还在', afterCancel.highlights > 0, `count=${afterCancel.highlights}`);

// [6] 再点 -> 按 Esc 关闭 -> 不清除
await page.locator(CLEAR_BTN).first().click();
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

const afterEsc = await page.evaluate(() => ({
  dialogOpen: document.querySelectorAll('.scpdf-dialog--confirm').length,
  highlights: document.querySelectorAll('.scpdf-annotation:not(.scpdf-annotation--search)').length,
}));
check('按 Esc 后确认框关闭', afterEsc.dialogOpen === 0);
check('按 Esc 后高亮还在', afterEsc.highlights > 0, `count=${afterEsc.highlights}`);

// [7] 再点 -> 点「清除」-> 高亮没了
await page.locator(CLEAR_BTN).first().click();
await page.waitForTimeout(400);
await page.locator('.scpdf-dialog__actions .scpdf-btn--danger').first().click();
await page.waitForTimeout(900);

const afterConfirm = await page.evaluate(() => ({
  dialogOpen: document.querySelectorAll('.scpdf-dialog--confirm').length,
  highlights: document.querySelectorAll('.scpdf-annotation:not(.scpdf-annotation--search)').length,
}));
check('点「清除」后确认框关闭', afterConfirm.dialogOpen === 0);
check('点「清除」后高亮没了', afterConfirm.highlights === 0, `count=${afterConfirm.highlights}`);

// [8] 全程没有浏览器默认弹窗
check('全程没用 window.confirm ✅', nativeDialogs === 0, `nativeDialogs=${nativeDialogs}`);

// [9] 没有页面错误
check('没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n结果：${passed}/${total} 通过`);
if (passed !== total) {
  console.log('失败项：');
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}`);
  process.exit(1);
}
