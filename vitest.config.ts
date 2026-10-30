/*
 * @Author: hidari
 * @Date: 2026-10-30 14:20:55
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 14:20:59
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // core 纯逻辑在 node 环境跑（SSR 安全底线）；阶段 2+ 组件测试用 jsdom 的独立文件
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
  },
});
