/*
 * @Author: hidari
 * @Date: 2026-10-30 15:36:55
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 15:37:00
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
});
