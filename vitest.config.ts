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
  },
});
