/**
 * E2E：**面板开合时的选区定位**。
 *
 * 用户反馈："如果缩略图或者是打开的状态 框选文字的时候会整体往右偏移"
 *
 * ## 为什么要有这个测试
 *
 * 页是 `margin-inline: auto` **居中**的 → 页框的 `left` 会随
 * **面板开合 / 缩放 / 容器尺寸**变化。
 *
 * 而 `pageLeft` 是**量出来的** → 测量时机不对就会量错
 * （实测：面板打开后量成 −245 → 整个选区偏 245px）。
 *
 * → 这个测试专门覆盖"面板开/关"两种状态下的选区位置。
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

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const sampleBtn = page.getByRole('button', { name: '载入内置样张' });
  if ((await sampleBtn.count()) > 0) {
    await sampleBtn.click();
  }
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
  await page.waitForTimeout(2500);

  /** 打开缩略图面板（返回是否成功） */
  const togglePanel = async () => {
    const btn = page
      .locator('[aria-label="缩略图"], [aria-label="打开缩略图"], [aria-label="关闭缩略图"]')
      .first();
    if ((await btn.count()) === 0) return false;
    await btn.click();
    await page.waitForTimeout(1200);
    return true;
  };

  /**
   * 选一段文字 → 量"自绘选区块"和"浏览器选区"的位置差。
   *
   * ⚠️ **要比自绘块和浏览器选区**，而不是和画布墨迹 ——
   *    这里验的是"**选区块画在哪**"（页面定位对不对），
   *    墨迹对齐是 `e2e-zoom-matrix` 的职责。
   */
  const selectAndMeasure = async () => {
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.waitForTimeout(250);

    const t = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
        const r = x.getBoundingClientRect();
        const fs = Number.parseFloat(getComputedStyle(x).fontSize);
        return (
          fs > 10 &&
          (x.textContent ?? '').trim().length > 20 &&
          r.width > 150 &&
          r.top > 150 &&
          r.top < 600
        );
      });
      const el = spans[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.min(r.left + 12, r.right - 20),
        y: r.top + r.height * 0.3,
        w: r.width,
      };
    });
    if (!t) return null;

    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + Math.max(30, Math.min(180, t.w - 24)), t.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    return page.evaluate(() => {
      const rects = [...document.querySelectorAll('.scpdf-selection-layer clipPath rect')];
      const first = rects[0];
      const pageEl = document.querySelector('.scpdf-page');
      const pr = pageEl?.getBoundingClientRect();

      /*
       * ⚠️ **参考基准不能用 `range.getBoundingClientRect()`**（实测踩过的坑）。
       *
       * 浏览器的 Range 会把**页边戳**（逐字符竖排，在 x=1226）也包进来
       * → `rr.top` / `rr.left` 被污染 → Δ上 = 15（看起来"偏了"）
       *   其实**自绘的选区块是对的**（页边戳已经被包过滤掉了）。
       *
       * → 改用**选中的文字 span**（真正被选中的那些）做基准。
       */
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) {
        return { ok: false, rects: rects.length };
      }
      const range = s.getRangeAt(0);
      const selectedSpans = [...range.getClientRects()].filter(
        (r) => r.width > 0 && r.height > 0 && r.left < pr.left + (pr?.width ?? 0) - 60,
      );
      const inkLeft = Math.min(...selectedSpans.map((r) => r.left));

      /*
       * ⚠️⚠️ **垂直基准必须用"文字 span 的 top"，不能用 client rect 的 top**（实测踩过的坑）。
       *
       * 浏览器的 client rect = **字体的自然行盒**（比文字高、偏上）
       * ```
       * 无面板: clientTop=198.33（行盒）  spanTop=200（字形）  drawnTop=200.34
       * 有面板: clientTop=321.19（行盒）  spanTop=326（字形）  drawnTop=326.20
       * ```
       * → 自绘块是**贴着字形**的（这是刻意的：让高亮块和文字对齐）
       * → 和行盒比 → **天然差 2~5px** → 那是**正常的**，不是定位错了。
       *
       * → 而且这个差值**和面板开不开无关**（是字体的固有行高）
       * → 用行盒当基准 → 字号大的行差得多 → **误报**。
       *
       * → 正确基准：**被选中的文字 span 的 top**（= 字形盒的 top）。
       */
      const inkSpans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) =>
        range.intersectsNode(x),
      );
      const inkTop = inkSpans.length
        ? Math.min(...inkSpans.map((x) => x.getBoundingClientRect().top))
        : Math.min(...selectedSpans.map((r) => r.top));

      if (!first || !pr || selectedSpans.length === 0) {
        return { ok: false, rects: rects.length };
      }

      // 自绘块的**视口**位置（页内坐标 + 页的视口偏移）
      const selViewportLeft = Number.parseFloat(first.getAttribute('x')) + pr.left;
      const selViewportTop = Number.parseFloat(first.getAttribute('y')) + pr.top;

      return {
        ok: true,
        rects: rects.length,
        dLeft: Math.round(selViewportLeft - inkLeft),
        dTop: Math.round(selViewportTop - inkTop),
        panelOpen: !!document.querySelector('.scpdf-panel'),
        pageLeftContent: Math.round(
          pr.left - (document.querySelector('.scpdf-container')?.getBoundingClientRect().left ?? 0),
        ),
      };
    });
  };

  // ---- 1. 无面板 ----
  console.log('\n=== 无面板 ===');
  const before = await selectAndMeasure();
  check('无面板：选区块已生成', before?.ok === true, `${before?.rects ?? 0} 个`);
  check(
    '无面板：选区块位置正确（Δ ≤ 3px）',
    before?.ok && Math.abs(before.dLeft) <= 3 && Math.abs(before.dTop) <= 3,
    `Δ左=${before?.dLeft} Δ上=${before?.dTop}`,
  );

  // ---- 2. 打开面板 ----
  console.log('\n=== 打开面板 ===');
  const opened = await togglePanel();
  check('缩略图面板已打开', opened);

  const after = await selectAndMeasure();
  check('有面板：选区块已生成', after?.ok === true, `${after?.rects ?? 0} 个`);
  check(
    '有面板：选区块位置正确（Δ ≤ 3px）',
    after?.ok && Math.abs(after.dLeft) <= 3 && Math.abs(after.dTop) <= 3,
    `Δ左=${after?.dLeft} Δ上=${after?.dTop}`,
  );

  // ---- 3. 面板开合后，页的居中偏移要重新测量 ----
  console.log('\n=== 面板开合后 ===');
  const _pageLeftNoPanel = before?.pageLeftContent;
  // 关闭面板
  await togglePanel();
  await page.waitForTimeout(800);
  const closed = await selectAndMeasure();
  check(
    '面板关闭后：选区块位置恢复正确（Δ ≤ 3px）',
    closed?.ok && Math.abs(closed.dLeft) <= 3 && Math.abs(closed.dTop) <= 3,
    `Δ左=${closed?.dLeft} Δ上=${closed?.dTop}`,
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
