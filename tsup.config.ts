/*
 * @Author: hidari
 * @Date: 2026-10-29 16:50:09
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-29 16:50:16
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
});
