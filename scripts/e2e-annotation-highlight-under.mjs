/**
 * E2E：批注期间点到底下的高亮 —— **蓝色选区框不能消失**。
 *
 * ## 用户反馈
 *
 * > "如果已经高亮了一个区域 然后再准备对另外一个区域进行批注
 *    此时打开的批注框 如果刚好在那个高亮的上面
 *    点击批注框里面的东西的时候 下面的高亮会选中
 *    原来的准备进行批注的已经选择的区域会消失选区的蓝色框选的底"
 *
 * ## 根因
 *
 * -> `handleHighlightClick` **无条件** `setSelectionShapes(new Map())` ❌
 * -> 批注期间点到底下的高亮 -> 蓝色框被擦掉 ❌
 *
 * ## 修法
 *
 * -> 批注期间（`isPendingNoteRef.current`）-> **不清选区** ✅
 * -> 蓝色框保留 + 批注弹窗不关 ✅
 *
 * 用法：`node scripts/e2e-annotation-highlight-under.mjs`
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5180';

/** 找 Playwright 的 Chromium */
function findChromium() {
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(root)) {
    return undefined;
  }
  const dirs = readdirSync(root)
    .filter((n) => n.startsWith('chromium-'))
    .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
    .sort((a, b) => b.v - a.v);
  for (const d of dirs) {
    const exe = join(root, d.n, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const exePath = findChromium();
const browser = await chromium.launch(exePath ? { executablePath: exePath } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  /** 在指定 y 附近拖选一段 */
  const dragSelect = async (y) => {
    const t = await page.evaluate((yy) => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
        (s) => (s.textContent ?? '').trim().length > 20,
      );
      const sp = spans.find((s) => {
        const r = s.getBoundingClientRect();
        return r.width > r.height * 2 && r.top > yy && r.top < yy + 150;
      });
      if (!sp) return null;
      const r = sp.getBoundingClientRect();
      return { x: r.x + 4, y: r.y + r.height / 2 };
    }, y);
    if (!t) return false;
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 60, t.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    return true;
  };

  // ---- ① 先高亮一块 ----
  await dragSelect(250);
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(2000);
  const highlightCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation').length,
  );
  check('先生成一条高亮', highlightCount > 0, `${highlightCount} 条`);

  // ---- ② 在别处选一段 -> 打开批注弹窗 ----
  await dragSelect(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('批注'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2500);

  const before = await page.evaluate(() => ({
    shapes: document.querySelectorAll('.scpdf-selection-layer__fill').length,
    dialogOpen: document.querySelector('.scpdf-root')?.getAttribute('data-dialog-open'),
    // 高亮块的中心点（等下点它）
    anns: [...document.querySelectorAll('.scpdf-annotation')].map((a) => {
      const r = a.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }),
  }));
  check('批注弹窗打开了', before.dialogOpen === 'true');
  check('蓝色选区块存在', before.shapes > 0, `${before.shapes} 个`);

  // ---- ③ 点到底下的高亮块 ----
  const ann = before.anns[0];
  if (ann) {
    await page.mouse.click(ann.x, ann.y);
    await page.waitForTimeout(1200);
  }

  const after = await page.evaluate(() => ({
    shapes: document.querySelectorAll('.scpdf-selection-layer__fill').length,
    dialogOpen: document.querySelector('.scpdf-root')?.getAttribute('data-dialog-open'),
  }));

  check('**点到底下的高亮后，蓝色选区块还在**', after.shapes > 0, `${after.shapes} 个`);
  check('**批注弹窗没有被点掉**', after.dialogOpen === 'true');

  // ---- ④ 高亮块不能出现"被选中"的样式 ----
  const selBg = await page.evaluate(() => {
    const a = document.querySelector('.scpdf-annotation');
    return a ? getComputedStyle(a, '::selection').backgroundColor : null;
  });
  check(
    '**高亮块的 ::selection 是透明的**（不会显示"被选中"）',
    selBg === 'rgba(0, 0, 0, 0)',
    String(selBg),
  );

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  console.log(`FAIL 运行异常 - ${String(error).slice(0, 200)}`);
  failed += 1;
} finally {
  await browser.close();
}

console.log(`\n结果：${passed}/${passed + failed} 通过`);
if (failed > 0) {
  process.exitCode = 1;
}
