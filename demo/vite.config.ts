/*
 * @Author: hidari
 * @Date: 2026-10-30 15:36:55
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:37:00
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */

import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** 包根目录（demo 是 workspace 成员 → 父目录就是包本体） */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    /*
     * ⚠️ **固定端口**（默认 Vite 会自动挑端口）。
     *
     * 之前每次起服务端口都不一样（5180 → 5181 → 5200 → 5201 …），
     * 原因：
     * - Vite 默认端口是 **5173**，被占用就自动往后找
     * - 我为了避开占用，每次手动换一个端口
     *
     * → 固定 **5180**（`strictPort: true` → 端口被占用时**直接报错**，
     *   而不是偷偷换一个端口 → 不会再出现"地址对不上"的情况）。
     */
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
    open: false,
  },
  preview: {
    port: 5180,
    strictPort: true,
  },
  resolve: {
    /*
     * ⚠️⚠️ **必须显式 alias 样式入口**。
     *
     * ## 现象
     *
     * demo 消费的是**包的 `dist/`**（workspace 软链）。
     * `import "@scholar-club/pdf-viewer/styles.css"` 走的是 package.json 的
     * **exports 子路径** → Vite 解析不到 → 500：
     *
     * ```
     * Failed to resolve import "@scholar-club/pdf-viewer/styles.css" from "src/App.tsx"
     * ```
     *
     * ## 为什么 `optimizeDeps.exclude` 不管用
     *
     * `exclude` 只影响 **JS 依赖的预打包**，对 **CSS 子路径导出**无效
     * → 解析阶段就失败了，根本走不到预打包那一步。
     *
     * 而且现象很迷惑：`require.resolve()` 在 Node 侧**能**解析
     * （`dist/styles.css` 明明存在）→ 看起来像"文件不见了"。
     *
     * ## 修法
     *
     * 直接 alias 到**文件路径** → Vite 按普通 CSS 文件处理，不走 exports 解析。
     */
    alias: {
      '@scholar-club/pdf-viewer/styles.css': `${packageRoot}dist/styles.css`,
    },
  },
  /*
   * 预打包排除 workspace 包 → `dist/` 重建后不需要重启 demo
   * （dist 被删了重建会让预打包缓存失效）。
   */
  optimizeDeps: {
    exclude: ['@scholar-club/pdf-viewer'],
  },
});
