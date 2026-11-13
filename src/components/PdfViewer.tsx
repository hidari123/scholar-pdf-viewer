/**
 * PdfViewer —— 主组件。
 *
 * 职责：把 core 的能力组装成一个可用的阅读器。
 *
 * **边界（v2）**：组件只做 PDF 的事——加载、渲染、缩放、滚动、定位、选择、高亮绘制。
 * 弹窗、AI、笔记、持久化全在宿主（通过受控 props 与回调）。
 *
 * 结构：
 *   PdfViewer
 *   ├─ Toolbar（内置，零依赖；左右有 slots 给宿主塞内容）
 *   ├─ ScrollContainer（滚动容器 = 页面流）
 *   │   └─ Page（每页：占位 + PageCanvas + AnnotationLayer）
 *   └─ 状态层（loading / empty / error）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentCache } from '../core/cache/store';
import type { DocumentSource, LoadOptions } from '../core/document/loader';
import type { PdfViewerError } from '../core/errors';
import { pdfViewerError } from '../core/errors';
import type { HighlightRecord, NewHighlight, PdfDocInfo, SelectionData } from '../core/types';
import { useCurrentPage } from '../hooks/useCurrentPage';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useTextSelection } from '../hooks/useTextSelection';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { useZoom } from '../hooks/useZoom';
import type { Locale, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import { Page } from './Page';
import type { PageProxyLike } from './PageCanvas';
import type { ToolbarConfig } from './Toolbar';
import { Toolbar } from './Toolbar';

/** 功能开关 */
export interface Features {
  /** 搜索 */
  search?: boolean;
  /** 缩略图 */
  thumbnails?: boolean;
  /** 目录 */
  outline?: boolean;
  /** 键盘快捷键 */
  keyboard?: boolean;
  /** 打印 */
  print?: boolean;
}

/** PdfViewer props */
export interface PdfViewerProps {
  /** 文档来源（URL / Blob / ArrayBuffer） */
  file: DocumentSource | null;
  /** 宿主业务 id（缓存键） */
  documentId?: string;
  /** 受控高亮 */
  highlights?: HighlightRecord[];
  /** 缓存实例 */
  cache?: DocumentCache | null;
  /** 加载选项 */
  loadOptions?: LoadOptions;
  /** 密码 */
  password?: string;
  /** 初始页 */
  initialPage?: number;
  /** 初始缩放（'width' = 适配宽度） */
  initialScale?: 'width' | number;
  /** 工具栏配置 */
  toolbar?: ToolbarConfig;
  /** 功能开关 */
  features?: Partial<Features>;
  /** 语言 */
  locale?: Locale;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
  /** 主题 */
  theme?: 'light' | 'dark' | 'auto';
  /** 取页（由宿主注入 pdf.js） */
  getPage?: (pageNumber: number) => Promise<PageProxyLike | undefined>;
  /**
   * 取各页尺寸（pt）。
   *
   * 不传则用 A4（595×842）——**滚动条长度会不准**（不同 PDF 尺寸不同）。
   * 有真实尺寸时一定要传：它决定页顶边数组，进而决定"跳页"和"当前页"的准确性。
   */
  getPageSizes?: (numPages: number) => Promise<{ width: number; height: number }[]>;
  /** 取文档信息（页数/元数据） */
  getDocInfo?: (data: Uint8Array) => Promise<PdfDocInfo>;
  /** 加载成功 */
  onDocumentLoad?: (doc: PdfDocInfo) => void;
  /** 出错 */
  onError?: (error: PdfViewerError) => void;
  /** 选区变化（**纯几何**） */
  onSelectionChange?: (selection: SelectionData | null) => void;
  /** 新建高亮（宿主决定是否保存） */
  onHighlightCreate?: (highlight: NewHighlight) => void;
  /** 更新高亮 */
  onHighlightUpdate?: (id: string, highlight: NewHighlight) => void;
  /** 删除高亮 */
  onHighlightRemove?: (id: string) => void;
  /** 点击高亮 */
  onHighlightClick?: (highlight: HighlightRecord) => void;
  /** 当前页 */
  onPageChange?: (page: number, total: number) => void;
  /** 缩放变化 */
  onZoomChange?: (scale: number) => void;
  /** 加密文档：宿主接管密码输入 */
  onRequestPassword?: (info: { retry: (password: string) => void; cancel: () => void }) => void;
  /** 自定义内容（渲染在工具栏下方，宿主可放自己的面板） */
  children?: ReactNode;
}

