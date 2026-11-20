/**
 * E2E：**编辑批注**（用户反馈：
 * "富文本编辑完之后没有保存按钮啊 保存都保存不了
 *  而且 富文本点了编辑 怎么富文本编辑框还在文档最上面啊 要出现在视野里啊 就点的旁边"）。
 *
 * ## 验证什么
 *
 * 1. **点"编辑" -> 打开锚点弹窗**（不是右侧面板）
 * 2. **弹窗贴在批注旁边**（不是页面顶部 / 视口外）
 * 3. **弹窗里有「保存」「取消」按钮**
 * 4. **内容是原批注的内容**（可以接着改）
 * 5. **点「保存」-> 内容真的更新了**
 * 6. **点「取消」-> 不保存**
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
  await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
  await page.keyboard.type('原始批注内容', { delay: 40 });
  await page.waitForTimeout(600);
  await page.locator('.scpdf-annotation-dialog button:has-text("保存")').first().click();
  await page.waitForTimeout(2000);

  const noteBox = await page.locator('.scpdf-sticky-note').first().boundingBox();
  check('**批注已创建**', Boolean(noteBox), JSON.stringify(noteBox));

  // hover -> 点编辑
  await page.locator('.scpdf-sticky-note').first().hover();
  await page.waitForTimeout(800);
  await page.locator('button[aria-label="编辑批注"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(2500);

  const editInfo = await page.evaluate(() => {
    const d = document.querySelector('.scpdf-annotation-dialog');
    if (!d) return { exists: false };
    const r = d.getBoundingClientRect();
    return {
      exists: true,
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      position: getComputedStyle(d).position,
      title: d.querySelector('.scpdf-annotation-dialog__title')?.textContent ?? '',
      buttons: [...d.querySelectorAll('button')].map(
        (b) => (b.textContent ?? '').trim() || b.getAttribute('aria-label'),
      ),
      editorText: d.querySelector('.ProseMirror')?.textContent ?? '',
      panelExists: !!document.querySelector('.scpdf-annotation-panel'),
    };
  });

  check('**点"编辑" -> 打开了弹窗**', editInfo.exists);
  check(
    '**弹窗是锚定定位的（position: fixed）**',
    editInfo.position === 'fixed',
    editInfo.position,
  );
  check('**弹窗标题是「编辑批注」**', editInfo.title.includes('编辑批注'), editInfo.title);
  check(
    '**弹窗里有「保存」「取消」按钮**',
    editInfo.buttons.includes('保存') && editInfo.buttons.includes('取消'),
    editInfo.buttons.slice(-3).join('/'),
  );
  check(
    '**内容是原批注的内容**',
    editInfo.editorText.includes('原始批注内容'),
    `"${editInfo.editorText}"`,
  );
  check(
    '**不再打开右侧的便利贴面板**',
    editInfo.panelExists === false,
    `panel=${editInfo.panelExists}`,
  );

  // 弹窗在批注旁边（不是视口顶部）
  if (noteBox && editInfo.exists) {
    const dx = Math.abs(editInfo.x - noteBox.x);
    const dy = Math.abs(editInfo.y - noteBox.y);
    check(
      '**弹窗贴在批注旁边**（不是页面顶部 / 视口外）',
      editInfo.x > 0 &&
        editInfo.x < 1400 - editInfo.w &&
        editInfo.y > 0 &&
        editInfo.y < 900 - editInfo.h &&
        dx < 400 &&
        dy < 400,
      `批注=(${Math.round(noteBox.x)},${Math.round(noteBox.y)}) 弹窗=(${editInfo.x},${editInfo.y})`,
    );
  }

  // 改内容 -> 保存
  const pm = page.locator('.scpdf-annotation-dialog .ProseMirror');
  await pm.click();
  await page.keyboard.press('End');
  await page.keyboard.type('（已修改）', { delay: 40 });
  await page.waitForTimeout(600);
  await page.locator('.scpdf-annotation-dialog button:has-text("保存")').first().click();
  await page.waitForTimeout(2000);

  const saved = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('.scpdf-sticky-note')];
    return notes.map((n) => n.textContent ?? '').join(' | ');
  });
  check('**点「保存」-> 内容真的更新了**', saved.includes('已修改'), `"${saved}"`);
  check('**保存后弹窗关闭了**', (await page.locator('.scpdf-annotation-dialog').count()) === 0);

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
