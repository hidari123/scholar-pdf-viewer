/**
 * E2E 冒烟：真实浏览器里验证包的核心行为。
 *
 * 为什么需要 E2E：jsdom 没有 canvas 渲染能力，
 * "PDF 真的画出来了吗 / 缩放后还在原位吗 / 选区能取到吗" 这些**只能靠真浏览器**。
 *
 * 跑法（需先起 demo）：
 *   pnpm --filter @scholar-club/pdf-viewer-demo dev --port 5180
 *   node scripts/e2e-smoke.mjs
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5180';
const SHOT_DIR = 'e2e-shots';

/**
 * 找 Chromium 可执行文件。
 *
 * 为什么自己找：本机已装的浏览器版本（chromium-1234）可能与当前 Playwright
 * 期望的版本（1254）不一致 → 直接 launch 会报 "Executable doesn't exist"。
 * 复用已装的浏览器比重新下载快得多，也不污染环境。
 */
function resolveChromium() {
  // 1) 环境变量优先
  if (process.env.E2E_CHROMIUM_PATH && existsSync(process.env.E2E_CHROMIUM_PATH)) {
    return process.env.E2E_CHROMIUM_PATH;
  }

  // 2) 本机 ms-playwright 缓存里找已装的 chromium（取版本号最大的）
  const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (existsSync(cacheRoot)) {
    const dirs = readdirSync(cacheRoot)
      .filter((name) => name.startsWith('chromium-'))
      .map((name) => ({
        name,
        version: Number.parseInt(name.replace('chromium-', ''), 10) || 0,
      }))
      .sort((a, b) => b.version - a.version);

    for (const dir of dirs) {
      const exe = join(cacheRoot, dir.name, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) {
        return exe;
      }
      const shell = join(
        cacheRoot,
        dir.name,
        'chrome-headless-shell-win64',
        'chrome-headless-shell.exe',
      );
      if (existsSync(shell)) {
        return shell;
      }
    }
  }

  return undefined;
}

/** 断言收集 */
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const executablePath = resolveChromium();
console.log(`Chromium: ${executablePath ?? '（使用 Playwright 默认）'}`);

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/** 收集页面错误 */
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() !== 'error') {
    return;
  }
  // favicon 404 是浏览器自动请求的，与包无关
  if (message.text().includes('favicon')) {
    return;
  }
  pageErrors.push(message.text());
});
page.on('requestfailed', (request) => {
  if (request.url().includes('favicon')) {
    return;
  }
  pageErrors.push(`请求失败：${request.url()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().includes('favicon')) {
    pageErrors.push(`HTTP ${response.status()}：${response.url()}`);
  }
});

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // 1) 查看器挂载
  check('查看器已挂载', (await page.locator('[data-testid="pdf-viewer"]').count()) === 1);
  check('工具栏已渲染', (await page.locator('.scpdf-toolbar').count()) === 1);

  // 2) 生成样张 PDF
  await page.getByRole('button', { name: '生成样张 PDF' }).click();
  await page.waitForTimeout(1500);

  // 3) 页面已渲染（canvas 存在且有尺寸）
  const canvasCount = await page.locator('.scpdf-page canvas.scpdf-canvas').count();
  check('至少渲染了 1 页 canvas', canvasCount >= 1, `${canvasCount} 个`);

  if (canvasCount > 0) {
    const box = await page.locator('.scpdf-page canvas.scpdf-canvas').first().boundingBox();
    check(
      'canvas 有实际尺寸',
      Boolean(box && box.width > 10 && box.height > 10),
      box ? `${Math.round(box.width)}×${Math.round(box.height)}` : '无 box',
    );
  }

  // 3.5) 初始缩放 = 适配宽度（页宽应接近容器宽度）
  const containerWidth = await page
    .locator('.scpdf-container')
    .evaluate((element) => element.clientWidth);
  const firstPageWidth = await page
    .locator('.scpdf-page canvas.scpdf-canvas')
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
  check(
    '初始缩放适配宽度（页宽接近容器宽）',
    Math.abs(firstPageWidth - (containerWidth - 32)) < 40,
    `页宽 ${Math.round(firstPageWidth)} / 容器 ${containerWidth}`,
  );

  // 存档初始状态截图（适配宽度时的样子）
  await page.screenshot({ path: `${SHOT_DIR}/viewer-fit-width.png` });

  // 4) 页码显示
  const pagerValue = await page.locator('.scpdf-toolbar__page-input').inputValue();
  check('页码输入框显示第 1 页', pagerValue === '1', `值 = ${pagerValue}`);

  // 5) 总页数 = 3
  const totalText = await page.locator('.scpdf-toolbar__page-total').textContent();
  check('总页数为 3', totalText?.trim() === '/ 3', `文本 = ${totalText?.trim()}`);

  // 6) 缩放
  const scaleBefore = await page.locator('.scpdf-toolbar__scale').textContent();
  await page.getByLabel('放大').click();
  await page.waitForTimeout(400);
  const scaleAfter = await page.locator('.scpdf-toolbar__scale').textContent();
  check(
    '点击放大后缩放比例变化',
    scaleBefore !== scaleAfter,
    `${scaleBefore?.trim()} → ${scaleAfter?.trim()}`,
  );

  // 7) 缩放后 canvas 尺寸同步变大（渲染跟着缩放）
  const canvasBox = await page.locator('.scpdf-page canvas.scpdf-canvas').first().boundingBox();
  check(
    '缩放后 canvas 尺寸变化',
    Boolean(canvasBox && canvasBox.width > 100),
    canvasBox ? `宽 ${Math.round(canvasBox.width)}` : '无 box',
  );

  // 8) 缩小到底 → 按钮禁用（到下限就停，禁用后再点会超时）
  const zoomOut = page.getByLabel('缩小');
  for (let i = 0; i < 30; i += 1) {
    if (await zoomOut.isDisabled()) {
      break;
    }
    await zoomOut.click();
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(300);
  const disabled = await zoomOut.isDisabled();
  check('缩到下限后缩小按钮禁用', disabled);

  // 9) 跳页
  await page.locator('.scpdf-toolbar__page-input').fill('3');
  await page.waitForTimeout(800);
  const pagerAfter = await page.locator('.scpdf-toolbar__page-input').inputValue();
  check('跳到第 3 页', pagerAfter === '3', `值 = ${pagerAfter}`);

  // 10) 无页面错误
  check('运行期无 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  // 截图存档
  await page.screenshot({ path: `${SHOT_DIR}/viewer.png`, fullPage: false });
  console.log(`\n截图已保存：${SHOT_DIR}/viewer.png`);
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  process.exitCode = 1;
}
