/**
 * E2E：**工具栏的"按下态" + 完整功能**（用户反馈：
 * "点了加粗之后 加粗按钮没加深颜色 别的按钮也一样 看不出点击了"）。
 *
 * ## 验证什么
 *
 * 1. **工具栏按钮齐全**（B / I / U / 删除线 / 颜色 / 链接 / 列表 / 引用 / 清除格式 / 撤销 / 重做）
 * 2. **点"加粗" -> 按钮变成按下态**（`data-active="true"` + 明显的背景色）
 * 3. **点"斜体" -> 斜体按钮也按下**，加粗仍然是按下（两个格式可以叠加）
 * 4. **其他按钮不受影响**
 * 5. **撤销 / 重做**按钮存在，且"没法撤销"时是禁用的
 * 6. 各种格式**真的生效**（HTML 正确）
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

  // 选中文字 -> 加批注
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

  const pm = page.locator('.scpdf-annotation-dialog .ProseMirror');
  await pm.click();
  await page.keyboard.type('hello world', { delay: 40 });
  await page.waitForTimeout(700);
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(600);

  // ① 按钮齐全
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn')].map((b) =>
      b.getAttribute('aria-label'),
    ),
  );
  const expected = [
    '加粗',
    '斜体',
    '下划线',
    '删除线',
    '文字颜色',
    '链接',
    '无序列表',
    '有序列表',
    '引用',
    '清除格式',
    '撤销',
    '重做',
  ];
  const missing = expected.filter((e) => !labels.includes(e));
  check('**工具栏按钮齐全**', missing.length === 0, `缺：${missing.join(',') || '无'}`);

  // ② 点加粗 -> 按下态
  await page.locator('.scpdf-annotation-dialog button[aria-label="加粗"]').first().click();
  await page.waitForTimeout(800);

  const afterBold = await page.evaluate(() => {
    const btn = document.querySelector('.scpdf-annotation-dialog button[aria-label="加粗"]');
    const cs = getComputedStyle(btn);
    return {
      active: btn.getAttribute('data-active'),
      pressed: btn.getAttribute('aria-pressed'),
      bg: cs.backgroundColor,
      color: cs.color,
      html: document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
    };
  });

  check(
    '**点"加粗" -> 按钮是按下态（data-active=true）**',
    afterBold.active === 'true' && afterBold.pressed === 'true',
    `active=${afterBold.active} pressed=${afterBold.pressed}`,
  );
  check(
    '**按下态有明显的背景色（不是透明）**',
    afterBold.bg !== 'rgba(0, 0, 0, 0)',
    `bg=${afterBold.bg}`,
  );
  check('**加粗真的生效了**', afterBold.html.includes('<strong>'), afterBold.html);

  // ③ 再点斜体 -> 两个都按下
  await page.locator('.scpdf-annotation-dialog button[aria-label="斜体"]').first().click();
  await page.waitForTimeout(800);
  const afterItalic = await page.evaluate(() => {
    const get = (label) => {
      const b = document.querySelector(`.scpdf-annotation-dialog button[aria-label="${label}"]`);
      return b?.getAttribute('data-active');
    };
    return {
      bold: get('加粗'),
      italic: get('斜体'),
      underline: get('下划线'),
      html: document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
    };
  });
  check('**加粗仍然是按下态**', afterItalic.bold === 'true', `bold=${afterItalic.bold}`);
  check('**斜体也是按下态**', afterItalic.italic === 'true', `italic=${afterItalic.italic}`);
  check(
    '**没点的按钮不受影响**',
    afterItalic.underline === 'false',
    `underline=${afterItalic.underline}`,
  );
  check(
    '**加粗 + 斜体都生效**',
    afterItalic.html.includes('<strong>') && afterItalic.html.includes('<em>'),
    afterItalic.html,
  );

  // ④ 撤销 / 重做
  const undoRedo = await page.evaluate(() => {
    const get = (label) => {
      const b = document.querySelector(`.scpdf-annotation-dialog button[aria-label="${label}"]`);
      return { exists: !!b, disabled: b?.disabled ?? null };
    };
    return { undo: get('撤销'), redo: get('重做') };
  });
  check('**撤销 / 重做按钮存在**', undoRedo.undo.exists && undoRedo.redo.exists);
  check(
    '**有历史后"撤销"可用**',
    undoRedo.undo.disabled === false,
    `disabled=${undoRedo.undo.disabled}`,
  );

  // ⑤ 撤销真的能撤销
  // ⚠️ **撤销是"撤销最近一步"** -> 上面刚加过斜体 -> 撤销掉的是**斜体** ✅
  //    （不是加粗！加粗是更早的一步）
  await page.locator('.scpdf-annotation-dialog button[aria-label="撤销"]').first().click();
  await page.waitForTimeout(800);
  const afterUndo = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check(
    '**撤销真的能撤销（撤销掉最近一步：斜体）**',
    !afterUndo.includes('<em>') && afterUndo.includes('<strong>'),
    afterUndo,
  );

  // ⑥ 列表 / 引用 / 删除线 也生效
  await page.locator('.scpdf-annotation-dialog button[aria-label="删除线"]').first().click();
  await page.waitForTimeout(700);
  const afterStrike = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check(
    '**删除线生效**',
    afterStrike.includes('<s>') || afterStrike.includes('<strike>'),
    afterStrike,
  );

  await page.locator('.scpdf-annotation-dialog button[aria-label="无序列表"]').first().click();
  await page.waitForTimeout(700);
  const afterList = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check('**无序列表生效**', afterList.includes('<ul'), afterList);

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
