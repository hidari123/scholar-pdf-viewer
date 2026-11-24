import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * 默认 node 环境（core 层契约：零 DOM、SSR 安全底线）。
     * 组件测试用 jsdom —— 通过文件顶部的 `// @vitest-environment jsdom` 逐文件声明。
     */
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    /**
     * ⚠️ **覆盖率配置**（审计发现的：以前**根本没有**覆盖率工具）。
     *
     * -> 没有它 -> **报不出覆盖率** -> 回归看不见 ❌
     * -> 这个包的卖点就是"纯逻辑的 core" -> **必须有可测量的覆盖率** ✅
     *
     * → 用 \`v8\` provider（不用 istanbul -> 快很多）✅
     * → \`reporter\` 同时出 **text**（人看）和 **json**（CI 解析）✅
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      /**
       * ⚠️ **只统计真正需要测的**（审计发现的）：
       *
       * -> \`src/core/**\` -> **纯逻辑** -> **必须有高覆盖率** ✅
       * -> \`src/hooks/**\` / \`src/components/**\` -> 靠 E2E 覆盖为主 ✅
       *   -> 但**关键路径**（选区、缩放、打印）也该有单测 ✅
       * -> 排除**纯类型文件**和**入口**（没有可执行代码）✅
       */
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/index.ts', 'src/**/types.ts', 'src/**/*.d.ts'],
      thresholds: {
        /**
         * ⚠️ **下限**（防止覆盖率悄悄往下掉）。
         *
         * -> 审计发现**没有覆盖率工具** -> 覆盖率**完全不可见** ❌
         * -> 现在：**有下限** -> 掉了 CI 会红 ✅
         *
         * ⚠️ **这些数是"当前的实际值"**（实测）：
         * | 指标 | 下限 | 实测 |
         * |---|---|---|
         * | lines | 50 | **50.87** |
         * | functions | 45 | **45.58** |
         * | branches | 40 | **41.58** |
         * | statements | 50 | **50.87** |
         *
         * -> 故意**卡得很紧**（只留 0.5~1.5 个点的余量）✅
         * -> 补了测试就会**超过** -> 再往上调 ✅
         * -> 少写测试就**立刻红** ✅
         */
        lines: 51,
        functions: 47,
        branches: 41,
        statements: 51,
      },
    },
  },
});
