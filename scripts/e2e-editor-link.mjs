/**
 * E2E：**链接弹窗**（用户反馈：
 * "链接弹窗是默认的弹窗 而且要先选中文字才行 应该按照飞书那种去添加
 *  输入框有两行 第一行是链接 第二行是要展示的文字
 *  如果选择了文字 就带到输入框里 这个输入框你自己写一个出来 不要用系统默认的框 很丑
 *  如果用户没有选择文字 要展示的文字就默认是输入的网址 框内可以修改文字
 *  然后输入了链接之后再往后加文字 还是链接的样式 这逻辑就没有一个是对的"）。
 *
 * ## 验证什么
 *
 * 1. **不弹系统 `window.prompt`**（用自己写的弹窗）
 * 2. **两行输入框**（链接 / 显示文字）
 * 3. **选了文字 -> 第 2 行自动带上**（用户的需求）
 * 4. **第 2 行跟着第 1 行联动**（填了网址 -> 第 2 行变成网址）
 * 5. **用户手动改过第 2 行 -> 不再跟随**
 * 6. **没选文字 -> 插入"展示文字"并打上链接**
 * 7. **输入链接后继续打字 -> 不是链接样式**（用户反馈的 bug）
 * 8. **确定后焦点回到编辑器**（能接着打字）
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
let sawSystemDialog = false;
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
page.on('dialog', async (d) => {
  sawSystemDialog = true;
  console.log(`  !!! 系统弹窗: ${d.type()} ${JSON.stringify(d.message())}`);
  await d.dismiss();
});

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

  // 点链接
  await page.locator('.scpdf-annotation-dialog button[aria-label="链接"]').first().click();
  await page.waitForTimeout(900);

  check('**不弹系统 `window.prompt`**', !sawSystemDialog);
  check('**打开了自己的链接弹窗**', (await page.locator('.scpdf-link-popover').count()) === 1);

  const popInfo = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-link-popover');
    const inputs = [...p.querySelectorAll('input')];
    return {
      inputCount: inputs.length,
      values: inputs.map((i) => i.value),
      labels: [...p.querySelectorAll('.scpdf-link-popover__label')].map((l) => l.textContent),
      buttons: [...p.querySelectorAll('button')].map((b) => b.textContent),
    };
  });

  check('**弹窗里是两行输入框**', popInfo.inputCount === 2, `${popInfo.inputCount} 个`);
  check(
    '**第 2 行自动带上选中的文字**（用户的需求）',
    popInfo.values[1] === 'hello world',
    `"${popInfo.values[1]}"`,
  );
  check('**第 1 行是空的（等你填链接）**', popInfo.values[0] === '', `"${popInfo.values[0]}"`);
  check(
    '**有「取消」「确定」按钮**',
    popInfo.buttons.includes('取消') && popInfo.buttons.includes('确定'),
    popInfo.buttons.join('/'),
  );

  // 填链接 -> 第 2 行联动
  const inputs = page.locator('.scpdf-link-popover input');
  await inputs.nth(0).fill('example.com/page');
  await page.waitForTimeout(500);
  const linked = await inputs.nth(1).inputValue();
  check(
    '**填了网址 -> 第 2 行自动变成网址**（用户的需求）',
    linked === 'example.com/page',
    `"${linked}"`,
  );

  // 手动改第 2 行 -> 不再跟随
  await inputs.nth(1).fill('我的自定义文字');
  await page.waitForTimeout(300);
  await inputs.nth(0).fill('other.com/x');
  await page.waitForTimeout(500);
  const afterTouch = await inputs.nth(1).inputValue();
  check(
    '**用户手动改过第 2 行 -> 不再被第 1 行覆盖**',
    afterTouch === '我的自定义文字',
    `"${afterTouch}"`,
  );

  // 确定
  await page.locator('.scpdf-link-popover button:has-text("确定")').click();
  await page.waitForTimeout(900);

  const afterConfirm = await page.evaluate(() => ({
    html: document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
    focused:
      document.activeElement?.classList?.contains('ProseMirror') ??
      document.activeElement?.className?.toString().includes('ProseMirror') ??
      false,
  }));

  check(
    '**确定后焦点回到编辑器**（能接着打字）',
    afterConfirm.focused,
    `focused=${afterConfirm.focused}`,
  );
  check(
    '**选中的文字被打上了链接**',
    afterConfirm.html.includes('href="https://other.com/x"') &&
      afterConfirm.html.includes('我的自定义文字'),
    afterConfirm.html,
  );

  // 继续打字 -> 不该是链接样式
  await page.keyboard.type('XYZ', { delay: 60 });
  await page.waitForTimeout(800);
  const afterType = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check(
    '**输入链接后继续打字 -> 不是链接样式**（用户反馈的 bug）',
    afterType.includes('</a>XYZ'),
    afterType,
  );

  // 没选文字 -> 插入"展示文字"并打链接
  await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    const ed = el.editor;
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
  });
  await page.waitForTimeout(400);
  await page.locator('.scpdf-annotation-dialog button[aria-label="链接"]').first().click();
  await page.waitForTimeout(800);
  const noSel = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.scpdf-link-popover input')];
    return inputs.map((i) => i.value);
  });
  check('**没选文字 -> 第 2 行是空的（等你填）**', noSel[1] === '', `"${noSel[1]}"`);
  await page.locator('.scpdf-link-popover input').nth(0).fill('noselect.com');
  await page.waitForTimeout(500);
  await page.locator('.scpdf-link-popover button:has-text("确定")').click();
  await page.waitForTimeout(900);
  const inserted = await page.evaluate(
    () => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML ?? '',
  );
  check(
    '**没选文字 -> 插入"展示文字"并打上链接**',
    inserted.includes('href="https://noselect.com"') && inserted.includes('noselect.com'),
    inserted,
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
