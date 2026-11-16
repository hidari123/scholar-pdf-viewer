/**
 * TextLayer —— 文本层组件。
 *
 * 在 canvas 之上叠一层**透明**的 DOM（文字位置与 canvas 像素级对齐）：
 * - 浏览器原生选中/复制 → 不用自己实现选区
 * - 文字透明 → 用户看到的是 canvas 上的真实渲染
 *
 * 关键设计（决定了选区准不准）：
 * - **一个 pdf.js text item 一个 span**：PDF 里一行由多个 item 组成，
 *   每个 item 有自己的 x 位置和字号。合并成一行一个 span 会导致
 *   "选中的框"与"看到的字"错位（用户报的核心 bug）
 * - **显式设 width**：用 PDF 的真实字宽，不用浏览器按系统字体估算
 *   （浏览器算的宽度与 PDF 内嵌字体不同 → 选区框偏移）
 * - **字号用 item.height**：不用 transform[3]（那是渲染矩阵，不是字号）
 * - **white-space: pre**：保留 PDF 里的连续空格（否则被折叠 → 文字挤压）
 */

import { useMemo } from 'react';
import type { TextContentLike, TextViewportLike } from '../core/text-layer/layout';
import { layoutTextItems } from '../core/text-layer/layout';

/** TextLayer 参数 */
export interface TextLayerProps {
  /** 文本内容（pdf.js getTextContent 的结果） */
  content: TextContentLike | null;
  /** 视口 */
  viewport: TextViewportLike | null;
}

/**
 * 文本层。
 *
 * @param props 参数
 */
export function TextLayer({ content, viewport }: TextLayerProps) {
  /** 排版后的文本项（一个 item 一个） */
  const items = useMemo(() => {
    if (!content || !viewport) {
      return [];
    }
    return layoutTextItems(content, viewport);
  }, [content, viewport]);

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
           */
          key={`${item.left}-${item.top}-${item.text.slice(0, 12)}-${index}`}
          className="scpdf-text-layer__item"
          style={{
            left: `${item.left}px`,
            top: `${item.top}px`,
            fontSize: `${item.fontSize}px`,
            // 显式宽度：用 PDF 的真实字宽 → 选区框与文字严格对齐
            width: item.width > 0 ? `${item.width}px` : undefined,
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}
