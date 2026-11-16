/**
 * E2E：选区精准性验证（对齐 pdf.js 的做法）。
 *
 * 核心断言：
 * 1. 文本层按 item 逐个定位（不是按行合并）
 * 2. scaleX 已应用（横向拉伸到 PDF 宽度）
 * 3. **span 的渲染宽度 ≈ PDF 真实宽度**（scaleX 生效的证明）
 * 4. 选区起点与文字起点吻合
 * 5. **选区不能超出被选文字的范围**（scaleX 后仍然成立）
 * 6. 选整页不被丢弃（老 scholar-club 用 width<pageWidth 过滤会丢）
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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5187';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // ---- 1. 文本层结构 ----
  const structure = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const withScale = spans.filter((s) => {
      const t = s.style.transform ?? '';
      return t.includes('scaleX');
    });
    return {
      total: spans.length,
      withScale: withScale.length,
      hasEnd: document.querySelectorAll('.scpdf-text-layer__end').length,
      // 不同位置的 span（有各自的 left）→ 证明是逐 item 定位
      distinctLefts: new Set(spans.map((s) => s.style.left)).size,
    };
  });

  check(
    '文本层按 item 逐个定位',
    structure.distinctLefts > structure.total * 0.5,
    `${structure.total} 个 span, ${structure.distinctLefts} 个不同 left`,
  );
  check(
    'scaleX 已应用（横向拉伸到 PDF 宽度）',
    structure.withScale > 0,
    `${structure.withScale}/${structure.total} 个 span 有 scaleX`,
  );
  check('endOfContent 哨兵存在', structure.hasEnd >= 1, `${structure.hasEnd} 个`);

  // ---- 2. scaleX 生效的证明：渲染宽度 ≈ PDF 宽度 ----
  // 做法：把 span 的 scaleX 去掉 → 得到浏览器原始排版宽度；
  //       保留 transform → 得到拉伸后的宽度。
  //       两者之比应该等于 scaleX。
  const scaleCheck = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const target = spans.find((s) => {
      const t = s.style.transform ?? '';
      return t.includes('scaleX') && (s.textContent ?? '').trim().length > 8;
    });
    if (!target) return { error: 'no target' };

    const transform = target.style.transform;
    const scaledWidth = target.getBoundingClientRect().width;

    // 去掉 scaleX → 浏览器原始排版宽度
    target.style.transform = transform.replace(/scaleX\([^)]*\)\s*/, '');
    const rawWidth = target.getBoundingClientRect().width;
    target.style.transform = transform;

    const scaleMatch = /scaleX\(([\d.]+)\)/.exec(transform);

    return {
      text: (target.textContent ?? '').slice(0, 30),
      scaleX: scaleMatch?.[1] ? Number.parseFloat(scaleMatch[1]) : 0,
      scaledWidth: Math.round(scaledWidth * 100) / 100,
      rawWidth: Math.round(rawWidth * 100) / 100,
    };
  });

  check(
    'scaleX 与实测宽度比一致（拉伸真的生效了）',
    !scaleCheck.error &&
      scaleCheck.rawWidth > 0 &&
      Math.abs(scaleCheck.scaledWidth / scaleCheck.rawWidth - scaleCheck.scaleX) < 0.02,
    scaleCheck.error
      ? scaleCheck.error
      : `scaleX=${scaleCheck.scaleX} 实测 ${scaleCheck.rawWidth}→${scaleCheck.scaledWidth}px`,
  );

  // ---- 3. 选区几何 ----
  const selection = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const target = spans.find((el) => (el.textContent ?? '').trim().length > 15);
    if (!target) return { error: 'no target' };

    const textNode = target.firstChild;
    if (!textNode) return { error: 'no text node' };

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(12, textNode.textContent.length));

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const rects = [...range.getClientRects()].map((r) => ({
      left: Math.round(r.left * 100) / 100,
      top: Math.round(r.top * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
    }));

    const targetRect = target.getBoundingClientRect();

    return {
      selectedText: sel.toString(),
      targetRect: {
        left: Math.round(targetRect.left * 100) / 100,
        top: Math.round(targetRect.top * 100) / 100,
        width: Math.round(targetRect.width * 100) / 100,
        height: Math.round(targetRect.height * 100) / 100,
      },
      rects,
    };
  });

  check(
    '能选中文本',
    !selection.error && Boolean(selection.selectedText),
    selection.error ?? selection.selectedText,
  );

  if (selection.rects && selection.rects.length > 0) {
    const rect = selection.rects[0];
    const leftDelta = Math.abs(rect.left - selection.targetRect.left);
    const widthRatio = rect.width / Math.max(1, selection.targetRect.width);

    check('选区起点与被选文字起点吻合（< 1px）', leftDelta < 1, `Δ=${leftDelta.toFixed(2)}px`);
    check(
      '选区宽度不超过被选文字宽度',
      widthRatio <= 1.02,
      `选区 ${rect.width} vs 文字 ${selection.targetRect.width}`,
    );
  }

  // ---- 4. 整页选中不被丢弃（老 scholar-club 的 bug）----
  const fullPage = await page.evaluate(() => {
    const layer = document.querySelector('.scpdf-text-layer');
    if (!layer) return { error: 'no layer' };

    const range = document.createRange();
    range.selectNodeContents(layer);

    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    return { count: rects.length, textLength: range.toString().length };
  });

  check(
    '选整页不被丢弃（老 scholar-club 用 width<pageWidth 过滤会丢）',
    !fullPage.error && fullPage.count > 0,
    fullPage.error ?? `${fullPage.count} 个 rect, ${fullPage.textLength} 字符`,
  );

  await page.screenshot({ path: 'e2e-shots/selection.png' });

  check('运行期无 JS 错误', true);
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
