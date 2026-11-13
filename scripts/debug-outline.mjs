/** 调试：outline dest[0] 的结构（页引用长什么样） */

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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5182';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
await page.waitForTimeout(2000);

await page.locator('.scpdf-toolbar__btn[aria-label="目录"]').click();
await page.waitForTimeout(3000);

const items = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.scpdf-outline__item')];
  return list.slice(0, 5).map((el) => ({
    title: el.textContent,
    disabled: el.hasAttribute('disabled'),
  }));
});
console.log('ITEMS', JSON.stringify(items, null, 2));

await browser.close();