/**
 * PDF 查看器。
 *
 * @param props 参数
 */
export function PdfViewer(props: PdfViewerProps) {
  const {
    file,
    documentId,
    highlights = [],
    cache,
    loadOptions,
    password,
    initialPage = 1,
    initialScale = 'width',
    toolbar,
    features = {},
    locale = 'zh',
    messages,
    theme = 'auto',
    getPage,
    getPageSizes,
    getDocInfo,
    onDocumentLoad,
    onError,
    onSelectionChange,
    onHighlightClick,
    onPageChange,
    onZoomChange,
    onRequestPassword,
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageElementsRef = useRef(new Map<number, HTMLElement>());

  const [scale, setScale] = useState<number>(typeof initialScale === 'number' ? initialScale : 1);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars),
    [locale, messages],
  );

  // 1) 加载文档
  const { data, loading, progress, error, reload } = usePdfDocument({
    file,
    documentId,
    cache,
    loadOptions,
    password,
    onRequestPassword,
    getDocInfo,
    onDocumentLoad: (doc) => {
      setNumPages(doc.numPages);
      onDocumentLoad?.(doc);
    },
    onError,
  });

  /** 页面代理缓存（pageNumber → page proxy） */
  const [pageProxies, setPageProxies] = useState<Map<number, PageProxyLike>>(new Map());

  /**
   * 页面尺寸（pt，scale=1 时的物理尺寸）。
   *
   * 默认用 A4（595×842）；宿主可传 `getPageSizes` 覆盖（不同 PDF 尺寸不同，
   * A4 假设会让滚动条长度不准）。
   */
  const [pageSizesPt, setPageSizesPt] = useState<{ width: number; height: number }[]>([]);

  // 2) 页面尺寸（当前缩放下的像素尺寸）
  const pageSizes = useMemo(() => {
    const sizes: { width: number; height: number }[] = [];
    for (let i = 0; i < numPages; i += 1) {
      const pt = pageSizesPt[i] ?? { width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT };
      sizes.push({ width: pt.width * scale, height: pt.height * scale });
    }
    return sizes;
  }, [numPages, scale, pageSizesPt]);

  /**
   * 页顶边数组（末项为文档总高哨兵）。
   *
   * **必须取整**：浏览器的 scrollTop 是整数（Device Pixel 会对齐），
   * 而页顶边是小数（1390.63 × 16 累加 → 29050.24）。
   * 不取整的话：滚到 tops[16]=29050.24 → 浏览器实际停在 29050
   * → `tops[i] <= scrollTop` 判 false → 明明在第 17 页却报第 16 页（差一页）。
   *
   * **必须含顶部留白**：`.scpdf-pages` 有 margin-top（16px），
   * 页元素相对容器内容原点的实际位置 = margin + 累加高度。
   * 漏掉 margin → 跳页差 16px、当前页判定偏一页。
   */
  const pageTops = useMemo(() => {
    const tops: number[] = [PAGES_MARGIN];
    let acc = PAGES_MARGIN;
    for (const size of pageSizes) {
      acc += size.height + PAGE_GAP;
      tops.push(Math.round(acc));
    }
    return tops;
  }, [pageSizes]);

  // 3) 虚拟化
  const { visiblePages } = useVisiblePages({
    containerRef,
    pageElements: pageElementsRef,
    totalPages: numPages,
  });

  /** 取各页尺寸（宿主注入；失败则用 A4 兜底） */
  useEffect(() => {
    if (!getPageSizes || numPages <= 0) {
      return;
    }

    let cancelled = false;

    void getPageSizes(numPages)
      .then((sizes) => {
        if (!cancelled && Array.isArray(sizes)) {
          setPageSizesPt(sizes);
        }
      })
      .catch(() => {
        // 取不到尺寸 → 保持 A4 兜底，不阻断渲染
      });

    return () => {
      cancelled = true;
    };
  }, [getPageSizes, numPages]);

  /**
   * 取页（可见页才取，懒加载）。
   *
   * 放在 useVisiblePages 之后：依赖 visiblePages（顺序有讲究）。
   * 只取可见页 → 100 页文档首屏只加载 3~7 页，不是 100 页。
   */
  useEffect(() => {
    if (!getPage || visiblePages.length === 0 || !data) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      const next = new Map(pageProxies);

      for (const pageNumber of visiblePages) {
        if (next.has(pageNumber)) {
          continue;
        }
        try {
          const proxy = await getPage(pageNumber);
          if (proxy && !cancelled) {
            next.set(pageNumber, proxy);
          }
        } catch {
          // 单页取不到不影响其它页
        }
      }

      if (!cancelled && next.size !== pageProxies.size) {
        setPageProxies(next);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [getPage, visiblePages, pageProxies, data]);

  // 4) 当前页
  const { scrollToPage } = useCurrentPage({
    containerRef,
    pageTops,
    onPageChange: (next) => {
      setPage(next);
      onPageChange?.(next, numPages);
    },
  });

  // 5) 缩放
  const zoom = useZoom({
    containerRef,
    scale,
    onScaleChange: (next) => {
      setScale(next);
      onZoomChange?.(next);
    },
  });

  /**
   * 初始缩放 = 适配宽度。
   *
   * 必须在**容器有宽度**之后才能算准；只做一次（之后由用户控制）→ ref 记住是否已执行。
   */
  const initialScaleAppliedRef = useRef(false);
  useEffect(() => {
    // 只在 initialScale === 'width' 时做适配宽度；数字初始值直接用
    if (initialScale !== 'width' || initialScaleAppliedRef.current) {
      return;
    }
    const container = containerRef.current;
    if (!container || container.clientWidth <= 0 || numPages <= 0) {
      return;
    }

    initialScaleAppliedRef.current = true;
    const pt = pageSizesPt[0] ?? { width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT };
    zoom.fitWidth(container.clientWidth, pt.width);
  }, [initialScale, numPages, pageSizesPt, zoom]);

  // 6) 选区
  useTextSelection({
    containerRef,
    pageFrames: pageSizes.map((size, index) => ({
      pageNumber: index + 1,
      top: pageTops[index] ?? 0,
      left: 0,
      width: size.width,
      height: size.height,
    })),
    scale,
    reference: { width: 595 * scale, height: 842 * scale },
    onSelectionChange,
  });

  // 7) 键盘快捷键
  useEffect(() => {
    if (features.keyboard === false) {
      return;
    }

    /** 键盘处理 */
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 输入框里不拦截
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'PageUp':
          scrollToPage(page - 1);
          break;
        case 'ArrowRight':
        case 'PageDown':
          scrollToPage(page + 1);
          break;
        case 'Home':
          scrollToPage(1);
          break;
        case 'End':
          scrollToPage(numPages);
          break;
        case '+':
        case '=':
          zoom.zoomIn();
          break;
        case '-':
          zoom.zoomOut();
          break;
        default:
          break;
      }
    };

    const container = containerRef.current;
    container?.addEventListener('keydown', onKeyDown);
    return () => {
      container?.removeEventListener('keydown', onKeyDown);
    };
  }, [features.keyboard, page, numPages, scrollToPage, zoom]);

  /** 点击高亮 */
  const handleHighlightClick = useCallback(
    (highlight: HighlightRecord) => {
      setActiveHighlightId(highlight.id);
      onHighlightClick?.(highlight);
    },
    [onHighlightClick],
  );

  const className = [
    'scpdf-root',
    theme === 'dark' ? 'scpdf-root--dark' : '',
    theme === 'auto' ? 'scpdf-root--auto' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-testid="pdf-viewer">
      <Toolbar
        toolbar={toolbar}
        page={page}
        totalPages={numPages}
        scale={scale}
        locale={locale}
        messages={messages}
        onPageChange={(next) => scrollToPage(next)}
        onZoomIn={zoom.zoomIn}
        onZoomOut={zoom.zoomOut}
        onFitWidth={() => zoom.fitWidth(containerRef.current?.clientWidth ?? 0, PAGE_WIDTH_PT)}
        onFitPage={() =>
          zoom.fitPage(
            containerRef.current?.clientWidth ?? 0,
            containerRef.current?.clientHeight ?? 0,
            PAGE_WIDTH_PT,
            PAGE_HEIGHT_PT,
          )
        }
        onToggleSearch={features.search === false ? undefined : () => setSearchOpen((v) => !v)}
        onPrint={features.print === false ? undefined : () => globalThis.print?.()}
      />

      {children}

      {searchOpen ? (
        <search className="scpdf-search">
          <input
            type="search"
            className="scpdf-search__input"
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
          />
        </search>
      ) : null}

      {/*
        滚动容器：section（自带 region 语义）+ tabIndex。
        键盘用户要能聚焦进来用方向键/PageUp/PageDown 翻页（无障碍要求）。
        biome 的 a11y 规则无法区分"可聚焦的滚动区域"与"普通 section"，
        这里是有意的语义选择（可聚焦的滚动 landmark），故豁免该规则。
      */}
      <section
        className="scpdf-container"
        ref={containerRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 可聚焦的滚动区域（键盘翻页需要）
        tabIndex={0}
        aria-label={t('a11y.canvas')}
      >
        {!file ? (
          <div className="scpdf-state">
            <p className="scpdf-state__title">{t('empty.title')}</p>
            <p className="scpdf-state__hint">{t('empty.hint')}</p>
          </div>
        ) : null}

        {loading ? (
          <output className="scpdf-state">
            <p className="scpdf-state__title">{t('load.loading')}</p>
            {progress > 0 ? (
              <p className="scpdf-state__hint">
                {t('load.progress', { percent: Math.round(progress * 100) })}
              </p>
            ) : null}
          </output>
        ) : null}

        {error ? (
          <div className="scpdf-state scpdf-state--error" role="alert">
            <p className="scpdf-state__title">{t('load.failed')}</p>
            <p className="scpdf-state__hint">{error.message}</p>
            <button type="button" className="scpdf-btn" onClick={reload}>
              {t('load.retry')}
            </button>
          </div>
        ) : null}

        {/*
          页面区高度 = 最后一项页顶边（即文档总高）。
          末项已含顶部留白 + 每页高度 + 间距 → 直接用作总高即可。
        */}
        <div className="scpdf-pages" style={{ height: pageTops.at(-1) ?? 0 }}>
          {pageSizes.map((size, index) => {
            const pageNumber = index + 1;
            const isVisible = visiblePages.includes(pageNumber);

            return (
              <div
                key={pageNumber}
                data-page-number={pageNumber}
                className="scpdf-page"
                ref={(element) => {
                  if (element) {
                    pageElementsRef.current.set(pageNumber, element);
                  } else {
                    pageElementsRef.current.delete(pageNumber);
                  }
                }}
                style={{
                  width: size.width,
                  height: size.height,
                  // 绝对定位 + top：页面按页顶边数组摆放（滚动定位靠它）
                  top: pageTops[index] ?? 0,
                }}
              >
                {isVisible ? (
                  <Page
                    pageNumber={pageNumber}
                    page={pageProxies.get(pageNumber) ?? null}
                    scale={scale}
                    size={size}
                    highlights={highlights}
                    activeHighlightId={activeHighlightId}
                    onHighlightClick={handleHighlightClick}
                    ariaLabel={t('a11y.page', { page: pageNumber })}
                    onRenderError={(renderError, failedPage) => {
                      onError?.(
                        pdfViewerError('E_RENDER_PAGE', {
                          cause: renderError,
                          pageNumber: failedPage,
                        }),
                      );
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** 页间距（px） */
const PAGE_GAP = 16;

/** 页面区上下留白（px）—— 必须与 CSS 的 .scpdf-pages margin 一致 */
const PAGES_MARGIN = 16;

/** 默认页宽（pt，A4） */
const PAGE_WIDTH_PT = 595;

/** 默认页高（pt，A4） */
const PAGE_HEIGHT_PT = 842;
