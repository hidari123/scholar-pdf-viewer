/*
 * @Author: hidari
 * @Date: 2026-10-30 15:04:09
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:13:01
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

console.log('[build] ok: dist/ (js + dts + styles.css + themes.css)');
