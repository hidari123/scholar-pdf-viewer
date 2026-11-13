/**
 * AnnotationLayer —— 高亮 / 链接 / 热点 的 DOM 覆盖层。
 *
 * 为什么不用 canvas 画标注：
 * - **可命中测试**：DOM 元素天然可点、可 hover、可被无障碍工具识别
 * - **可换肤**：颜色/透明度走 CSS 变量，宿主覆盖变量即可
 * - **文本可选**：高亮层用 pointer-events: none 挡住选区
 *
 * 坐标：输入是**视口 px**（当前缩放下），直接用 left/top/width/height 定位。
 * 缩放变化时宿主重算 → 高亮跟着缩放走（缩放无关性由 core 的 NormRect 保证）。
 */

import { useMemo } from 'react';
import type { HighlightRecord, ViewRect } from '../core/types';

/** AnnotationLayer 参数 */
export interface AnnotationLayerProps {
  /** 页码 */
  pageNumber: number;
  /** 高亮（受控） */
  highlights: HighlightRecord[];
  /** 缩放（用于把归一化坐标换算成视口 px） */
  scale: number;
  /** 当前视口尺寸（归一化坐标的参考） */
  viewport: { width: number; height: number };
  /** 点击高亮 */
  onHighlightClick?: (highlight: HighlightRecord) => void;
  /** 激活的高亮 id */
  activeHighlightId?: string | null;
}

/**
 * 高亮覆盖层。
 *
 * @param props 参数
 */
export function AnnotationLayer(props: AnnotationLayerProps) {
  const { pageNumber, highlights, scale, viewport, onHighlightClick, activeHighlightId } = props;

  /** 当前页的高亮（按归一化坐标 → 视口 px 换算） */
  const rects = useMemo(() => {
    const result: { highlight: HighlightRecord; rect: ViewRect }[] = [];

    for (const highlight of highlights) {
      const position = highlight.position;
      if (position.pageNumber !== pageNumber) {
        continue;
      }

      for (const norm of position.rects) {
        // 归一化 → 视口 px：坐标 × (当前视口 / 参考尺寸)
        const ratioX = norm.width > 0 ? viewport.width / norm.width : 1;
        const ratioY = norm.height > 0 ? viewport.height / norm.height : 1;

        const left = norm.x1 * ratioX;
        const top = norm.y1 * ratioY;
        const right = norm.x2 * ratioX;
        const bottom = norm.y2 * ratioY;

        result.push({
          highlight,
          rect: {
            left: Math.min(left, right),
            top: Math.min(top, bottom),
            width: Math.abs(right - left),
            height: Math.abs(bottom - top),
            pageNumber,
          },
        });
      }
    }

    return result;
  }, [highlights, pageNumber, viewport.width, viewport.height]);

  if (rects.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-annotations" aria-hidden="false">
      {rects.map(({ highlight, rect }) => {
        const isActive = activeHighlightId === highlight.id;
        const isMine = highlight.source !== 'others';

        return (
          <button
            key={`${highlight.id}-${rect.left}-${rect.top}`}
            type="button"
            className={[
              'scpdf-annotation',
              isMine ? 'scpdf-annotation--mine' : 'scpdf-annotation--others',
              isActive ? 'scpdf-annotation--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              // 缩放时同步（高亮块是纯色，不缩放字体）
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            onClick={
              onHighlightClick
                ? (event) => {
                    event.stopPropagation();
                    onHighlightClick(highlight);
                  }
                : undefined
            }
            aria-label={highlight.selectedText}
          />
        );
      })}
    </div>
  );
}
