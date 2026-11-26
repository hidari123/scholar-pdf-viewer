/**
 * icons —— 图标集**独立入口**（`@scholar-space/pdf-viewer/icons`）。
 *
 * ## 为什么单独一个入口（实测踩过的坑：体积超预算）
 *
 * → 45 个图标的几何数据约 **5 kB**（brotli 后）
 * → 全塞进主入口 → 主入口 **27 kB** → 超了 **25 kB** 的预算 ❌
 * → 拆成独立入口 → 主入口只保留**渲染逻辑**，几何数据**按需加载** ✅
 *
 * ## 宿主怎么用
 *
 * ```ts
 * // ① 只是想用内置图标（默认）→ 什么都不用做
 * <PdfViewer />
 *
 * // ② 想覆盖部分图标 → 传 ReactNode（不碰几何数据）
 * <PdfViewer icons={{ upload: <Upload /> }} />
 *
 * // ③ 想自己画图标 → 从这个入口拿几何数据
 * import { getIconShape } from '@scholar-space/pdf-viewer/icons';
 * ```
 *
 * ⚠️ **默认用法（①）不会打包几何数据** → 主入口保持轻量 ✅
 */

export * from './icons';
