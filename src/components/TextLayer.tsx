/**
 * TextLayer —— 文本层组件。
 *
 * 在 canvas 之上叠一层**透明**的 DOM（文字位置与 canvas 像素级对齐）：
 * - 浏览器原生选中/复制 → 不用自己实现选区
 * - 文字透明 → 用户看到的是 canvas 上的真实渲染
 *
 * 关键细节：
 * - 字体大小用 `transform: scaleX()` 精确拉伸到 PDF 的宽度（而不是靠 letter-spacing）
 *   → 选中高亮的框能精确贴合字形
 * - `user-select: text` + `pointer-events: none`？
 *   → **不能**加 pointer-events:none，否则选不中；但要保证不影响标注层点击
 */

import { useMemo } from 'react';
import type { TextContentLike, TextViewportLike } from '../core/text-layer/layout';
import { layoutTextContent } from '../core/text-layer/layout';

/** TextLayer 参数 */
export interface TextLayerProps {
  /** 文本内容（pdf.js getTextContent 的结果） */
  content: TextContentLike | null;
  /** 视口 */
  viewport: TextViewportLike | null;
  /** 字号缩放（字符宽度压缩比，用于精确对齐） */
  charScale?: number;
}

/**
 * 文本层。
 *
 * @param props 参数
 */
export function TextLayer({ content, viewport, charScale = 1 }: TextLayerProps) {
  /** 排版后的行片段 */
  const lines = useMemo(() => {
    if (!content || !viewport) {
      return [];
    }
    return layoutTextContent(content, viewport);
  }, [content, viewport]);

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-text-layer" aria-hidden="true">
      {lines.map((line) => (
        <span
          /*
           * key 用"位置 + 文本"而不是数组下标：
           * 下标在重新排版后会指向不同的行 → React 复用错节点 → 文字错位。
           * 位置（left/top）在一页内唯一且稳定。
           */
          key={`${line.left}-${line.top}-${line.text.slice(0, 12)}`}
          className="scpdf-text-layer__item"
          style={{
            left: `${line.left}px`,
            top: `${line.top}px`,
            fontSize: `${line.fontSize}px`,
            // 横向拉伸到 PDF 的真实宽度（等宽近似 + 缩放最稳）
            transform: `scaleX(${charScale})`,
            transformOrigin: 'left top',
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}
