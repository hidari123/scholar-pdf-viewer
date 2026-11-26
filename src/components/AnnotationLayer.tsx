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
import { isSameRect } from '../core/highlight/hit-test';
import type { HighlightPalette } from '../core/highlight/palette';
import { paletteToCssVars, resolveHighlightColor } from '../core/highlight/palette';
import type { SearchHitRect } from '../core/search/highlight';
import type { HighlightRecord, ViewRect } from '../core/types';

/** AnnotationLayer 参数 */
export interface AnnotationLayerProps {
  /** 页码 */
  pageNumber: number;
  /** 高亮（受控） */
  highlights: HighlightRecord[];
  /** 当前视口尺寸（归一化坐标的参考） */
  viewport: { width: number; height: number };
  /**
   * 点击高亮。
   *
   * @deprecated 高亮块是 `pointer-events: none`（不能挡文字选择）
   * → 点击由**容器级事件委托**处理（`PdfViewer.handleHighlightContainerClick`）。
   * 这个 prop 不再使用，保留是为了不破坏外部类型。
   */
  onHighlightClick?: (highlight: HighlightRecord) => void;
  /** 激活的高亮 id */
  activeHighlightId?: string | null;
  /**
   * **当前激活的那个矩形**（视口 px）。
   *
   * ⚠️ **为什么需要它**（实测踩到的坑）：
   *
   * -> 宿主可能传了**重复的 id** ❌
   *    （实测：刷新后旧高亮恢复，新建的高亮**又拿到同一个 id** -> 两个高亮同 id）
   * -> 激活态只按 id 判断 -> **两个都加激活态** ❌
   *    -> 用户反馈："点击一个高亮 两个高亮都会被选中"
   * -> 加上**矩形** -> **只激活真正点到的那一个**
   */
  activeHighlightRect?: { left: number; top: number; width: number; height: number } | null;
  /**
   * 搜索命中（归一化矩形，当前页的）。
   *
   * 搜索高亮与用户高亮**分开渲染**（不同颜色），
   * 因为它们语义不同：用户高亮是"持久数据"，搜索高亮是"临时状态"。
   */
  searchRects?: SearchHitRect[];
  /** 当前激活的搜索命中（更高亮） */
  activeSearchRectIndex?: number | null;
  /**
   * 高亮色板：语义 key → CSS 颜色值。
   *
   * **包的边界**：包只负责"把颜色渲染出来"（纯视觉）；
   * 取色器 UI、语义含义（"我的"/"他人"）、持久化 → 全部归宿主。
   */
  palette?: HighlightPalette;
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
    viewport,
    activeHighlightId,
    activeHighlightRect,
    searchRects = [],
    activeSearchRectIndex = null,
    palette,
  } = props;

  /** 当前页的高亮（按归一化坐标 → 视口 px 换算） */
  const rects = useMemo(() => {
    const result: { highlight: HighlightRecord; rect: ViewRect }[] = [];

    for (const highlight of highlights) {
      const position = highlight.position;

      /*
       * ⚠️⚠️ **按【每个矩形自己的页码】过滤**，不能用 `position.pageNumber`（实测踩到的坑）。
       *
       * ### 问题（用户反馈）
       *
       * > "跨页选择高亮的时候 实测只能高亮第一页的内容
       * >  第二页的内容也高亮到了第一页"
       *
       * -> 跨页高亮有**多个矩形**（每页一个）
       * -> 但 \`position.pageNumber\` 只有**第一页** ❌
       * -> 之前用 \`position.pageNumber !== pageNumber\` 过滤 ❌
       *    -> 第 2 页的图层**看不到这条高亮** ❌
       *    -> -> **第 2 页没有高亮** ❌
       *
       * ### 修法
       *
       * -> **每个矩形**按**它自己的** \`pageNumber\` 判断
       * -> 一条跨页高亮 -> 第 1 页画它第 1 页的矩形
       * ->                     第 2 页画它第 2 页的矩形
       */
      for (const norm of position.rects) {
        if (norm.pageNumber !== pageNumber) {
          continue;
        }

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

  /**
   * 色板 → CSS 变量。
   *
   * 为什么要走 CSS 变量而不是直接把颜色写进 style：
   * - 宿主可以在自己的 CSS 里用 `var(--scpdf-hl-yellow)` 派生别的样式
   * - 换肤只改变量，不用重渲染
   */
  const paletteVars = useMemo(() => paletteToCssVars(palette), [palette]);

  /** 某个高亮的实际颜色（语义 key → CSS 颜色） */
  const colorOf = (highlight: HighlightRecord): string => {
    const color = resolveHighlightColor(palette, highlight.color, 'var(--scpdf-highlight-my)');
    // 命中色板 → 用 CSS 变量（宿主可再派生）；未命中 → 保留 var() 兜底
    return palette?.[highlight.color] ? `var(--scpdf-hl-${highlight.color})` : color;
  };

  if (rects.length === 0 && searchViewRects.length === 0) {
    return null;
  }

  return (
    <div className="scpdf-annotations" aria-hidden="false" style={paletteVars}>
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
            /*
             * ⚠️ **不要加 transform: scale()**：
             * rect 已经是"当前缩放下的视口 px"（由 norm × viewport 换算而来）
             * → 再乘一次 scale 就是**双重缩放** → 高亮偏移（实测偏 278px）。
             */
          }}
        />
      ))}

      {rects.map(({ highlight, rect }) => {
        /*
         * ⚠️⚠️ **激活态要按【矩形】判断**（不能只按 id）
         *
         * -> 宿主可能传了**重复的 id** ❌
         *    -> 只按 id -> **两个都激活** ❌
         *    -> 用户反馈："点击一个高亮 两个高亮都会被选中"
         * -> 有矩形 -> **只激活点到的那一个**
         * -> 没矩形（老调用方）-> 退回按 id
         */
        const isActive =
          activeHighlightRect !== undefined && activeHighlightRect !== null
            ? isSameRect(activeHighlightRect, rect)
            : activeHighlightId === highlight.id;
        const isMine = highlight.source !== 'others';

        return (
          /*
           * ⚠️⚠️ **高亮块不能挡住文本选择**（实测踩过的坑）。
           *
           * 旧实现：高亮渲染成 `<button>` + `pointer-events: auto`
           * → 高亮块**正好盖在文字上** → 用户在那一块**框选不了字**
           *   （实测：拖动起点落在 `BUTTON.scpdf-annotation` 上 → 选不中）。
           * → 用户反馈"点了高亮之后 无法取消选中状态"。
           *
           * 修法（和链接层一致）：
           * - 元素保留 `<button>`（a11y：能被读屏识别、能被键盘访问）
           * - 但 `pointer-events: none` → **不拦鼠标** → 能正常框选文字
           * - 点击由**容器级事件委托**处理（见 `PdfViewer` 的 `handleContainerClick`）
           */
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
              /*
               * ⚠️ **不要加 transform: scale()**：
               * rect 已经是"当前缩放下的视口 px"（由 norm × viewport 换算而来）
               * → 再乘一次 scale 就是**双重缩放** → 高亮偏移（实测偏 278px）。
               */
              // 颜色：语义 key → CSS 变量（宿主可自定义色板）
              background: colorOf(highlight),
            }}
            /*
             * ⚠️ **不挂 onClick**。
             *
             * 点击走**容器级事件委托**（`PdfViewer.handleContainerClick`），
             * 因为 `<button>` 上的 `pointer-events: none` 会让点击落到下层，
             * 但 `event.target` 仍会指向它（浏览器在合成事件时保留原 target）。
             */
            aria-label={highlight.selectedText}
            /*
             * ⚠️ **必须带 `data-highlight-id`**。
             *
             * 点高亮块要弹出操作条（用户要求）→ 需要按 id 找到高亮的 DOM 元素，
             * 才能算出它的视口矩形（浮层锚点）。
             *
             * → `aria-label` 是**文字内容**（可能重复、可能超长）→ 不能用来定位。
             */
            data-highlight-id={highlight.id}
          />
        );
      })}
    </div>
  );
}
