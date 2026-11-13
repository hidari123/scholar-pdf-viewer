/** 调试：初始 fit-width 是否生效 */
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

const browser = await chromium.launch(
  resolveChromium() ? { executablePath: resolveChromium() } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '生成样张 PDF' }).click();
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const container = document.querySelector('.scpdf-container');
  const page1 = document.querySelector('.scpdf-page');
  const canvas = document.querySelector('.scpdf-page canvas');
  return {
    containerWidth: container?.clientWidth,
    containerScrollHeight: container?.scrollHeight,
    pageWidth: page1?.getBoundingClientRect().width,
    pageHeight: page1?.getBoundingClientRect().height,
    canvasWidth: canvas?.getBoundingClientRect().width,
    scaleText: document.querySelector('.scpdf-toolbar__scale')?.textContent,
  };
});
console.log('INFO', JSON.stringify(info, null, 2));

await browser.close();
