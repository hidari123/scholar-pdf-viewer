/**
 * Page —— 一页的完整渲染（canvas + 文本层 + 标注层）。
 *
 * 分层（顺序很重要）：
 *   1. canvas      —— 视觉呈现（最底层）
 *   2. 文本层      —— 透明文字，供选中/复制（**必须在标注层下面**，否则会挡住标注点击）
 *   3. 标注层      —— 高亮/链接（最上层，可点击）
 *
 * 为什么文本层要透明：`color: transparent` —— 用户看到的是 canvas 的真实渲染，
 * 文本层只是"给浏览器一个可选中的替身"。
 */

import { memo, useEffect, useMemo, useState } from 'react';
import type { LinkAnnotationLike } from '../core/annotation/links';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import type { HighlightPalette } from '../core/highlight/palette';
import type { SearchHitRect } from '../core/search/highlight';
import type { PageSelectionShape } from '../core/selection/shape';
import type { PositionedTextItem } from '../core/text-layer/layout';
import { layoutTextItems } from '../core/text-layer/layout';
import type { HighlightRecord } from '../core/types';
import { AnnotationLayer } from './AnnotationLayer';
import { LinkLayer } from './LinkLayer';
import type { PageProxyLike, TextContentLike } from './PageCanvas';
import { PageCanvas } from './PageCanvas';
import { SelectionLayer } from './SelectionLayer';
import { StickyNoteLayer } from './StickyNoteLayer';
import { TextLayer } from './TextLayer';

/** Page 参数 */
export interface PageProps {
  /** 页码 */
  pageNumber: number;
  /** 页面代理（null = 还没取到） */
  page: PageProxyLike | null;
  /** 当前缩放 */
  scale: number;
  /** 页面尺寸（当前缩放下的 px） */
  size: { width: number; height: number };
  /**
   * **是否渲染 canvas**（默认 true）。
   *
   * ⚠️ **跨页选择需要"缓冲区内的页"也挂上文本层**（实测踩过的坑）。
   *
   * ```
   * 用户从第 1 页底部拖到第 2 页顶部
   * → 第 2 页如果**没挂文本层** → 浏览器的选区**到不了第 2 页**
   * → 浏览器只给一个"整页"的大矩形 → 自绘层画不出来 → **跨页选不了**
   * ```
   *
   * → 让缓冲区内的页**挂文本层但不挂 canvas**
   * → canvas 是最贵的（要重绘 PDF），文本层便宜（只是 DOM）
   */
  renderCanvas?: boolean;
  /** 页面尺寸（pt，归一化用） */
  pageSizePt?: { width: number; height: number };
  /** 链接注解（宿主注入） */
  annotations?: LinkAnnotationLike[] | null;
  /** 搜索命中矩形（当前页，归一化） */
  searchRects?: SearchHitRect[];
  /** 当前激活的搜索命中下标（当前页内） */
  activeSearchRectIndex?: number | null;
  /** 高亮（受控） */
  highlights: HighlightRecord[];
  /** 激活的高亮 id */
  activeHighlightId?: string | null;
  /** 高亮色板（语义 key → CSS 颜色） */
  palette?: HighlightPalette;
  /** 选区形状（自绘选区层用；页内坐标） */
  selectionShape?: PageSelectionShape;
  /** 点击高亮 */
  onHighlightClick?: (highlight: HighlightRecord) => void;
  /** 点击外部链接 */
  onExternalLink?: (url: string) => void;
  /**
   * 点击内部链接。
   *
   * ⚠️ **带 pageNumber**（而不是在 PdfViewer 里包一层 inline 箭头函数）
   * → inline 函数每次渲染都是新引用 → **`React.memo` 失效** → 拖动选区时
   *   18 个页全部重渲染 → 卡顿（实测的性能坑）。
   */
  onInternalLink?: (dest: string | unknown[], pageNumber: number) => void;
  /** 渲染失败 */
  onRenderError?: (error: unknown, pageNumber: number) => void;
  /**
   * 文本项就绪回调（搜索高亮用）。
   *
   * 搜索命中的字符偏移要转成矩形 → 需要该页的文本项几何。
   * ⚠️ 必须与**搜索索引**用的是同一份 items，否则偏移错位。
   */
  onTextItems?: (pageNumber: number, items: PositionedTextItem[]) => void;
  /** 批注（小便签，受控） */
  stickyNotes?: AnnotationRecord[];
  /** 点击批注 */
  onAnnotationClick?: (annotation: AnnotationRecord) => void;
  /** 无障碍标签 */
  ariaLabel?: string;
}

/**
 * 单页。
 *
 * @param props 参数
 */
