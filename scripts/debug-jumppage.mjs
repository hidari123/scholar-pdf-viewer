/** 调试：跳页链路（页顶边 / 滚动位置 / 缩放 三者的一致性） */

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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5181';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
await page.waitForTimeout(2500);

/** 采样当前状态 */
async function sample(label) {
  const s = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    const pages = [...document.querySelectorAll('.scpdf-page')];
    const target = pages[16];
    return {
      scrollTop: Math.round(c?.scrollTop ?? 0),
      scrollHeight: Math.round(c?.scrollHeight ?? 0),
      pager: document.querySelector('.scpdf-toolbar__page-input')?.value,
      scale: document.querySelector('.scpdf-toolbar__scale')?.textContent?.trim(),
      pageCount: pages.length,
      page17Top: target
        ? Math.round(target.getBoundingClientRect().top - c.getBoundingClientRect().top)
        : null,
      page17H: target ? Math.round(target.getBoundingClientRect().height) : null,
      // 各页元素相对容器的 top（看间距规律）
      elementTops: pages
        .slice(0, 6)
        .map((p) =>
          Math.round(
            p.getBoundingClientRect().top - c.getBoundingClientRect().top + (c?.scrollTop ?? 0),
          ),
        ),
    };
  });
  console.log(label, JSON.stringify(s));
  return s;
}

await sample('BEFORE');

await page.locator('.scpdf-toolbar__page-input').fill('17');
await page.waitForTimeout(1500);
await sample('AFTER-JUMP-17');

// 再测：先缩到最小，再跳页
await page.getByLabel('缩小').click();
await page.waitForTimeout(200);
await sample('AFTER-ZOOMOUT');

await page.locator('.scpdf-toolbar__page-input').fill('17');
await page.waitForTimeout(1500);
await sample('AFTER-ZOOMOUT-JUMP-17');

await browser.close();
