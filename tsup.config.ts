/*
 * @Author: hidari
 * @Date: 2026-10-29 16:50:09
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 14:38:18
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', core: 'src/core.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // 边界线：这些是"我的依赖"，不进产物，由消费方的包管理器解析
  external: ['pdfjs-dist', 'idb'],
});
