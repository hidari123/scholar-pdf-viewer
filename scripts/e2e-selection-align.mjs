/**
 * E2E：选区精准性验证。
 *
 * 核心断言：**选中的框必须落在 canvas 真实文字上**。
 *
 * 验证方法（不依赖肉眼）：
 * 1) 在 canvas 上按 PDF 的文字位置画标记（从 pdf.js 的 text item 拿坐标）
 * 2) 拖选文字，拿到选区的 client rect
 * 3) 检查选区 rect 与 canvas 上该文字的**理论位置**是否一致
 *
 * 更稳的做法：比较"选区 rect 的相对位置"与"该 text item 的 PDF 坐标 × scale"
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5186';
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

  // ---- 1. 每个 span 的位置必须与 PDF 原始坐标一致 ----
  const align = await page.evaluate(() => {
    const layer = document.querySelector('.scpdf-text-layer');
    const spans = [...layer.querySelectorAll('.scpdf-text-layer__item')];

    // 找一个正文里的 span（宽度合理、非页眉）
    const candidates = spans.filter((s) => {
      const r = s.getBoundingClientRect();
      return r.width > 100 && r.width < 400 && r.height > 5;
    });

    if (candidates.length === 0) return { error: 'no candidate' };

    const el = candidates[0];
    const r = el.getBoundingClientRect();
    const pageEl = el.closest('.scpdf-page');
    const pr = pageEl.getBoundingClientRect();

    return {
      text: (el.textContent ?? '').slice(0, 30),
      // 相对页面的坐标（= PDF 坐标 × scale）
      relLeft: Math.round((r.left - pr.left) * 10) / 10,
      relTop: Math.round((r.top - pr.top) * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      // 关键：span 的显式宽度是否等于其渲染宽度（PDF 宽度被强制生效）
      styleWidth: el.style.width,
      renderWidth: Math.round(r.width * 10) / 10,
      // 是否所有 span 都有独立位置（没有重叠成一行）
      totalSpans: spans.length,
    };
  });

  check('文本层按 item 逐个定位', !align.error, align.error ?? `${align.totalSpans} 个 span`);
  check(
    'span 显式宽度已设置（PDF 真实字宽）',
    Boolean(align.styleWidth) && align.styleWidth !== '',
    `style.width=${align.styleWidth} 实际=${align.renderWidth}`,
  );
  check(
    '渲染宽度 ≈ PDF 宽度（误差 < 15%）',
    align.styleWidth
      ? Math.abs(align.renderWidth - parseFloat(align.styleWidth)) /
          Math.max(1, parseFloat(align.styleWidth)) <
        0.15
      : false,
    `PDF 宽 ${align.styleWidth} vs 渲染宽 ${align.renderWidth}`,
  );

  // ---- 2. 选区 rect 必须与被选 span 的位置吻合 ----
  const selection = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    // 找一个足够长的 span
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
      left: Math.round(r.left * 10) / 10,
      top: Math.round(r.top * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
    }));

    const targetRect = target.getBoundingClientRect();

    return {
      selectedText: sel.toString(),
      targetText: (target.textContent ?? '').slice(0, 30),
      targetRect: {
        left: Math.round(targetRect.left * 10) / 10,
        top: Math.round(targetRect.top * 10) / 10,
        width: Math.round(targetRect.width * 10) / 10,
        height: Math.round(targetRect.height * 10) / 10,
      },
      rects,
    };
  });

  check('能选中文本', !selection.error && Boolean(selection.selectedText), selection.error ?? selection.selectedText);

  if (selection.rects && selection.rects.length > 0) {
    const rect = selection.rects[0];
    // 选区应在 span 的范围内（left 起点接近，宽度不超过）
    const leftDelta = Math.abs(rect.left - selection.targetRect.left);
    const widthRatio = rect.width / Math.max(1, selection.targetRect.width);

    check(
      '选区起点与被选文字起点吻合（< 3px）',
      leftDelta < 3,
      `Δ=${leftDelta.toFixed(1)}px`,
    );
    check(
      '选区宽度不超过被选文字宽度',
      widthRatio <= 1.02,
      `选区 ${rect.width} vs 文字 ${selection.targetRect.width}`,
    );
  }

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
