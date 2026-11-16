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

import { useEffect, useState } from 'react';
import type { LinkAnnotationLike } from '../core/annotation/links';
import type { HighlightPalette } from '../core/highlight/palette';
import type { SearchHitRect } from '../core/search/highlight';
import type { PositionedTextItem } from '../core/text-layer/layout';
import { layoutTextItems } from '../core/text-layer/layout';
import type { HighlightRecord } from '../core/types';
import { AnnotationLayer } from './AnnotationLayer';
import { LinkLayer } from './LinkLayer';
import type { PageProxyLike, TextContentLike } from './PageCanvas';
import { PageCanvas } from './PageCanvas';
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
  /** 点击高亮 */
  onHighlightClick?: (highlight: HighlightRecord) => void;
  /** 点击外部链接 */
  onExternalLink?: (url: string) => void;
  /** 点击内部链接 */
  onInternalLink?: (dest: string | unknown[]) => void;
  /** 渲染失败 */
  onRenderError?: (error: unknown, pageNumber: number) => void;
  /**
   * 文本项就绪回调（搜索高亮用）。
   *
   * 搜索命中的字符偏移要转成矩形 → 需要该页的文本项几何。
   * ⚠️ 必须与**搜索索引**用的是同一份 items，否则偏移错位。
   */
  onTextItems?: (pageNumber: number, items: PositionedTextItem[]) => void;
  /** 无障碍标签 */
  ariaLabel?: string;
}

/**
 * 单页。
 *
 * @param props 参数
 */
export function Page(props: PageProps) {
  const {
    pageNumber,
    page,
    scale,
    size,
    pageSizePt,
    annotations,
    searchRects,
    activeSearchRectIndex,
    highlights,
    activeHighlightId,
    palette,
    onHighlightClick,
    onExternalLink,
    onInternalLink,
    onRenderError,
    onTextItems,
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

  return (
    <>
      <PageCanvas page={page} scale={scale} ariaLabel={ariaLabel} onRenderError={onRenderError} />

      {textContent && viewport ? (
        <TextLayer content={textContent} viewport={viewport} pageNumber={pageNumber} />
      ) : null}

      {/*
        链接层在文本层之上：链接区域要能点（文本层的透明文字不能挡着）。
        但在标注层之下：高亮优先。
      */}
      {annotations && pageSizePt ? (
        <LinkLayer
          annotations={annotations}
          pageSize={pageSizePt}
          viewport={{ width: size.width, height: size.height }}
          onExternalLink={onExternalLink}
          onInternalLink={onInternalLink}
        />
      ) : null}

      <AnnotationLayer
        pageNumber={pageNumber}
        highlights={highlights}
        viewport={{ width: size.width, height: size.height }}
        activeHighlightId={activeHighlightId}
        onHighlightClick={onHighlightClick}
        searchRects={searchRects}
        activeSearchRectIndex={activeSearchRectIndex}
        palette={palette}
      />
    </>
  );
}
