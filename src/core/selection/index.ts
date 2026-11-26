/**
 * selection 层 —— 选区几何提取（把 DOM Range 变成中立几何）
 */
export * from './actions';
export * from './dialog-position';
/**
 * ⚠️ **新增** ✅（选区重构 ✅）
 * -> `dom-order` ✅：按【文档顺序】裁剪 ✅（解决反向选择 ✅）
 * -> `filter-outliers` ✅：剔除整页矩形 / 旋转文字 / 页边戳 ✅
 */
export * from './dom-order';
export * from './extract';
export * from './filter-outliers';
export * from './highlight-actions';
/**
 * ⚠️ **之前没导出**（审计发现的）：
 * -> \`item-geometry\` 的三个函数（\`itemBoxOf\` / \`glyphExtentOf\` / \`clipRectToGlyph\`）
 *    **宿主根本用不到** ❌
 * -> 现在**导出** -> 宿主要自己算选区框时能用 ✅
 */
export * from './item-geometry';
export * from './optimize-rects';
export * from './popover-position';
export * from './shape';
