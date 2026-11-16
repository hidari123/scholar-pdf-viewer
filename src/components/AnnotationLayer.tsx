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
import type { SearchHitRect } from '../core/search/highlight';
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
  /**
   * 搜索命中（归一化矩形，当前页的）。
   *
   * 搜索高亮与用户高亮**分开渲染**（不同颜色），
   * 因为它们语义不同：用户高亮是"持久数据"，搜索高亮是"临时状态"。
   */
  searchRects?: SearchHitRect[];
  /** 当前激活的搜索命中（更高亮） */
  activeSearchRectIndex?: number | null;
}

/**
 * 高亮覆盖层。
 *
 * @param props 参数
 */
export function AnnotationLayer(props: AnnotationLayerProps) {
  const {
    pageNumber,
    highlights,
    scale,
    viewport,
    onHighlightClick,
    activeHighlightId,
    searchRects = [],
    activeSearchRectIndex = null,
  } = props;

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

  /** 搜索命中的矩形（归一化 → 视口 px） */
  const searchViewRects = useMemo(() => {
    return searchRects.map((norm, index) => {
      const left = norm.x * viewport.width;
      const top = norm.y * viewport.height;
      const width = norm.width * viewport.width;
      const height = norm.height * viewport.height;

      return {
        index,
        isActive: activeSearchRectIndex === index,
        rect: { left, top, width, height, pageNumber },
      };
    });
  }, [searchRects, viewport.width, viewport.height, activeSearchRectIndex, pageNumber]);

  if (rects.length === 0 && searchViewRects.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-annotations" aria-hidden="false">
      {/* 搜索命中（在用户高亮之下） */}
      {searchViewRects.map(({ index, isActive, rect }) => (
        <div
          key={`search-${index}-${Math.round(rect.left)}-${Math.round(rect.top)}`}
          className={[
            'scpdf-annotation',
            'scpdf-annotation--search',
            isActive ? 'scpdf-annotation--search-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      ))}

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
