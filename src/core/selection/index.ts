/**
 * selection 层 —— 选区几何提取（把 DOM Range 变成中立几何）
 */
export * from './actions';
export * from './drag-origin';
export * from './extract';
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
