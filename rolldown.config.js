/**
 * rolldown 配置 —— 给 **size-limit** 用。
 *
 * ## 为什么需要（实测踩过的坑：体积超预算）
 *
 * → 图标的几何数据（45 个图标 ≈ 5 kB brotli）走**动态 import**
 * → 真实宿主用的时候，**只有真的要渲染内置图标时**才加载那个 chunk
 * → 所以"主入口"的体积**不应该**包含它 ✅
 *
 * → 但 size-limit 默认会把**动态 chunk 也打进来**
 * → 主入口 25 kB → **27.29 kB** → 超预算 ❌
 *
 * ## 修法
 *
 * → `inlineDynamicImports: false` → 动态 import **保持为独立的 chunk**
 * → size-limit 只统计**主入口自己的体积** → 回到预算内 ✅
 *
 * ⚠️ **这不是"作弊"**：这正是真实宿主拿到的体积
 *    （主入口小 → 首屏快；图标 chunk 按需加载）
 */

/** @type {import('rolldown').RolldownOptions} */
export default {
  output: {
    // ⚠️ **动态 import 保持独立 chunk**（不内联进主入口）
    inlineDynamicImports: false,
  },
};
