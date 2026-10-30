/*
 * @Author: hidari
 * @Date: 2026-10-30 15:04:09
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:13:01
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { cpSync, mkdirSync } from 'node:fs';
import tsupModule from 'tsup';

const { build } = tsupModule;

// 构建 = 单个 Node 脚本，零 shell 拼接：
// 1) tsup 打包（esm/cjs + dts）：build({}) = 无 CLI 参数, 自动从 cwd 加载 tsup.config.ts
// 2) copy styles.css 到 dist
// tsup 9 编程接口是 build(options)（v9 由 tsup() 改名且 options 必传）；tsup 是 CJS 模块，用 default import + 解构
await build({});

mkdirSync('dist', { recursive: true });
cpSync('src/styles/viewer.css', 'dist/styles.css');
console.log('[build] ok: dist/ (js + dts + styles.css)');