export function PageInner(props: PageProps) {
  const {
    pageNumber,
    page,
    scale,
    size,
    pageSizePt,
    renderCanvas = true,
    annotations,
    searchRects,
    activeSearchRectIndex,
    highlights,
    activeHighlightId,
    palette,
    selectionShape,
    onHighlightClick,
    onExternalLink,
    onInternalLink,
    onRenderError,
    onTextItems,
    stickyNotes,
    onAnnotationClick,
    ariaLabel,
  } = props;

  /** 文本内容 */
  const [textContent, setTextContent] = useState<TextContentLike | null>(null);

  /** 视口（文本层定位要用；pdf.js 的 viewport 带 transform 矩阵） */
  const [viewport, setViewport] = useState<{
    width: number;
    height: number;
    scale: number;
    transform: number[];
  } | null>(null);

  /**
   * 取文本内容 + 视口。
   *
   * 依赖 scale：缩放后文本层要重新定位（否则文字与画布错位）。
   * 文本层不做缓存换算 —— 直接按新 scale 重取，成本可接受（pdf.js 的 getTextContent 很快）。
   */
  useEffect(() => {
    if (!page?.getTextContent) {
      setTextContent(null);
      setViewport(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        // getTextContent 是可选能力（宿主没实现就没有文本层）
        const getTextContent = page.getTextContent;
        if (!getTextContent) {
          return;
        }

        const [content, vp] = await Promise.all([
          getTextContent.call(page),
          Promise.resolve(page.getViewport({ scale })),
        ]);

        if (cancelled) {
          return;
        }

        setTextContent(content);

        // viewport 必须带 transform 矩阵（文本定位靠它）
        const raw = vp as unknown as {
          width: number;
          height: number;
          scale: number;
          transform?: number[];
        };

        setViewport({
          width: raw.width,
          height: raw.height,
          scale: raw.scale,
          transform: raw.transform ?? [scale, 0, 0, -scale, 0, raw.height],
        });
      } catch {
        // 文本层取不到不影响 canvas 渲染（图片型 PDF 常见）
        if (!cancelled) {
          setTextContent(null);
          setViewport(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [page, scale]);

  /**
   * 排版文本项 → 报告给父组件（搜索高亮用）。
   *
   * ⚠️ **必须与搜索索引用同一份 items**：
   * 索引文本 = `items.map(i => i.str).join('')`，
   * 这里的 `layoutTextItems` 用的就是同一份 `textContent.items`（顺序不变）
   * → 字符偏移能准确映射到矩形。
   */
  useEffect(() => {
    if (!textContent || !viewport) {
      onTextItems?.(pageNumber, []);
      return;
    }

    const items = layoutTextItems(textContent, viewport);
    onTextItems?.(pageNumber, items);
  }, [textContent, viewport, pageNumber, onTextItems]);

  /**
   * 视口尺寸（给链接层 / 标注层用）。
   *
   * ⚠️ **必须 `useMemo`** → 否则每次渲染都是新对象
   * → 传给子组件 → 它们的 `memo` 失效 → 整页重渲染（实测的性能坑）。
   */
  const viewportSize = useMemo(
    () => ({ width: size.width, height: size.height }),
    [size.width, size.height],
  );

  return (
    <>
      {renderCanvas ? (
        <PageCanvas page={page} scale={scale} ariaLabel={ariaLabel} onRenderError={onRenderError} />
      ) : null}

      {textContent && viewport ? (
        <TextLayer content={textContent} viewport={viewport} pageNumber={pageNumber} />
      ) : null}

      {/*
        自绘选区（在 canvas 之上、标注层之下）。

        ⚠️ 为什么不用原生 `::selection`：
        浏览器逐个 client rect 画背景 → 同行不同字号的 span 产生重叠矩形
        → 叠涂两次 → 阶梯状深浅不一。
        自绘（SVG clipPath）每个像素只画一次 → 均匀。
      */}
      <SelectionLayer pageNumber={pageNumber} shape={selectionShape} />

      {/*
        链接层在文本层之上：链接区域要能点（文本层的透明文字不能挡着）。
        但在标注层之下：高亮优先。
      */}
      {annotations && pageSizePt ? (
        <LinkLayer
          annotations={annotations}
          pageSize={pageSizePt}
          viewport={viewportSize}
          pageNumber={pageNumber}
          onExternalLink={onExternalLink}
          onInternalLink={onInternalLink}
        />
      ) : null}

      <AnnotationLayer
        pageNumber={pageNumber}
        highlights={highlights}
        viewport={viewportSize}
        activeHighlightId={activeHighlightId}
        onHighlightClick={onHighlightClick}
        searchRects={searchRects}
        activeSearchRectIndex={activeSearchRectIndex}
        palette={palette}
      />

      {/*
        批注层（WPS 式小便签）。

        ⚠️ **必须在标注层之上** → 便签才能 hover / 点击。
      */}
      {stickyNotes && stickyNotes.length > 0 ? (
        <StickyNoteLayer
          pageNumber={pageNumber}
          annotations={stickyNotes}
          highlights={highlights}
          viewport={viewportSize}
          onAnnotationClick={onAnnotationClick}
        />
      ) : null}
    </>
  );
}

/*
 * ⚠️⚠️ **必须用 `React.memo` 包住**（实测的性能坑）。
 *
 * 没有 memo 时：拖动选区 → `PdfViewer` 每次都重渲染
 * → **18 个 `<Page>` 全部重渲染** → 每个 Page 的 `TextLayer`（451 个 span）
 *   都要 React 协调一遍 → **拖动卡顿**。
 *
 * 实测（CPU profile）：
 * ```
 * 修复前: 拖动 49.5ms/步，脚本 620ms，drawImage 占 18%
 * 修复后: 拖动 21.0ms/步，脚本 139ms
 * ```
 *
 * → `memo` 只在 props **真的变了**时重渲染
 * → 选区变化时只有**受影响的那一页**重渲染（`selectionShape` 变了）。
 *
 * ⚠️ **前提：所有 props 都得是稳定引用**！
 * → `PdfViewer` 里不能给 `<Page>` 传 inline 箭头函数（每次都是新函数 → memo 失效）。
 */
export const Page = memo(PageInner);
