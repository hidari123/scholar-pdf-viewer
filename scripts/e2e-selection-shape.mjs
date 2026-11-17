/**
 * E2E：选区形状（"大长方形"回归）+ 高亮后的选区清理。
 *
 * 断言：
 * 1. 跨行选择 → **一行一个矩形**（不是一个大长方形）
 * 2. 旋转文字（页边戳）的巨型矩形**不参与**绘制
 * 3. 选区清空 → 自绘层消失
 * 4. 高亮后 → 自绘层消失（不叠在高亮上）
 * 5. 高亮后 → 还能继续选下一段（浮层能再次出现）
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5200';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  // 滚到有正文的地方
  await page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    if (c) c.scrollTop = 1000;
  });
  await page.waitForTimeout(1500);

  /** 找若干个有文字的行 */
  const getLines = () =>
    page.evaluate(() => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
        const r = x.getBoundingClientRect();
        return (
          r.top > 150 && r.top < 850 && (x.textContent ?? '').trim().length > 40 && r.width > 250
        );
      });
      const rows = [];
      for (const s of spans) {
        const r = s.getBoundingClientRect();
        let row = rows.find((rw) => Math.abs(rw.top - r.top) < 12);
        if (!row) {
          row = { top: r.top, left: r.left, right: r.right };
          rows.push(row);
        }
        row.left = Math.min(row.left, r.left);
        row.right = Math.max(row.right, r.right);
      }
      rows.sort((a, b) => a.top - b.top);
      return rows.slice(0, 4).map((r) => ({
        top: Math.round(r.top),
        left: Math.round(r.left),
        right: Math.round(r.right),
      }));
    });

  const lines = await getLines();
  check('找到多行正文', lines.length >= 3, `${lines.length} 行`);

  if (lines.length >= 3) {
    // 从行 1 中间拖到行 3 中间
    const last = lines[2];
    await page.mouse.move(
      Math.round(lines[0].left + (lines[0].right - lines[0].left) * 0.5),
      lines[0].top + 8,
    );
    await page.mouse.down();
    await page.mouse.move(Math.round(last.left + (last.right - last.left) * 0.5), last.top + 8, {
      steps: 20,
    });
    await page.mouse.up();
    await page.waitForTimeout(800);

    const shapes = await page.evaluate(() => {
      const svg = document.querySelector('.scpdf-selection-layer');
      if (!svg) return { err: 'no layer' };
      const pr = svg.closest('.scpdf-page')?.getBoundingClientRect();
      const rects = [...svg.querySelectorAll('clipPath rect')].map((r) => ({
        l: Number(r.getAttribute('x')) + (pr?.left ?? 0),
        t: Number(r.getAttribute('y')) + (pr?.top ?? 0),
        w: Number(r.getAttribute('width')),
        h: Number(r.getAttribute('height')),
      }));
      return { rects };
    });

    if (shapes.err) {
      check('自绘选区层存在', false, shapes.err);
    } else {
      const maxH = Math.max(...shapes.rects.map((r) => r.h));
      const tall = shapes.rects.filter((r) => r.h > 100);

      check(
        '**没有异常高的矩形**（旋转文字的巨型矩形被剔除）',
        tall.length === 0,
        `最高 ${Math.round(maxH)}px，>100px 的有 ${tall.length} 个`,
      );

      /*
       * 跨行选择 → 每行一个矩形。
       *
       * 判据：矩形的**垂直跨度**不能覆盖所有行。
       * 旧实现（巨型矩形吸收）会出现一个跨越多行的大矩形。
       */
      const minT = Math.min(...shapes.rects.map((r) => r.t));
      const maxB = Math.max(...shapes.rects.map((r) => r.t + r.h));
      const span = maxB - minT;

      // 一个大长方形会横跨所有选中的行
      const oneBig = shapes.rects.some((r) => r.h > span * 0.8);
      check(
        '**不是一个大长方形**（每行独立成矩形）',
        !oneBig,
        `总跨度 ${Math.round(span)}px，最大单矩形 ${Math.round(maxH)}px`,
      );
    }

    // ---- 选区清空 → 自绘层消失 ----
    await page.mouse.click(100, 780);
    await page.waitForTimeout(500);
    const afterClear = await page.evaluate(() => ({
      layers: document.querySelectorAll('.scpdf-selection-layer').length,
      rects: document.querySelectorAll('.scpdf-selection-layer clipPath rect').length,
    }));
    check(
      '选区清空后自绘层消失（不残留旧选区）',
      afterClear.layers === 0 && afterClear.rects === 0,
      `layers=${afterClear.layers} rects=${afterClear.rects}`,
    );

    // ---- 高亮后 → 自绘层消失 + 还能继续选 ----
    const lines2 = await getLines();
    await page.mouse.move(lines2[0].left + 10, lines2[0].top + 8);
    await page.mouse.down();
    await page.mouse.move(lines2[0].left + 120, lines2[0].top + 8, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const popBefore = await page.locator('.scpdf-selection-popover').count();
    check('选中后浮层出现', popBefore > 0);

    await page.locator('button[aria-label="选择高亮颜色"]').click();
    await page.waitForTimeout(300);
    await page.locator('.scpdf-selection-popover__swatch').nth(3).click();
    await page.waitForTimeout(700);

    const afterHl = await page.evaluate(() => ({
      layers: document.querySelectorAll('.scpdf-selection-layer').length,
      pop: document.querySelectorAll('.scpdf-selection-popover').length,
      hls: document.querySelectorAll('.scpdf-annotation--mine').length,
    }));

    check('高亮后自绘层消失（不叠在高亮上）', afterHl.layers === 0, `layers=${afterHl.layers}`);
    check('高亮后浮层关闭', afterHl.pop === 0, `pop=${afterHl.pop}`);
    check('高亮已创建', afterHl.hls > 0, `hls=${afterHl.hls}`);

    // 还能继续选下一段
    const lines3 = await getLines();
    await page.mouse.move(lines3[1].left + 10, lines3[1].top + 8);
    await page.mouse.down();
    await page.mouse.move(lines3[1].left + 100, lines3[1].top + 8, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const afterSecond = await page.evaluate(() => ({
      sel: (window.getSelection()?.toString() ?? '').length,
      pop: document.querySelectorAll('.scpdf-selection-popover').length,
      layers: document.querySelectorAll('.scpdf-selection-layer').length,
    }));

    check(
      '高亮后还能继续选下一段',
      afterSecond.sel > 0 && afterSecond.pop > 0,
      `选中 ${afterSecond.sel} 字，浮层=${afterSecond.pop}`,
    );
  }

  check('全程无 JS 错误', jsErrors.length === 0, jsErrors[0]?.slice(0, 140) ?? '');
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
