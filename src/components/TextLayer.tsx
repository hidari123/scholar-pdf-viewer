/**
 * TextLayer —— 文本层组件。
 *
 * 在 canvas 之上叠一层**透明**的 DOM（文字位置与 canvas 像素级对齐）：
 * - 浏览器原生选中/复制 → 不用自己实现选区
 * - 文字透明 → 用户看到的是 canvas 上的真实渲染
 *
 * **关键设计（决定了选区准不准）—— 完全对齐 pdf.js 官方 `TextLayer`**：
 * - **一个 pdf.js text item 一个 span**：PDF 里一行由多个 item 组成，
 *   每个 item 有自己的 x 位置和字号。合并成一行一个 span 会导致
 *   "选中的框"与"看到的字"错位
 * - **scaleX 横向拉伸**：PDF 内嵌字体与浏览器系统字体度量不同，
 *   不拉伸的话文字总宽度对不上 → 越往右偏得越多 → 选区框偏移。
 *   `scaleX = PDF 真实宽度 / 浏览器实测宽度` → 每个字的位置都对得上
 * - **top = 基线 − ascent**：浏览器的行盒是从基线到 ascent 决定的，
 *   用字号会让整行文字偏低 15~20%
 * - **white-space: pre**：保留 PDF 里的连续空格（否则被折叠 → 文字挤压）
 */

import { useMemo } from 'react';
import type { FontInfo, TextContentLike, TextViewportLike } from '../core/text-layer/layout';
import { layoutTextItems } from '../core/text-layer/layout';

/** TextLayer 参数 */
export interface TextLayerProps {
  /** 文本内容（pdf.js getTextContent 的结果） */
  content: TextContentLike | null;
  /** 视口 */
  viewport: TextViewportLike | null;
  /** 字体表（fontName → 字体信息）；宿主可选注入 */
  fontMap?: Record<string, FontInfo>;
  /** 默认字体族（没有 fontMap 时用它） */
  defaultFontFamily?: string;
  /** 页码（选区归页用；span 上带 data-page-number） */
  pageNumber?: number;
}

/**
 * 文本层。
 *
 * @param props 参数
 */
export function TextLayer({
  content,
  viewport,
  fontMap,
  defaultFontFamily,
  pageNumber,
}: TextLayerProps) {
  /** 排版后的文本项（一个 item 一个） */
  const items = useMemo(() => {
    if (!content || !viewport) {
      return [];
    }
    return layoutTextItems(content, viewport, { fontMap, defaultFontFamily });
  }, [content, viewport, fontMap, defaultFontFamily]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-text-layer" aria-hidden="true">
      {items.map((item, index) => (
        <span
          /*
           * key 用"位置 + 文本"而不是数组下标：
           * 下标在重新排版后会指向不同的 item → React 复用错节点 → 文字错位。
           * 位置在一页内唯一且稳定（同一位置不会有两条不同的文字）。
           */
          key={`${item.left}-${item.top}-${item.text.slice(0, 12)}`}
          className="scpdf-text-layer__item"
          // 选区归页用（useTextSelection 靠它判断选中的是哪一页）
          data-page-number={pageNumber}
          /*
           * ⚠️⚠️ **页内项序号**（选区"按文档顺序裁剪"的依据）
           *
           * ## 为什么必须有
           *
           * -> 浏览器的 `Range` 是**文档顺序的连续区间**
           * -> 我们的文本层保持 **PDF 原始顺序**（= 文本流顺序）
           * -> -> 用 `(pageNumber, itemIndex)` 就能精确定位"选了哪一段"
           *
           * ## ⚠️ **不能用 `key` 代替**
           *
           * -> `key` 里带位置和文本 -> **缩放后会变**
           * -> 而 `data-item-index` 必须**稳定**
           * -> 只需保证"**同一时刻自洽**"（rect 和 items 一起重算）
           *
           * ## ⚠️ **index 就是文本流序号**
           *
           * -> `items` 的顺序 = `layoutTextItems` 的产出顺序 = **PDF 文本流顺序**
           * -> 这个顺序**不是**按 y 排的
           *    -> 双栏论文里 = **左栏全部，然后右栏全部**
           * -> -> 这正是跨栏选区需要的
           */
          data-item-index={index}
          style={{
            left: `${item.left}px`,
            top: `${item.top}px`,
            fontSize: `${item.fontSize}px`,
            fontFamily: item.fontFamily,
            /*
             * scaleX：把浏览器排出来的宽度拉伸到 PDF 的宽度。
             * 这是选区精准的关键 —— 不做的话选中的框和看到的字会逐渐错开。
             *
             * ⚠️ **不要设 width**（pdf.js 也不设）：
             * 浏览器会在固定宽度盒子里排字，scaleX 的补偿就会被二次缩放抵消。
             * 宽度完全由 scaleX 控制。
             *
             * ⚠️ **rotate 必须独立判断**（不能只看 scaleX）：
             * 旧写法 `scaleX !== 1 ? 'scaleX(...) rotate(...)' : undefined`
             * → 当 scaleX 恰好等于 1 时，**旋转被整个丢掉** →
             *   竖排文字（如 arXiv 页边戳 `rotate(-90deg)`）被横着渲染 →
             *   它的选区矩形变成 `h=829`（整页高）→ 自绘层画出一大块。
             *
             * ⚠️ **顺序必须是 `rotate() scaleX()`**（对齐 pdf.js v6）：
             * pdf.js: `transform: rotate(var(--rotate)) scaleX(var(--scale-x))`
             * 反过来（先 scaleX 再 rotate）会**先横向拉伸再旋转**，
             * 对旋转文字（角度 ≠ 0）结果完全不同 → 位置错。
             */
            transform:
              item.angle !== 0 || item.scaleX !== 1
                ? `${item.angle !== 0 ? `rotate(${(item.angle * 180) / Math.PI}deg) ` : ''}scaleX(${item.scaleX})`
                : undefined,
            transformOrigin: 'left top',
          }}
        >
          {item.text}
        </span>
      ))}

      {/*
        endOfContent 哨兵（pdf.js 有，我们也要）。

        为什么需要：在 Chrome/Safari 里，用户在**空白处**点击/拖动时，
        选区会一路扩到文本层的末尾（选一大片空白）。
        pdf.js 的做法是监听 `selectionchange`，把这个哨兵元素
        **移动到当前选区边界旁边** → 选区就不会越过它。

        详见 `useTextSelection` 里的 `selectionchange` 处理。

        ⚠️ **必须有 key**：哨兵会被 `useTextSelection` 手动移动到别的位置
        （不再是 React 渲染时的最后一个子节点）。
        没有 key 时 React 重渲染（缩放 → 所有 span 的 key 变了 → 全部重建）
        会按"位置索引"去协调它 → 可能把它塞回错误的位置，
        或者与 `useTextSelection` 的手动移动互相打架。
        固定 key 让 React 认得出"这是同一个哨兵"。
      */}
      <div key="scpdf-end-of-content" className="scpdf-text-layer__end" />
    </div>
  );
}
