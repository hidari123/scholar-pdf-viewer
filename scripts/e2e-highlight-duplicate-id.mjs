/**
 * E2E：**重复的高亮 id** 也不能让两个高亮同时"选中"。
 *
 * ## 用户反馈
 *
 * > "有时候会出现有时候点击一个高亮 两个高亮都会被选中的情况"
 * > "很偶发的 具体出现在很久没用过的页面 上面有高亮 我刷新了一下
 * >  然后新建了一个高亮 点击之前的高亮 两个都会被选中"
 *
 * ## 根因（实测复现）
 *
 * ### ① 宿主侧的 id 撞了（demo 的锅）
 *
 * -> `demo/src/App.tsx` 的 `highlightSeq` 在**文档加载完成时归零** ❌
 * -> 但**持久化恢复**的高亮还带着原来的 id（`h-1`、`h-2`…）
 * -> 刷新页面 -> 建一个新高亮 -> 计数器又是 1 -> **又是 `h-1`** ❌
 * -> **两个高亮同 id** ❌
 *
 * ### ② 包按 id 判断激活态（包的锅）
 *
 * -> `AnnotationLayer`: `activeHighlightId === highlight.id` ❌
 * -> 同 id -> **两个都加 `.scpdf-annotation--active`** ❌
 * -> 用户看到"两个高亮都被选中"
 *
 * ## 修法
 *
 * 1. **宿主**：用 `crypto.randomUUID()` -> **绝对不会重复**
 * 2. **包**：激活态改成**按矩形**判断 -> **只激活真正点到的那一个**
 *    -> 命中判定也改成**按几何**找 DOM 元素（不是按 id）
 *
 * 用法：`node scripts/e2e-highlight-duplicate-id.mjs`
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5180';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- 找浏览器 ----
const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
let executablePath;
try {
  for (const dir of readdirSync(cacheRoot)) {
    if (!dir.startsWith('chromium-')) continue;
    const candidate = join(cacheRoot, dir, 'chrome-win64', 'chrome.exe');
    if (existsSync(candidate)) {
      executablePath = candidate;
      break;
    }
  }
} catch {
  // 用 playwright 自带的
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1442, height: 732 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

console.log('E2E：重复的高亮 id 不会让两个高亮同时选中');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1500);

  /** 拖选一段文字 */
  const dragSelect = async (y, len) => {
    const t = await page.evaluate((yy) => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
        (s) => (s.textContent ?? '').trim().length > 20,
      );
      const sp = spans.find((s) => {
        const r = s.getBoundingClientRect();
        return r.width > r.height * 2 && r.top > yy && r.top < yy + 150;
      });
      if (!sp) return null;
      const r = sp.getBoundingClientRect();
      return { x: r.x + 4, y: r.y + r.height / 2 };
    }, y);
    if (!t) return false;
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + len, t.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    return true;
  };

  /** 建一个高亮 */
  const addHighlight = async (y) => {
    await dragSelect(y, 60);
    await page.locator('[aria-label="添加高亮"]').click();
    await page.waitForTimeout(1500);
  };

  // ---- ① 建两个高亮 ----
  await addHighlight(240);
  await addHighlight(420);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-annotation')].map((a) =>
      a.getAttribute('data-highlight-id'),
    ),
  );
  check('**建了两个高亮**', ids.length === 2, ids.join(','));
  check('**两个高亮的 id 不一样**', ids[0] !== ids[1], ids.join(','));

  const positions = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-annotation')].map((a) => {
      const r = a.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)}`;
    }),
  );
  check(
    '**两个高亮在不同的位置**（不然测的不是"两个"）',
    positions[0] !== positions[1],
    positions.join(' | '),
  );

  // ---- ② 强制让它们同 id（模拟宿主传了重复 id）----
  await page.evaluate((id) => {
    for (const a of document.querySelectorAll('.scpdf-annotation')) {
      a.setAttribute('data-highlight-id', id);
    }
  }, ids[0]);
  const forced = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-annotation')].map((a) =>
      a.getAttribute('data-highlight-id'),
    ),
  );
  check('**成功模拟"重复 id"**', forced[0] === forced[1], forced.join(','));

  // ---- ③ 点第一个 -> 只有一个激活 ----
  const target = await page.evaluate(() => {
    const a = document.querySelector('.scpdf-annotation');
    const r = a.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  await page.mouse.click(target.x, target.y);
  // ⚠️ **不要等太久**（激活态 1.5s 后会自动清除）
  await page.waitForTimeout(500);

  const active = await page.evaluate(() => {
    const as = [...document.querySelectorAll('.scpdf-annotation')];
    return {
      total: as.length,
      activeCount: as.filter((a) => a.classList.contains('scpdf-annotation--active')).length,
    };
  });
  check(
    '**点一个高亮只有它自己被选中**（不是两个）',
    active.activeCount === 1,
    `共 ${active.total} 个，激活 ${active.activeCount} 个`,
  );

  // ---- ④ 点第二个 -> 依然只有一个 ----
  const target2 = await page.evaluate(() => {
    const as = [...document.querySelectorAll('.scpdf-annotation')];
    const a = as[1];
    const r = a.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  check(
    '**第二个高亮够大（点得中）**',
    (target2.w ?? 0) >= 8 && (target2.h ?? 0) >= 8,
    `${target2.w}x${target2.h}`,
  );
  await page.mouse.click(target2.x, target2.y);
  await page.waitForTimeout(600);
  const active2 = await page.evaluate(() => {
    const as = [...document.querySelectorAll('.scpdf-annotation')];
    return as.filter((a) => a.classList.contains('scpdf-annotation--active')).length;
  });
  check('**点另一个也只有一个激活**', active2 === 1, `激活 ${active2} 个`);

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
