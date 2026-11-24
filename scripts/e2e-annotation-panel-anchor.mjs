/**
 * E2E：**批注详情的位置 / 宽度 / 工具栏**。
 *
 * ## 用户反馈
 *
 * > "如果同一位置两个批注 那么第一个批注点击之后展示位置正常
 * >  第二个批注详情点击之后还是会出现在pdf的首页位置
 * >  而且滚动的时候 定位也跑来跑去的
 * >  希望和编辑页面保持一致 宽度也一直吧
 * >  这样转成编辑页面的时候 工具栏不会分成两行展示"
 *
 * ## 真因（实测）
 *
 * -> 同一位置的批注**合并成一个图标** ✅
 * -> 那个图标只有 `data-note-id={first.id}`（第一条）❌
 * -> 选**第二条** -> 精确匹配**找不到** ❌ -> 锚点**保持旧值** ❌
 * -> -> 面板停在**首页** ❌
 *
 * ## 修法
 *
 * -> 图标带**整组**的 id（`data-note-ids`）✅
 * -> 锚点查找找"**包含这个 id**"的图标 ✅
 * -> 滚动定位：**一个 rAF 循环**一直跟着 ✅
 * -> 面板宽度 **360px** ✅ -> 工具栏**不换行** ✅
 *
 * 用法：`node scripts/e2e-annotation-panel-anchor.mjs`
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

console.log('E2E：批注详情的位置 / 宽度 / 工具栏');

/** 做一条高亮 + 两条同一行的批注 */
async function setup() {
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const t = items.find((i) => i.textContent && i.textContent.trim().length > 40);
    if (!t) return;
    const r = t.getBoundingClientRect();
    const range = document.createRange();
    range.setStart(t.firstChild, 0);
    range.setEnd(t.firstChild, Math.min(30, t.firstChild.length ?? 30));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: r.x + 10, clientY: r.y + 8 }),
    );
  });
  await page.waitForTimeout(1200);
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const hid = document.querySelector('.scpdf-annotation')?.getAttribute('data-highlight-id');
    // @ts-expect-error 测试用的全局句柄
    window.__scpdfDemo?.makeSameLineNotes(hid ?? '');
  });
  await page.waitForTimeout(1500);
}

/** hover 便签 -> 打开"选择列表" -> 点第 N 项 */
async function pickFromGroup(index) {
  const note = await page.evaluate(() => {
    const n = document.querySelector('.scpdf-sticky-note');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!note) return false;
  await page.mouse.move(note.x, note.y);
  await page.waitForTimeout(800);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-sticky-note__picker-item')].map((b) => {
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    }),
  );
  const item = items[index];
  if (!item) return false;
  await page.mouse.click(item.x + 5, item.y + 5);
  await page.waitForTimeout(1400);
  return true;
}

/** 面板和便签的位置 */
async function readPositions() {
  return page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-panel');
    const n = document.querySelector('.scpdf-sticky-note');
    if (!p || !n) return null;
    const pr = p.getBoundingClientRect();
    const nr = n.getBoundingClientRect();
    return {
      panel: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width) },
      note: { x: Math.round(nr.x), y: Math.round(nr.y) },
      dy: Math.round(pr.y - nr.y),
    };
  });
}

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

  await setup();

  // ---------- ① 点【第一条】 ----------
  check('**能打开选择列表**', await pickFromGroup(0));
  const first = await readPositions();
  console.log('   第一条:', JSON.stringify(first));
  check('**第一条：面板贴着便签**', !!first && Math.abs(first.dy) < 120, `dy=${first?.dy}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // ---------- ② 点【第二条】（用户报的核心问题）----------
  check('**能打开选择列表（第二条）**', await pickFromGroup(1));
  const second = await readPositions();
  console.log('   第二条:', JSON.stringify(second));
  check('**第二条：面板也贴着便签**', !!second && Math.abs(second.dy) < 120, `dy=${second?.dy}`);
  check(
    '**第二条：面板位置和第一条一致**（不是停在旧位置）',
    !!first && !!second && Math.abs(second.panel.y - first.panel.y) < 20,
    `第一=${first?.panel.y} 第二=${second?.panel.y}`,
  );

  // ---------- ③ 滚动时面板跟着走 ----------
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop += 250;
  });
  await page.waitForTimeout(900);
  const afterScroll = await readPositions();
  console.log('   滚动后:', JSON.stringify(afterScroll));
  check(
    '**滚动后面板仍然贴着便签**（不跑）',
    !!afterScroll && Math.abs(afterScroll.dy) < 120,
    `dy=${afterScroll?.dy}`,
  );

  // ---------- ④ 宽度 ----------
  // ⚠️ **测的是 border-box**（含 1px 边框 x2）-> 360 + 2 = 362 ✅
  check(
    '**面板宽度是 360px**（含边框 362）',
    !!afterScroll && afterScroll.panel.w === 362,
    `${afterScroll?.panel.w}px`,
  );

  // ---------- ⑤ 编辑态的工具栏不换行 ----------
  await page.locator('.scpdf-annotation-panel [aria-label="编辑批注"]').click();
  await page.waitForTimeout(1200);
  const tb = await page.evaluate(() => {
    const t = document.querySelector('.scpdf-rich-text__toolbar');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const btns = [...t.querySelectorAll('.scpdf-rich-text__btn')];
    const rows = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().y)));
    return {
      h: Math.round(r.height),
      btns: btns.length,
      rows: rows.size,
      panelW: Math.round(
        document.querySelector('.scpdf-annotation-panel')?.getBoundingClientRect().width ?? 0,
      ),
    };
  });
  console.log('   工具栏:', JSON.stringify(tb));
  check(
    '**编辑态的工具栏只有 1 行**',
    !!tb && tb.rows === 1,
    `${tb?.rows} 行 / ${tb?.btns} 个按钮`,
  );
  check(
    '**编辑态面板宽度不变**（详情 <-> 编辑不跳宽）',
    !!tb && tb.panelW === 362,
    `${tb?.panelW}px`,
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
