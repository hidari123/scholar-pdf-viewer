/*
 * @Author: hidari
 * @Date: 2026-10-29 16:50:09
 * @LastEditors: hidari
 * @LastEditTime: 2026-11-13 15:19:36
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core/index.ts',
    /*
     * **图标集单独一个入口**。
     *
     * ⚠️ 为什么（实测踩过的坑：体积超预算）：
     * → 45 个图标的几何数据约 **5 kB**（brotli 后）
     * → 全塞进主入口 → 主入口 **27 kB** → 超了 25 kB 的预算 ❌
     * → 拆成独立入口 → 宿主**不覆盖图标**时完全不用加载 ✅
     * → 覆盖图标时再 `import { getIconShape } from '@scholar-space/pdf-viewer/icons'`
     */
    icons: 'src/core/icons/entry.ts',
    /**
     * **批注弹窗**（独立入口）。
     *
     * ⚠️ 为什么独立（实测踩过的坑：体积超预算）：
     * → 弹窗 + 富文本编辑器约 1.4 kB（brotli 后）
     * → 静态 export → 每个宿主都要背 ❌
     * → 独立入口 → **要用才装** ✅
     */
    dialog: 'src/components/AnnotationDialog.tsx',
    /**
     * **TipTap 富文本编辑器**（独立入口）。
     *
     * ⚠️ 为什么独立（实测踩过的坑：体积超预算）：
     * → TipTap（starter-kit + highlight/color/link/underline）**106 kB brotli**
     * → 打进主入口 → 首屏加载明显变慢 ❌
     * → 独立入口 + **可选 peerDependency** → 宿主按需装 ✅
     */
    editor: 'src/components/TipTapEditor.tsx',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  /*
   * ⚠️ **代码分割**（实测踩过的坑：体积超预算）。
   *
   * → 没有 splitting 时，`lazy(() => import(...))` 会被**打进同一个 chunk**
   *   → 便利贴面板 + 富文本编辑器（约 1.5 kB brotli）**每个宿主都要背** ❌
   * → 开了 splitting → 动态 import 变成**独立 chunk** → 不打开批注就不加载 ✅
   */
  splitting: true,
  // 边界线：这些是"我的依赖"，不进产物，由消费方的包管理器解析
  // ⚠️ `pdf-lib` 是**可选依赖**（动态 import）→ 也不能进产物
  external: [
    'pdfjs-dist',
    'idb',
    'pdf-lib',
    // ⚠️ TipTap 是**可选 peerDependency** → 不能进产物（宿主自己装）
    '@tiptap/core',
    '@tiptap/react',
    '@tiptap/starter-kit',
    '@tiptap/extension-highlight',
    '@tiptap/extension-color',
    '@tiptap/extension-link',
    '@tiptap/extension-underline',
    '@tiptap/extension-placeholder',
  ],
});
