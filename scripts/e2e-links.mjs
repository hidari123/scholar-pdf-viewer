/**
 * E2E: link layer + password dialog.
 *
 * Uses the real PDF (it contains many links: citations, URLs, TOC entries).
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
  await page.waitForTimeout(3000);

  // ---------- link layer ----------
  const linkCount = await page.locator('.scpdf-link').count();
  check('链接层已渲染链接区域', linkCount > 0, `${linkCount} 个`);

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
  check(
    '链接在页面范围内',
    geometry !== null &&
      geometry.offsetX >= -2 &&
      geometry.offsetX < geometry.pageWidth &&
      geometry.height > 0,
    geometry ? `偏移 ${geometry.offsetX},${geometry.offsetY} 尺寸 ${geometry.width}×${geometry.height}` : '无',
  );

  // unsafe URLs must be filtered out
  const unsafe = await page.evaluate(() =>
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
    check('点击外链触发宿主回调', false, '页面内无带 href 的链接');
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
