/**
 * E2E：**UI 打磨**（第 20 轮，用户的 7 条反馈）。
 *
 * ## 验证什么
 *
 * 1. **链接弹窗的输入框不超出弹窗**（`box-sizing` 的坑）
 * 2. **编辑批注的弹窗不贴着视口右边**（要"往中间来点"）
 * 3. **编辑批注的弹窗完全在视口内**（"保存"按钮不能被挤出屏幕）
 * 4. **内置了两套语言**（zh / en）+ **所有文案都跟着切换**
 * 5. **高亮和引用有样式**（`<mark>` 有底色、`<blockquote>` 有竖线）
 * 6. **弹窗打开时 PDF 的文字不可选**（光标移动不会选中 PDF 高亮）
 * 7. **保存按钮 hover 变深**（不是变白）、**取消按钮 hover 有底色**
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

  // 选一段**靠右**的文字（模拟"批注在这一行最右边"）
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    let best = null;
    let bestRight = -Infinity;
    for (const s of spans) {
      const r = s.getBoundingClientRect();
      if (r.top < 250 || r.top > 700) continue;
      if (r.right > bestRight) {
        bestRight = r.right;
        best = s;
      }
    }
    if (!best) return;
    const range = document.createRange();
    const node = best.firstChild ?? best;
    range.setStart(node, 0);
    range.setEnd(node, 8);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  await page.locator('button[aria-label="加批注"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);

  // ——— ① 链接弹窗的输入框 ———
  await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
  await page.keyboard.type('hello world', { delay: 40 });
  await page.waitForTimeout(600);
  await page.locator('.scpdf-annotation-dialog button[aria-label="链接"]').first().click();
  await page.waitForTimeout(900);

  const pop = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-link-popover');
    if (!p) return null;
    const pr = p.getBoundingClientRect();
    const inputs = [...p.querySelectorAll('input')].map((i) => {
      const r = i.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    return {
      popLeft: pr.left,
      popRight: pr.right,
      inputs,
      inside: inputs.every((i) => i.left >= pr.left - 0.5 && i.right <= pr.right + 0.5),
      overflow: inputs.filter((i) => i.right > pr.right + 0.5).length,
    };
  });

  check('**链接弹窗打开了**', pop !== null);
  check(
    '**输入框不超出弹窗的右边界**（用户反馈："里面的输入框超出右边边界了"）',
    pop?.inside === true && pop?.overflow === 0,
    `溢出 ${pop?.overflow ?? '?'} 个`,
  );

  // Esc 只能关掉链接弹窗，**不能关掉整个批注弹窗**（实测踩过的坑）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const afterEsc = await page.evaluate(() => ({
    popover: !!document.querySelector('.scpdf-link-popover'),
    dialog: !!document.querySelector('.scpdf-annotation-dialog'),
  }));
  check(
    '**Esc 只关掉链接弹窗**（不会把整个批注弹窗也关掉）',
    afterEsc.popover === false && afterEsc.dialog === true,
    JSON.stringify(afterEsc),
  );

  // ——— ④⑤ 高亮和引用的样式 ———
  // ⚠️ **Esc 之后焦点不在编辑器里** -> 要**重新点一下**再选中文本
  await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(500);
  /*
   * ⚠️ **颜色按钮现在是"弹面板"**（审计修复：之前直接应用第一个颜色 -> 用户没法选）。
   * -> 所以测试要：**点按钮 -> 选一个色块** ✅
   */
  await page.locator('.scpdf-annotation-dialog button[aria-label="高亮"]').first().click();
  await page.waitForTimeout(600);
  /*
   * ⚠️ **色板第一个是"无背景色"（斜杠）**（第 27 轮加的）✅
   * -> 点**第一个** = **清除高亮** ❌
   * -> 要点**第二个**（第一个真实颜色）✅
   */
  await page
    .locator('.scpdf-annotation-dialog .scpdf-rich-text__palette .scpdf-rich-text__swatch')
    .nth(1)
    .click();
  await page.waitForTimeout(900);
  // 引用：在后面新起一段
  await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('这是一段引用', { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(400);
  await page.locator('.scpdf-annotation-dialog button[aria-label="引用"]').first().click();
  await page.waitForTimeout(900);

  const styles = await page.evaluate(() => {
    const pm = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    const mark = pm?.querySelector('mark');
    const bq = pm?.querySelector('blockquote');
    const mcs = mark ? getComputedStyle(mark) : null;
    const bcs = bq ? getComputedStyle(bq) : null;
    return {
      markFound: !!mark,
      markBg: mcs?.backgroundColor ?? '',
      bqFound: !!bq,
      bqBorder: bcs?.borderLeftWidth ?? '',
      bqBorderColor: bcs?.borderLeftColor ?? '',
      bqPadding: bcs?.paddingLeft ?? '',
    };
  });

  check('**高亮有底色**（用户反馈："高亮效果也没出来"）', styles.markFound, styles.markBg);
  check(
    '**底色不是透明**',
    styles.markBg !== '' && styles.markBg !== 'rgba(0, 0, 0, 0)' && styles.markBg !== 'transparent',
    styles.markBg,
  );
  check(
    '**引用有左边竖线**（用户反馈："引用需要加上样式"）',
    styles.bqFound && parseFloat(styles.bqBorder) > 0,
    `${styles.bqBorder} ${styles.bqBorderColor} / padding ${styles.bqPadding}`,
  );

  // ——— ⑥ 弹窗打开时 PDF 文字不可选 ———
  const selectState = await page.evaluate(() => {
    const root = document.querySelector('.scpdf-root');
    const tl = document.querySelector('.scpdf-text-layer');
    return {
      dialogOpen: root?.getAttribute('data-dialog-open'),
      userSelect: tl ? getComputedStyle(tl).userSelect : null,
    };
  });
  check(
    '**弹窗打开时 PDF 文字不可选**（用户反馈："光标移动…高亮文字会被选中"）',
    selectState.dialogOpen === 'true' && selectState.userSelect === 'none',
    JSON.stringify(selectState),
  );

  // ——— ⑦ 按钮 hover ———
  const saveBtn = page.locator('.scpdf-annotation-dialog button:has-text("保存")').first();
  const cancelBtn = page.locator('.scpdf-annotation-dialog button:has-text("取消")').first();
  const saveBefore = await saveBtn.evaluate((b) => getComputedStyle(b).backgroundColor);
  await saveBtn.hover();
  await page.waitForTimeout(400);
  const saveAfter = await saveBtn.evaluate((b) => getComputedStyle(b).backgroundColor);
  const cancelBefore = await cancelBtn.evaluate((b) => getComputedStyle(b).backgroundColor);
  await cancelBtn.hover();
  await page.waitForTimeout(400);
  const cancelAfter = await cancelBtn.evaluate((b) => getComputedStyle(b).backgroundColor);

  check(
    '**保存按钮 hover 变深**（不是变白）',
    saveBefore !== saveAfter && saveAfter !== 'rgba(0, 0, 0, 0)',
    `${saveBefore} -> ${saveAfter}`,
  );
  check(
    '**取消按钮 hover 有底色**（用户反馈："没有加上底色"）',
    cancelAfter !== cancelBefore && cancelAfter !== 'rgba(0, 0, 0, 0)',
    `${cancelBefore} -> ${cancelAfter}`,
  );

  // ——— ②③ 编辑弹窗的位置 ———
  await page.locator('.scpdf-annotation-dialog button:has-text("保存")').first().click();
  await page.waitForTimeout(2000);
  await page.locator('.scpdf-sticky-note').first().hover();
  await page.waitForTimeout(800);
  await page.locator('button[aria-label="编辑批注"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(2500);

  const editGeo = await page.evaluate(() => {
    const d = document.querySelector('.scpdf-annotation-dialog');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const btn = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
    const br = btn?.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      vw: window.innerWidth,
      vh: window.innerHeight,
      gapRight: window.innerWidth - r.right,
      saveBottom: br?.bottom ?? 0,
    };
  });

  check('**编辑弹窗打开了**', editGeo !== null);
  check(
    '**编辑弹窗不贴着视口右边**（用户反馈："过于靠右…需要往中间来点"）',
    editGeo?.gapRight >= 24,
    `右边距 ${Math.round(editGeo?.gapRight ?? 0)}px`,
  );
  check(
    '**编辑弹窗完全在视口内**（"保存"按钮不能被挤出屏幕）',
    editGeo?.bottom !== undefined &&
      editGeo.bottom <= editGeo.vh &&
      editGeo.saveBottom <= editGeo.vh &&
      editGeo.top >= 0,
    `弹窗 bottom=${Math.round(editGeo?.bottom ?? 0)}，保存按钮 bottom=${Math.round(editGeo?.saveBottom ?? 0)}，视口 ${editGeo?.vh}`,
  );

  // ——— ③ 两套语言切换 ———
  const zhText = await page.evaluate(() => ({
    toolbar: document.querySelector('.scpdf-annotation-dialog__title')?.textContent ?? '',
    save:
      [...document.querySelectorAll('.scpdf-annotation-dialog button')]
        .map((b) => b.textContent.trim())
        .find((t) => t === '保存' || t === 'Save') ?? '',
  }));
  await page.locator('select:has(option[value="en"])').selectOption('en');
  await page.waitForTimeout(1500);
  const enText = await page.evaluate(() => ({
    toolbar: document.querySelector('.scpdf-annotation-dialog__title')?.textContent ?? '',
    save:
      [...document.querySelectorAll('.scpdf-annotation-dialog button')]
        .map((b) => b.textContent.trim())
        .find((t) => t === '保存' || t === 'Save') ?? '',
    stickyEdit:
      document.querySelector('.scpdf-sticky-note__action')?.getAttribute('aria-label') ?? '',
  }));

  check(
    '**弹窗标题跟着语言切换**',
    zhText.toolbar !== enText.toolbar,
    `${zhText.toolbar} -> ${enText.toolbar}`,
  );
  check(
    '**保存按钮跟着语言切换**',
    zhText.save === '保存' && enText.save === 'Save',
    `${zhText.save} -> ${enText.save}`,
  );
  check(
    '**便签的编辑按钮跟着语言切换**',
    enText.stickyEdit.includes('Edit') || enText.stickyEdit.includes('edit'),
    `"${enText.stickyEdit}"`,
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
