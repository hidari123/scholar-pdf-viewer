/**
 * StickyNoteLayer —— **批注（小便签）**的 DOM 覆盖层。
 *
 * ## 用户需求
 *
 * > "第一个是添加批注 具体添加方式和wps的批注一样 也是加一个小便签纸一样的在上面
 * >  hover会展示出来"
 *
 * → 高亮块旁边出现一个**小便签图标**
 * → **hover** → 弹出**便签内容**（带小尾巴的纸片）
 *
 * ## 为什么用 DOM 而不是 canvas
 *
 * - **可 hover / 可点击**（DOM 天然支持）
 * - 便签内容需要**换行 / 滚动** → canvas 做不到
 * - 颜色走 CSS 变量 → 宿主可换肤
 */

import { useMemo, useState } from 'react';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import { STICKY_NOTE_SIZE, stickyNotePosition } from '../core/annotation/sticky-note';
import type { HighlightRecord, ViewRect } from '../core/types';

/** StickyNoteLayer 参数 */
export interface StickyNoteLayerProps {
  /** 页码 */
  pageNumber: number;
  /** 批注（受控） */
  annotations: AnnotationRecord[];
  /** 高亮（用来算便签的锚点位置） */
  highlights: HighlightRecord[];
  /** 当前视口尺寸（归一化坐标的参考） */
  viewport: { width: number; height: number };
  /** 点击便签（宿主实现：打开编辑框等） */
  onAnnotationClick?: (annotation: AnnotationRecord) => void;
  /** 鼠标进入便签 */
  onAnnotationHover?: (annotation: AnnotationRecord | null) => void;
}

/**
 * 批注覆盖层。
 *
 * @param props 参数
 */
export function StickyNoteLayer(props: StickyNoteLayerProps) {
  const { pageNumber, annotations, highlights, viewport, onAnnotationClick, onAnnotationHover } =
    props;

  /** 当前 hover 的批注 id（控制便签内容显��） */
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /** 高亮在页内的矩形（用来给便签找锚点） */
  const highlightRects = useMemo(() => {
    const map = new Map<string, ViewRect[]>();
    for (const highlight of highlights) {
      if (highlight.position.pageNumber !== pageNumber) {
        continue;
      }
      const list: ViewRect[] = [];
      for (const norm of highlight.position.rects) {
        const ratioX = norm.width > 0 ? viewport.width / norm.width : 1;
        const ratioY = norm.height > 0 ? viewport.height / norm.height : 1;
        const left = norm.x1 * ratioX;
        const top = norm.y1 * ratioY;
        const right = norm.x2 * ratioX;
        const bottom = norm.y2 * ratioY;
        list.push({
          left: Math.min(left, right),
          top: Math.min(top, bottom),
          width: Math.abs(right - left),
          height: Math.abs(bottom - top),
          pageNumber,
        });
      }
      if (list.length > 0) {
        map.set(highlight.id, list);
      }
    }
    return map;
  }, [highlights, pageNumber, viewport.width, viewport.height]);

  /** 便签的位置 */
  const notes = useMemo(() => {
    const result: { annotation: AnnotationRecord; left: number; top: number }[] = [];

    for (const annotation of annotations) {
      const rects = highlightRects.get(annotation.highlightId);
      // 锚点 = 高亮的**并集**（多行高亮 → 便签在整块的高亮右上角）
      let anchor: ViewRect | null = null;
      if (rects && rects.length > 0) {
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const r of rects) {
          left = Math.min(left, r.left);
          top = Math.min(top, r.top);
          right = Math.max(right, r.left + r.width);
          bottom = Math.max(bottom, r.top + r.height);
        }
        anchor = { left, top, width: right - left, height: bottom - top, pageNumber };
      }

      const pos = stickyNotePosition(annotation, anchor, viewport);
      if (!pos) {
        continue;
      }
      result.push({ annotation, left: pos.left, top: pos.top });
    }

    return result;
  }, [annotations, highlightRects, viewport, pageNumber]);

  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-sticky-notes" aria-hidden="false">
      {notes.map(({ annotation, left, top }) => {
        const isHovered = hoveredId === annotation.id;
        return (
          <span key={annotation.id} className="scpdf-sticky-note" style={{ left, top }}>
            <button
              type="button"
              className="scpdf-sticky-note__icon"
              style={{ width: STICKY_NOTE_SIZE, height: STICKY_NOTE_SIZE }}
              title="批注"
              aria-label={`批注：${annotation.content.slice(0, 20)}`}
              onMouseEnter={() => {
                setHoveredId(annotation.id);
                onAnnotationHover?.(annotation);
              }}
              onMouseLeave={() => {
                setHoveredId(null);
                onAnnotationHover?.(null);
              }}
              onFocus={() => {
                setHoveredId(annotation.id);
                onAnnotationHover?.(annotation);
              }}
              onBlur={() => {
                setHoveredId(null);
                onAnnotationHover?.(null);
              }}
              onClick={() => onAnnotationClick?.(annotation)}
            >
              <svg
                viewBox="0 0 24 24"
                width={STICKY_NOTE_SIZE}
                height={STICKY_NOTE_SIZE}
                aria-hidden
              >
                {/* 纸片 + 折角 */}
                <path
                  d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
                  fill="currentColor"
                />
                <path d="M14 3v5h5z" fill="rgba(0,0,0,0.22)" />
              </svg>
            </button>

            {/*
              **hover 才显示**内容（WPS 的做法）。

              ⚠️ 用 `aria-hidden` + `visibility` 而不是 `display:none`
              → 保留在无障碍树里（读屏软件能读到）。
            */}
            <span
              className="scpdf-sticky-note__content"
              data-visible={isHovered ? 'true' : 'false'}
              role="note"
            >
              {annotation.content}
            </span>
          </span>
        );
      })}
    </div>
  );
}
