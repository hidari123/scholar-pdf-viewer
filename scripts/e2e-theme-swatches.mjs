/**
 * E2E：**主题下拉的色块要能区分开**。
 *
 * ## 用户反馈
 *
 * > "主题的下拉框里高对比色和暗色的展示的前面框的颜色是一样的
 * >  极简和亮色也是一样的 需要区分开"
 *
 * ## 真因（实测）
 *
 * -> 之前色块只画**一个纯背景色** ❌
 * -> 但这些主题的差别**本来就不在背景色上**（背景差 1~2%）✅
 *    - `light` #ffffff vs `minimal` #fafafa ❌ 肉眼分不出
 *    - `dark` #1f2933 vs `contrast` #000000 ❌ 太像
 *    - `paper` #f5f0e6 vs `sepia` #f4ecd8 ❌ 几乎一样
 *
 * ## 修法
 *
 * -> 画成**迷你预览卡**（上半 = 主色调，下半 = 背景色）✅
 * -> 颜色靠**CSS 变量**（不在 TS 里再抄一份）✅
 *
 * 用法：`node scripts/e2e-theme-swatches.mjs`
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

console.log('E2E：主题下拉的色块能区分开');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2000);

  // 打开主题下拉（⚠️ 用 role 定位，demo 的 header 里也有个"主题"的 select）
  await page.getByRole('button', { name: '主题' }).click();
  await page.waitForTimeout(900);

  const swatches = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-theme-picker__swatch')].map((s) => {
      const bar = s.querySelector('.scpdf-theme-picker__swatch-bar');
      const bg = s.querySelector('.scpdf-theme-picker__swatch-bg');
      const cs = getComputedStyle(s);
      return {
        label: s
          .closest('.scpdf-theme-picker__item')
          ?.querySelector('.scpdf-theme-picker__label')
          ?.textContent?.trim(),
        bar: bar ? getComputedStyle(bar).backgroundColor : null,
        barGrad: bar ? getComputedStyle(bar).backgroundImage.includes('gradient') : false,
        bg: bg ? getComputedStyle(bg).backgroundColor : null,
        bgGrad: bg ? getComputedStyle(bg).backgroundImage.includes('gradient') : false,
        radius: cs.borderRadius,
      };
    }),
  );
  console.log('   色块:', JSON.stringify(swatches));

  check('**有 7 个主题色块**', swatches.length === 7, `${swatches.length} 个`);

  // ① 每个色块都有"主色调条"和"背景"
  check(
    '**每个色块都有主色调条 + 背景**',
    swatches.every((s) => s.bar && s.bg),
  );

  // ② **主色调两两不同**
  //
  // ⚠️ **背景色允许重复**（这是**故意的**）✅
  // -> `light` 和 `minimal` 的背景**都是白色** ✅
  // -> 靠**主色调条**（蓝 vs 灰）区分 ✅
  // -> 所以"背景必须两两不同"是**错的断言** ❌
  const barList = swatches.map((s) => s.bar);
  const uniqueBar = new Set(barList);
  check(
    '**主色调两两不同**',
    uniqueBar.size === barList.length,
    `${uniqueBar.size}/${barList.length} 种不同`,
  );

  // ④ **整张卡（条+底）两两不同**
  const combo = swatches.map(
    (s) => `${s.bar}|${s.bg}|${s.barGrad ? 'g' : ''}${s.bgGrad ? 'g' : ''}`,
  );
  const uniqueCombo = new Set(combo);
  check(
    '**整张预览卡两两不同**（真正决定"看起来一不一样"）',
    uniqueCombo.size === combo.length,
    `${uniqueCombo.size}/${combo.length} 种不同`,
  );

  // ⑤ 用户点名的三组
  const byLabel = (label) => swatches.find((s) => s.label === label);
  const light = byLabel('亮色');
  const minimal = byLabel('极简');
  const dark = byLabel('暗色');
  const contrast = byLabel('高对比度');

  check(
    '**亮色 vs 极简：能区分**',
    !!light && !!minimal && `${light.bar}|${light.bg}` !== `${minimal.bar}|${minimal.bg}`,
    light && minimal ? `亮=${light.bar}/${light.bg} 极简=${minimal.bar}/${minimal.bg}` : '找不到',
  );
  check(
    '**暗色 vs 高对比度：能区分**',
    !!dark && !!contrast && `${dark.bar}|${dark.bg}` !== `${contrast.bar}|${contrast.bg}`,
    dark && contrast ? `暗=${dark.bar}/${dark.bg} 对比=${contrast.bar}/${contrast.bg}` : '找不到',
  );

  // ⑥ "跟随系统"要画成渐变（一亮一暗）
  const auto = byLabel('跟随系统');
  check(
    '**跟随系统是渐变**（一半亮一半暗）',
    !!auto && (auto.barGrad || auto.bgGrad),
    auto ? `barGrad=${auto.barGrad} bgGrad=${auto.bgGrad}` : '找不到',
  );

  // ⑦ 圆角要体现结构差异
  check(
    '**高对比度 / 极简的圆角是 0**（结构差异也体现出来）',
    contrast?.radius === '0px' && minimal?.radius === '0px',
    `对比=${contrast?.radius} 极简=${minimal?.radius}`,
  );

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
