/**
 * E2E：**批注弹窗的定位 + 编辑器的样子**（用户反馈：
 * "这个富文本编辑框没有定位到批注旁边啊 你这个编辑框定位到文档最上面谁看得到啊
 *  而且这个富文本编辑框 上面输入文字之后第一带黑框 很丑
 *  第二每写一个东西下面就会展示出来一条 只需要同步展示html的富文本就可以了
 *  不用出现黑框包着的输入框"）。
 *
 * ## 验证什么
 *
 * 1. 弹窗**贴在选区旁边**（不是居中 / 不是顶部）
 * 2. **只有一个编辑器**（没有"下面又冒出来一条"）
 * 3. 编辑器**只有一层框**（没有黑框包着的双层输入框）
 * 4. 能**完整打字**
 * 5. 有锚点时**不遮罩**（不整页变暗）
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

  // 滚到中间，选一段**不在屏幕顶部**的文字
  await page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    if (c) c.scrollTop = 2500;
  });
  await page.waitForTimeout(3000);

  const selectionInfo = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    const inView = spans.filter((s) => {
      const r = s.getBoundingClientRect();
      return r.top > 150 && r.bottom < 700 && r.width > r.height;
    });
    if (!inView[0]) return null;
    const sp = inView[0];
    const range = document.createRange();
    const node = sp.firstChild ?? sp;
    range.setStart(node, 0);
    range.setEnd(node, 8);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const r = sp.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  check('**选中了一段文字**', Boolean(selectionInfo), JSON.stringify(selectionInfo));

  await page.waitForTimeout(1500);
  await page.locator('button[aria-label="加批注"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  const dialogInfo = await page.evaluate(() => {
    const d = document.querySelector('.scpdf-annotation-dialog');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const backdrop = document.querySelector('.scpdf-annotation-dialog__backdrop');
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      position: getComputedStyle(d).position,
      anchored: backdrop?.getAttribute('data-anchored'),
      scrim: document.querySelectorAll('.scpdf-annotation-dialog__scrim').length,
      editors: document.querySelectorAll('.scpdf-rich-text__editor').length,
      proseMirror: document.querySelectorAll('.ProseMirror').length,
    };
  });
  check('**弹窗存在**', Boolean(dialogInfo), JSON.stringify(dialogInfo));

  check(
    '**弹窗贴在选区旁边（不是居中/顶部）**',
    dialogInfo &&
      dialogInfo.position === 'fixed' &&
      Math.abs(dialogInfo.y - (selectionInfo?.bottom ?? 0)) < 200,
    `弹窗 y=${dialogInfo?.y}，选区 bottom=${selectionInfo?.bottom}`,
  );

  check(
    '**有锚点 → 不遮罩（不整页变暗）**',
    dialogInfo?.anchored === 'true' && dialogInfo?.scrim === 0,
    `anchored=${dialogInfo?.anchored} scrim=${dialogInfo?.scrim}`,
  );

  check(
    '**只有一个编辑器（没有"下面又冒出来一条"）**',
    dialogInfo?.editors === 1 && dialogInfo?.proseMirror === 1,
    `editors=${dialogInfo?.editors} proseMirror=${dialogInfo?.proseMirror}`,
  );

  // 打字
  const pm = page.locator('.scpdf-annotation-dialog .ProseMirror');
  await pm.click();
  await page.keyboard.type('这是测试批注内容', { delay: 40 });
  await page.waitForTimeout(800);

  const afterType = await page.evaluate(() => {
    const pms = document.querySelectorAll('.ProseMirror');
    const eds = document.querySelectorAll('.scpdf-rich-text__editor');
    return {
      proseMirror: pms.length,
      editors: eds.length,
      text: pms[0]?.textContent ?? '',
      // 外层容器**不应该**有自己的边框（边框只在内层）
      outerBorder: eds[0] ? getComputedStyle(eds[0]).borderTopWidth : 'n/a',
      innerBorder: pms[0] ? getComputedStyle(pms[0]).borderTopWidth : 'n/a',
    };
  });

  check('**能完整打字**', afterType.text.includes('这是测试批注内容'), `"${afterType.text}"`);

  check(
    '**打字后还是只有一个编辑器**',
    afterType.proseMirror === 1 && afterType.editors === 1,
    `proseMirror=${afterType.proseMirror} editors=${afterType.editors}`,
  );

  check(
    '**只有一层框（外层无边框，内层有）**',
    afterType.outerBorder === '0px' && afterType.innerBorder !== '0px',
    `外层=${afterType.outerBorder} 内层=${afterType.innerBorder}`,
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
