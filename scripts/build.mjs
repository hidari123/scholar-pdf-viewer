/*
 * @Author: hidari
 * @Date: 2026-10-30 15:04:09
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:13:01
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import tsupModule from 'tsup';

const { build } = tsupModule;

// 构建 = 单个 Node 脚本，零 shell 拼接：
// 1) tsup 打包（esm/cjs + dts）：build({}) = 无 CLI 参数, 自动从 cwd 加载 tsup.config.ts
// 2) 合并 CSS 到 dist/styles.css
// tsup 9 编程接口是 build(options)（v9 由 tsup() 改名且 options 必传）；tsup 是 CJS 模块，用 default import + 解构
await build({});

mkdirSync('dist', { recursive: true });

/**
 * 合并两个 CSS 文件 → `dist/styles.css`。
 *
 * ⚠️ 为什么是**两个**文件：
 * - `viewer.css` —— 组件样式（**必须**有）
 * - `themes.css` —— 主题（7 套 + appearance）
 *
 * → 合并成一个导出（宿主只要 import 一个）。
 * → 同时保留单独的 `dist/themes.css`（想只要组件样式的宿主可以单独引）。
 */
const viewerCss = readFileSync('src/styles/viewer.css', 'utf8');
const themesCss = readFileSync('src/styles/themes.css', 'utf8');

writeFileSync('dist/styles.css', `${viewerCss}\n\n${themesCss}`, 'utf8');
cpSync('src/styles/themes.css', 'dist/themes.css');

/**
 * 拷 pdf.js 的**标准字体**目录到产物里。
 *
 * ⚠️ 为什么必须有（用户反馈："页面刚打开顶部出现乱码"）：
 * → pdf.js 给文档里的每种字体建 `g_d0_fN` 的 `@font-face`。
 * → PDF 里**内嵌了**的字体它能直接拿到字节；
 *   **没内嵌的**要去 `standardFontDataUrl` 指的目录下载 `.pfb`。
 * → 不给这个目录 → 请求不到任何 `.pfb` → 那些字体 fallback 到系统字体
 *   → 字宽度不对 → canvas 上按字宽度排的文��**位置全错** → 乱码。
 * → pdf.js 是渐进渲染 → 字体到位前画的那几页歪，到位后画的正常
 *   → 所以表现是"首次打开乱码、刷新就没"。
 *
 * ⚠️ 为什么只拷标准字体、**不拷** cmaps / wasm：
 * → `standard_fonts/` 0.76 MB → 是乱码的**直接原因** → 必须内置。
 * → `cmaps/` 1.11 MB → 只影响中日韩竖排 PDF → 体积大 → 宿主按需传。
 * → `wasm/` 1.47 MB → 只影响 JBIG2 / JPEG2000 图片 → 体积大 → 宿主按需传。
 * → 宿主要改的话传 `pdfJsResourcePaths` 覆盖（浅覆盖）。
 */
const standardFontsSrc = 'node_modules/pdfjs-dist/standard_fonts';
if (existsSync(standardFontsSrc)) {
  cpSync(standardFontsSrc, 'dist/standard_fonts', { recursive: true });
} else {
  /*
   * ⚠️ **找不到就算了** ❌ 不能让构建挂掉 ✅
   * → `pdfjs-dist` 是 peerDependency ✅ -> 宿主可能没装 ✅
   * -> -> 包自己找不到资源 ✅ -> 宿主传 `pdfJsResourcePaths` ✅
   */
  console.warn('[build] 警告: 找不到 pdfjs-dist/standard_fonts，产物里没有标准字体');
}

console.log('[build] ok: dist/ (js + dts + styles.css + themes.css + standard_fonts)');
