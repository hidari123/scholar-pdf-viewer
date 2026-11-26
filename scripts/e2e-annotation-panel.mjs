/**
 * E2E：**多批注分组 + 便利贴面板 + 富文本**（用户需求）。
 *
 * > "多批注如果位置重叠，比如说都是从某一行出发的多行，
 * >  按钮就会重叠在最右边，调研一下wps或别的是怎么做的交互，
 * >  这种情况下同一行可以只显示一个图标+悬浮选择批注
 * >  +自研富文本输入框（插件调研）+便利贴 UI 展开在页面中间偏右"
 *
 * ## 验证什么
 *
 * 1. 同一行的多个批注 → **只渲染一个图标**（带数量角标）
 * 2. **hover 那个图标** → 弹出"选择批注 N"的列表
 * 3. 点某一条 → 打开**便利贴面板**
 * 4. 面板在**页面中间偏右**，且**完整可见**（不被裁掉）
 * 5. 面板里有**富文本编辑器**（工具栏 + 编辑区）
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

/** 造一条高亮 */
async function makeHighlight() {
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    const sp = spans.find((s) => {
      const r = s.getBoundingClientRect();
      return r.width > r.height * 2 && r.top > 200;
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
  await page.waitForTimeout(1000);

  for (const b of await page.locator('.scpdf-toolbar__btn').all()) {
    const label = await b.getAttribute('aria-label');
    if (label?.includes('添加高亮')) {
      await b.click();
      break;
    }
  }
  await page.waitForTimeout(900);
}

/**
 * 造两个同一行的批注。
 *
 * ⚠️ **之前是靠工具栏里那个"造两个同一行的批注"按钮** ❌
 * -> 那个按钮第 27 轮**被删了**（用户说"不需要这个按钮"）
 * -> -> 改成调 demo 暴露的**测试 API**
 */
async function makeSameLineNotes() {
  await page.evaluate(() => {
    // @ts-expect-error 测试用的全局句柄
    const api = window.__scpdfDemo;
    const highlightId = document
      .querySelector('.scpdf-annotation')
      ?.getAttribute('data-highlight-id');
    api?.makeSameLineNotes(highlightId ?? '');
  });
  await page.waitForTimeout(900);
}

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  await makeHighlight();
  await makeSameLineNotes();

  // ① 同一行的多个批注 → 只渲染一个图标（带角标）
  const notes = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.scpdf-sticky-note')];
    return list.map((n) => ({
      group: n.dataset.group,
      badge: n.querySelector('.scpdf-sticky-note__badge')?.textContent ?? null,
    }));
  });

  check('**同一行的批注 → 只渲染一个图标**', notes.length === 1, `渲染了 ${notes.length} 个`);
  check(
    '**合并的图标带数量角标**',
    notes[0]?.group === 'true' && notes[0]?.badge === '2',
    JSON.stringify(notes[0] ?? {}),
  );

  // ② hover → 弹出选择列表
  await page.locator('.scpdf-sticky-note__icon').first().hover();
  await page.waitForTimeout(700);

  const picker = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-sticky-note__picker');
    if (!el) return null;
    return {
      visible: el.getAttribute('data-visible'),
      items: el.querySelectorAll('.scpdf-sticky-note__picker-item').length,
      title: el.querySelector('.scpdf-sticky-note__picker-title')?.textContent ?? '',
    };
  });

  check(
    '**hover 合并图标 → 弹出"选择批注 N"**',
    picker?.visible === 'true' && picker?.items === 2,
    JSON.stringify(picker ?? {}),
  );

  // ③ 点一条 → 打开便利贴面板
  await page.locator('.scpdf-sticky-note__picker-item').first().click();
  await page.waitForTimeout(900);

  const panel = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation-panel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      fullyVisible:
        r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight,
      // 贴在便签旁边？（不是离得很远）
      nearNote: (() => {
        const n = document.querySelector('.scpdf-sticky-note__icon')?.getBoundingClientRect();
        if (!n) return false;
        return Math.abs(r.left - n.right) < 120;
      })(),
      hasEditor: !!el.querySelector('.scpdf-rich-text__editor'),
      toolbarButtons: el.querySelectorAll('.scpdf-rich-text__btn').length,
    };
  });

  check('**点批注 → 展开便利贴面板**', panel !== null);
  check(
    '**便利贴面板完整可见（不被裁掉）**',
    panel?.fullyVisible === true,
    JSON.stringify({
      left: panel?.left,
      right: (panel?.left ?? 0) + (panel?.width ?? 0),
      viewportWidth: panel?.viewportWidth,
    }),
  );
  check(
    '**便利贴面板贴在便签旁边**（用户需求："打开一个稍微大一点的便利贴的样式"）',
    panel?.nearNote === true,
    `left=${panel?.left} viewport=${panel?.viewportWidth}`,
  );
  check(
    '**面板默认是只读的**（点"编辑"才进编辑器）',
    panel?.hasEditor === false,
    `hasEditor=${panel?.hasEditor}`,
  );

  // 点"编辑" -> 就地变成编辑器
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-annotation-panel__btn')].find((x) =>
      (x.getAttribute('aria-label') ?? '').includes('编辑'),
    );
    b?.click();
  });
  await page.waitForTimeout(900);
  const afterEdit = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation-panel');
    if (!el) return null;
    return {
      hasEditor: !!el.querySelector('.scpdf-rich-text__editor'),
      toolbarButtons: el.querySelectorAll('.scpdf-rich-text__btn').length,
    };
  });
  check(
    '**点"编辑"后有富文本编辑器（工具栏 + 编辑区）**',
    afterEdit?.hasEditor === true && (afterEdit?.toolbarButtons ?? 0) >= 4,
    `按钮 ${afterEdit?.toolbarButtons} 个`,
  );

  // ④ 富文本能真的格式化（加粗）
  //
  // ⚠️ **必须用【真鼠标】点，不能用 `element.click()`**
  // -> `element.click()` 不产生 `mousedown`
  // -> 按钮的 `onMouseDown` + `preventDefault`（用来**保住选区**）不会触发 ❌
  // -> -> 选区被清掉 -> `toggleBold` 作用不到任何文字 ❌
  // -> -> 用 `page.mouse.click()`（**真事件**）
  const boldBtn = page.locator('.scpdf-rich-text__btn[aria-label*="加粗"]');
  const boldCount = await boldBtn.count();
  check('**有"加粗"按钮**', boldCount > 0, `${boldCount} 个`);

  /*
   * ⚠️⚠️ **要选【真正的 contenteditable】**（实测踩到的坑）
   *
   * -> `.scpdf-rich-text__editor` 是 TipTap 的**宿主 div** ❌
   *    -> 真正的 contenteditable 是它的**子元素** `.tiptap`
   * -> 选中了宿主 div -> TipTap 内部的 state **不知道** ❌
   *    -> `toggleBold` 作用不到任何文字 ❌
   * -> -> 必须选 `.tiptap`（或者 contenteditable=true 的那个）
   */
  await page.evaluate(() => {
    const editor = document.querySelector('.scpdf-rich-text__editor [contenteditable="true"]');
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // ⚠️ **发一个真的 `selectionchange`**（TipTap 靠它同步选区）
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(300);

  if (boldCount > 0) {
    const box = await boldBtn.first().boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
  }
  await page.waitForTimeout(500);

  const formatted = await page.evaluate(
    () =>
      document.querySelector('.scpdf-rich-text__editor [contenteditable="true"]')?.innerHTML ??
      null,
  );

  check(
    '**富文本的"加粗"能真的生效**',
    typeof formatted === 'string' && /<(b|strong)>/i.test(formatted),
    String(formatted ?? '').slice(0, 60),
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
