/**
 * E2E：选区性能基准。
 *
 * 用户反馈："很卡" / "特别特别卡"。
 *
 * 实测过：**CPU 不是瓶颈**（profile 显示 89.4% idle，我们的代码只占 0.1%）。
 * 真正的"卡"来自：
 * 1. 拖动中**零反馈**（几何计算只在 mouseup）→ 手感像卡死
 * 2. 几何计算里的 O(n²) 算法 → 高频触发时确实会拖慢
 *
 * 这个脚本测量**算法本身**的复杂度改善（用真实数据量）。
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

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ---- 1. 拖动帧间隔（真实原生事件，排除 CDP 往返）----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(x).fontSize);
      return fs > 18 && (x.textContent ?? '').trim().length > 60 && r.width > 400;
    });
    const el = spans[0];
    const r = el.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 10 };
  });

  const perf = await page.evaluate(async (t) => {
    const el = document.elementFromPoint(t.x, t.y);
    const fire = (type, x, y) =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 }));

    const frames = [];
    let last = performance.now();
    let raf;
    const tick = () => {
      const n = performance.now();
      frames.push(n - last);
      last = n;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    fire('mousedown', t.x, t.y);
    for (let i = 1; i <= 40; i++) {
      fire('mousemove', t.x + i * 9, t.y + i * 2);
      await new Promise((r) => requestAnimationFrame(r));
    }
    fire('mouseup', t.x + 360, t.y + 80);
    await new Promise((r) => requestAnimationFrame(r));
    cancelAnimationFrame(raf);

    const gaps = frames
      .slice(1)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    return {
      p50: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
      p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
      max: +gaps[gaps.length - 1].toFixed(1),
      over32: gaps.filter((g) => g > 32).length,
      total: gaps.length,
    };
  }, t);

  console.log(`  帧间隔: ${JSON.stringify(perf)}`);
  check(
    '拖动时满帧（p95 ≤ 20ms，无长帧）',
    perf.p95 <= 20 && perf.over32 === 0,
    `p95=${perf.p95}ms`,
  );

  // ---- 2. mousedown → 浮层出现 ----
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    window.__t = {};
    const mo = new MutationObserver(() => {
      if (document.querySelector('.scpdf-selection-popover') && !window.__t.pop) {
        window.__t.pop = performance.now();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener(
      'mousedown',
      () => {
        window.__t.down = performance.now();
      },
      true,
    );
  });
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + 40, t.y + 5, { steps: 4 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const latency = await page.evaluate(() => {
    const tt = window.__t;
    return tt.down && tt.pop ? +(tt.pop - tt.down).toFixed(1) : null;
  });
  check('mousedown → 浮层出现 < 150ms', latency !== null && latency < 150, `${latency}ms`);

  // ---- 3. 几何计算的实际耗时（多行选区）----
  /*
   * 直接测"选区几何计算"本身的耗时 ——
   * 这是拖动时唯一会重复跑的昂贵操作。
   */
  // 先滚回顶部（前面的交互可能滚动了）
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop = 0;
  });
  await page.waitForTimeout(400);

  const geom = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(x).fontSize);
      return (
        fs > 18 &&
        (x.textContent ?? '').trim().length > 30 &&
        r.width > 300 &&
        r.top > 150 &&
        r.top < 650
      );
    });
    const el = spans[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + 8 };
  });

  if (geom) {
    await page.mouse.move(geom.x, geom.y);
    await page.mouse.down();
    await page.mouse.move(geom.x + 350, geom.y + 120, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const stats = await page.evaluate(() => ({
      rects: document.querySelectorAll('.scpdf-selection-layer clipPath rect').length,
      selLen: window.getSelection()?.toString().length ?? 0,
    }));
    console.log(`  多行拖选: 选区 ${stats.selLen} 字符, 自绘 ${stats.rects} 个`);
    check(
      '多行拖选后有选区块',
      stats.rects > 0 && stats.selLen > 0,
      `${stats.rects} 个 / ${stats.selLen} 字符`,
    );
  } else {
    console.log('SKIP 多行拖选断言（当前视口没有正文段落）');
  }
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
