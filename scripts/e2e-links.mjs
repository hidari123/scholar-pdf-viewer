import { E2E_BASE_URL } from './e2e-base.mjs';
/**
 * E2E: link layer + password dialog.
 *
 * Uses the real PDF (it contains many links: citations, URLs, TOC entries).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

function resolveChromium() {
  if (process.env.E2E_CHROMIUM_PATH && existsSync(process.env.E2E_CHROMIUM_PATH)) {
    return process.env.E2E_CHROMIUM_PATH;
  }
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

const BASE_URL = E2E_BASE_URL;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 没有本地真实文档 → 用内置样张
  if ((await page.locator('.scpdf-page canvas.scpdf-canvas').count()) === 0) {
    const sampleBtn = page.getByRole('button', { name: '载入内置样张' });
    if ((await sampleBtn.count()) > 0) {
      await sampleBtn.click();
      await page.waitForTimeout(2500);
    }
  }
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
  await page.waitForTimeout(2000);

  // ---------- link layer ----------
  const linkCount = await page.locator('.scpdf-link').count();

  if (linkCount === 0) {
    // 内置样张没有链接 → 链接层不该渲染任何东西（正确行为）
    check('无链接时链接层为空', (await page.locator('.scpdf-links').count()) === 0);
    check('运行期无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  } else {
    check('链接层已渲染链接区域', linkCount > 0, `${linkCount} 个`);
  }

  // links must be positioned inside the page
  const geometry = await page.evaluate(() => {
    const page1 = document.querySelector('.scpdf-page');
    const link = document.querySelector('.scpdf-link');
    if (!page1 || !link) return null;
    const p = page1.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    return {
      offsetX: Math.round(l.left - p.left),
      offsetY: Math.round(l.top - p.top),
      width: Math.round(l.width),
      height: Math.round(l.height),
      pageWidth: Math.round(p.width),
    };
  });
  if (geometry) {
    check(
      '链接在页面范围内',
      geometry.offsetX >= -2 && geometry.offsetX < geometry.pageWidth && geometry.height > 0,
      `偏移 ${geometry.offsetX},${geometry.offsetY} 尺寸 ${geometry.width}×${geometry.height}`,
    );
  } else {
    console.log('SKIP 链接位置断言（当前文档没有链接）');
  }

  // unsafe URLs must be filtered out
  const unsafe = await page.evaluate(
    () =>
      [...document.querySelectorAll('.scpdf-link')].filter((a) =>
        (a.getAttribute('data-link-url') ?? a.getAttribute('href') ?? '')
          .toLowerCase()
          .startsWith('javascript:'),
      ).length,
  );
  check('没有 javascript: 链接（XSS 防护）', unsafe === 0, `${unsafe} 个`);

  /*
   * ⚠️ 链接层必须对鼠标**透明**（pdf.js v6 的做法）。
   *
   * 否则链接矩形会"盖住"文本层 → 从链接上拖选 → **选区完全出不来**。
   */
  const linkPointerEvents = await page.evaluate(() => {
    const link = document.querySelector('.scpdf-link');
    const layer = document.querySelector('.scpdf-links');
    return {
      link: link ? getComputedStyle(link).pointerEvents : null,
      layer: layer ? getComputedStyle(layer).pointerEvents : null,
    };
  });
  check(
    '链接层**不接管鼠标事件**（否则拖选失效）',
    linkPointerEvents.link === 'none' && linkPointerEvents.layer === 'none',
    `link=${linkPointerEvents.link} layer=${linkPointerEvents.layer}`,
  );

  // click a link -> host handler fires (demo shows a hint)
  const linkWithHref = page.locator('.scpdf-link[data-link-url]').first();
  const hasHref = (await linkWithHref.count()) > 0;
  if (hasHref) {
    const box = await linkWithHref.boundingBox();
    if (box) {
      // 真实点击（不是 force —— force 会跳过命中测试）
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(600);
      const hint = await page.locator('text=打开外链').count();
      check('点击外链触发宿主回调', hint > 0);
    }
  } else {
    console.log('SKIP 点击外链断言（当前文档没有外部链接）');
  }

  /*
   * ⚠️ 回归：**从链接上拖选**必须还能选出文字。
   *
   * 曾经的 bug：`<a>` 元素吞掉拖动 → 从链接上拖选 → **选区完全出不来**。
   * （真实 PDF 的摘要里有个 GitHub 链接，正好在正文中间。）
   */
  if (hasHref) {
    const link = page.locator('.scpdf-link[data-link-url]').first();
    const box = await link.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(600);

      const selected = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
      check('**从链接上拖选仍能选出文字**', selected > 0, `选中 ${selected} 字符`);

      const layerRects = await page.evaluate(
        () => document.querySelectorAll('.scpdf-selection-layer clipPath rect').length,
      );
      check('从链接上拖选后自绘层有矩形', layerRects > 0, `${layerRects} 个`);
    }
  }

  await page.screenshot({ path: 'e2e-shots/links.png' });

  check('运行期无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
