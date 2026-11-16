/**
 * SelectionLayer —— 自绘选区（SVG clipPath）。
 *
 * **为什么不用原生 `::selection`**：
 * 浏览器会**逐个 client rect** 画选区背景。同一行里不同字号的 span
 * （正文 + 上标）各自形成行盒 → 返回多个**垂直重叠**的矩形 →
 * 重叠区被**叠涂两次** → 半透明色叠两次 → **阶梯状深浅不一**。
 *
 * 自绘（pdf.js v6 的 `selectionRendering` 模式）：
 * 1. 关掉原生 `::selection` 的背景（`background: transparent`）
 * 2. 用 `getClientRects()` 拿到选区形状 → 合并同行重叠矩形
 * 3. 画成 SVG `<clipPath>` → 覆盖层**每个像素只画一次**
 *
 * ⚠️ **必须关掉原生背景**，否则两层叠加 → 又变深。
 */

import { useMemo } from 'react';
import type { PageSelectionShape } from '../core/selection/shape';
import { mergeOverlappingRects } from '../core/selection/shape';

/** SelectionLayer 参数 */
export interface SelectionLayerProps {
  /** 页码（用于生成唯一的 clipPath id） */
  pageNumber: number;
  /** 该页的选区形状（页内坐标） */
  shape: PageSelectionShape | undefined;
}

/**
 * 选区覆盖层。
 *
 * @param props 参数
 */
export function SelectionLayer({ pageNumber, shape }: SelectionLayerProps) {
  /** 合并同行重叠矩形 → 每个像素只画一次 */
  const rects = useMemo(() => {
    if (!shape) {
      return [];
    }
    return mergeOverlappingRects(shape.rects);
  }, [shape]);

  if (rects.length === 0) {
    return null;
  }

  /*
   * clipPath 的 id 必须**全局唯一**：
   * 同一页可能同时存在多个 SelectionLayer（理论上不会，但要防），
   * 而且 id 冲突会导致 SVG 引用到别的页的形状。
   */
  const clipId = `scpdf-selection-clip-${pageNumber}`;

  return (
    <svg
      className="scpdf-selection-layer"
      aria-hidden="true"
      focusable="false"
      /*
       * ⚠️ **绝对不能用 viewBox**：
       * `viewBox="0 0 100 100"` + `preserveAspectRatio="none"` 会把
       * **用户坐标系**从 100×100 拉伸到页面的真实像素尺寸。
       * 而 clipPath 用 `userSpaceOnUse`（用户坐标 = 上面拉伸后的坐标）
       * → clip rect 的 x=449（真实 px）会被放大成 449 × (1408/100) = 6324
       * → 形状跑到页面外 → **选区完全看不见**。
       *
       * ✅ 正确做法：**不设 viewBox** → SVG 用户坐标 = CSS 像素
       * → clipPath 的坐标就是真实 px，直接可用。
       */
      width="100%"
      height="100%"
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          {rects.map((rect) => (
            <rect
              /*
               * key 用几何而不是数组下标：
               * 矩形的位置唯一 → 位置变了就是新的矩形 → React 会正确重建。
               * 用下标的话，合并后数量变化会导致 key 复用 → 形状错乱。
               */
              key={`${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
            />
          ))}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/*
         * 覆盖整个页面的矩形，用 clipPath 挖出选区形状。
         *
         * 用百分比（100%）→ 自动铺满（不依赖 viewBox 换算）。
         */}
        <rect className="scpdf-selection-layer__fill" x="0" y="0" width="100%" height="100%" />
      </g>
    </svg>
  );
}
