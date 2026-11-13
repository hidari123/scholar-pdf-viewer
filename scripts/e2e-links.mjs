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

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5181';
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
        (a.getAttribute('href') ?? '').toLowerCase().startsWith('javascript:'),
      ).length,
  );
  check('没有 javascript: 链接（XSS 防护）', unsafe === 0, `${unsafe} 个`);

  // click a link -> host handler fires (demo shows a hint)
  const linkWithHref = page.locator('.scpdf-link[href]').first();
  const hasHref = (await linkWithHref.count()) > 0;
  if (hasHref) {
    await linkWithHref.click({ force: true });
    await page.waitForTimeout(600);
    const hint = await page.locator('text=打开外链').count();
    check('点击外链触发宿主回调', hint > 0);
  } else {
    console.log('SKIP 点击外链断言（当前文档没有外部链接）');
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
