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
import type { LinkAnnotationLike } from '../core/annotation/links';
import type { DocumentCache } from '../core/cache/store';
import type { DocumentSource, LoadOptions } from '../core/document/loader';
import type { PdfViewerError } from '../core/errors';
import { pdfViewerError } from '../core/errors';
import type { OutlineItemLike } from '../core/outline/outline';
import type { PdfSearch, SearchHit } from '../core/search/search';
import type { HighlightRecord, NewHighlight, PdfDocInfo, SelectionData } from '../core/types';
import { useCurrentPage } from '../hooks/useCurrentPage';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useTextSelection } from '../hooks/useTextSelection';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { useZoom } from '../hooks/useZoom';
import type { Locale, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import { OutlinePanel } from './OutlinePanel';
import { Page } from './Page';
import type { PageProxyLike } from './PageCanvas';
import { PasswordDialog } from './PasswordDialog';
import { SearchPanel } from './SearchPanel';
import { ThumbnailPanel } from './ThumbnailPanel';
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
  /** 取目录（宿主注入 pdf.js 的 getOutline） */
  getOutline?: () => Promise<OutlineItemLike[] | null>;
  /** 页引用 → 页码的映射（解析目录目标用） */
  pageRefToNumber?: (ref: unknown) => number | null;
  /**
   * 目录页码映射就绪标记（宿主解析完 +1）。
   *
   * 宿主解析页引用→页码通常是异步的（pdf.js 的 getPageIndex 是 async），
   * 包拿不到"什么时候好了"的通知 → 宿主用这个标记告诉包"重新解析一次"。
   */
  outlineResolveToken?: number;
  /** 渲染缩略图（宿主注入；返回图片 URL） */
  renderThumbnail?: (pageNumber: number, width: number) => Promise<string | null>;
  /** 搜索引擎（宿主注入 core 的 PdfSearch 实例） */
  searchEngine?: PdfSearch | null;
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
  /**
   * 用包内置的密码框（宿主不接管时用）。
   *
   * 加密 PDF 是**通用场景**（不是业务）→ 包提供默认 UI；
   * 但**弹不弹、怎么弹**宿主说了算 → 传了这个回调就以宿主为准。
   */
  showPasswordDialog?: boolean;
  /** 外部链接点击（宿主决定怎么开） */
  onExternalLink?: (url: string) => void;
  /** 内部链接点击（宿主解析 dest → 页码） */
  onInternalLink?: (dest: string | unknown[], pageNumber: number) => void;
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
    getOutline,
    pageRefToNumber,
    outlineResolveToken,
    renderThumbnail,
    searchEngine,
    onDocumentLoad,
    onError,
    onSelectionChange,
    onHighlightClick,
    onPageChange,
    onZoomChange,
    onRequestPassword,
    showPasswordDialog = false,
    onExternalLink,
    onInternalLink,
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageElementsRef = useRef(new Map<number, HTMLElement>());

  const [scale, setScale] = useState<number>(typeof initialScale === 'number' ? initialScale : 1);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  /** 侧栏：'none' | 'thumbnails' | 'outline' */
  const [sidebar, setSidebar] = useState<'none' | 'thumbnails' | 'outline'>('none');

  /** 目录数据（宿主注入） */
  const [outline, setOutline] = useState<OutlineItemLike[] | null>(null);

  /** 密码框是否打开 */
  const [passwordOpen, setPasswordOpen] = useState(false);

  /** 上次密码是否错误（用于提示） */
  const [passwordWrong, setPasswordWrong] = useState(false);

  /** 当前使用的密码（内置密码框提交后更新 → 触发重新加载） */
  const [currentPassword, setCurrentPassword] = useState(password);

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
    password: currentPassword,
    /**
     * 密码请求：
     * - 宿主接管（传了 onRequestPassword）→ 转发给宿主
     * - 宿主没接管 + 开了内置密码框 → 打开内置对话框
     * - 都没有 → 忽略（错误会走 onError）
     */
    onRequestPassword: (info) => {
      if (onRequestPassword) {
        onRequestPassword(info);
        return;
      }
      if (showPasswordDialog) {
        setPasswordWrong(false);
        setPasswordOpen(true);
      }
    },
    getDocInfo,
    onDocumentLoad: (doc) => {
      setNumPages(doc.numPages);
      onDocumentLoad?.(doc);
    },
    onError,
  });

  /** 页面代理缓存（pageNumber → page proxy） */
  const [pageProxies, setPageProxies] = useState<Map<number, PageProxyLike>>(new Map());

  /** 链接注解缓存（pageNumber → 注解列表） */
  const [annotations, setAnnotations] = useState<Map<number, LinkAnnotationLike[]>>(new Map());

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
    // 缩放后要立刻重算可见页（修"缩放后白屏"）
    scale,
  });

  /**
   * 已经渲染过的页（白屏兜底）。
   *
   * 为什么需要：可见页是**异步**算出来的（要等 DOM 重排 + 取页 proxy），
   * 这中间如果某页已经滚出缓冲区，它的 canvas 会被卸载 → **白屏一闪**。
   *
   * 规则：**渲染过的页保留渲染**，直到它离缓冲区足够远（再卸载）。
   * 多渲染一页的代价只是内存，白屏的代价是体验。
   */
  const renderedPagesRef = useRef<Set<number>>(new Set());

  /** 要渲染的页 = 当前可见页 ∪ 渲染过的页（但排除明显远离的） */
  const pagesToRender = useMemo(() => {
    const toRender = new Set<number>(visiblePages);

    // 记录本次要渲染的页
    for (const pageNumber of visiblePages) {
      renderedPagesRef.current.add(pageNumber);
    }

    // 把"渲染过但已不在缓冲区"的页也保留（防白屏）
    for (const pageNumber of renderedPagesRef.current) {
      toRender.add(pageNumber);
    }

    return toRender;
  }, [visiblePages]);

  /** 取目录（宿主注入；懒加载 —— 打开目录面板时才取） */
  useEffect(() => {
    if (!getOutline || sidebar !== 'outline' || outline !== null) {
      return;
    }

    let cancelled = false;

    void getOutline()
      .then((items) => {
        if (!cancelled) {
          setOutline(items ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOutline([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getOutline, sidebar, outline]);

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

  /**
   * 取链接注解（可见页才取）。
   *
   * 注解是链接层的几何来源；没有它链接就点不了。
   * 懒加载：跟页面一样，只取可见页。
   */
  useEffect(() => {
    if (visiblePages.length === 0 || !data) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      const next = new Map(annotations);

      for (const pageNumber of visiblePages) {
        if (next.has(pageNumber)) {
          continue;
        }
        const proxy = pageProxies.get(pageNumber);
        if (!proxy?.getAnnotations) {
          continue;
        }
        try {
          const list = await proxy.getAnnotations();
          if (!cancelled) {
            next.set(pageNumber, list);
          }
        } catch {
          // 取不到注解不影响其它页
        }
      }

      if (!cancelled && next.size !== annotations.size) {
        setAnnotations(next);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [visiblePages, pageProxies, annotations, data]);

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
        onToggleThumbnails={
          features.thumbnails === false || !renderThumbnail
            ? undefined
            : () => setSidebar((v) => (v === 'thumbnails' ? 'none' : 'thumbnails'))
        }
        onToggleOutline={
          features.outline === false || !getOutline
            ? undefined
            : () => setSidebar((v) => (v === 'outline' ? 'none' : 'outline'))
        }
        onPrint={features.print === false ? undefined : () => globalThis.print?.()}
      />

      {children}

      {searchOpen ? (
        <SearchPanel
          search={searchEngine ?? null}
          onClose={() => setSearchOpen(false)}
          onNavigate={(hit: SearchHit) => {
            // 跳到命中所在页（宿主可再根据 start 做精确定位与高亮）
            scrollToPage(hit.pageNumber);
          }}
          locale={locale}
          messages={messages}
        />
      ) : null}

      {/*
        主体区：侧栏（缩略图 / 目录）与滚动容器**并列**（flex）。
        并列而非绝对定位 → 侧栏不覆盖工具栏（工具栏按钮始终可点），
        也不影响页面流的居中计算。
      */}
      <div className="scpdf-body">
        {sidebar === 'thumbnails' && renderThumbnail ? (
          <ThumbnailPanel
            totalPages={numPages}
            currentPage={page}
            visiblePages={visiblePages}
            pageSizes={pageSizesPt}
            renderThumbnail={renderThumbnail}
            onPageSelect={(target) => scrollToPage(target)}
            locale={locale}
            messages={messages}
          />
        ) : null}

        {sidebar === 'outline' && getOutline ? (
          <OutlinePanel
            outline={outline}
            pageRefToNumber={pageRefToNumber ?? (() => null)}
            resolveToken={outlineResolveToken}
            currentPage={page}
            onPageSelect={(target) => scrollToPage(target)}
            locale={locale}
            messages={messages}
          />
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
              const isVisible = pagesToRender.has(pageNumber);

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
                      pageSizePt={pageSizesPt[index]}
                      annotations={annotations.get(pageNumber) ?? null}
                      highlights={highlights}
                      activeHighlightId={activeHighlightId}
                      onHighlightClick={handleHighlightClick}
                      onExternalLink={onExternalLink}
                      onInternalLink={(dest) => onInternalLink?.(dest, pageNumber)}
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

      {/* 加密文档密码框（宿主没接管时） */}
      {showPasswordDialog && !onRequestPassword ? (
        <PasswordDialog
          open={passwordOpen}
          wrongPassword={passwordWrong}
          onSubmit={(value) => {
            setPasswordOpen(false);
            // 用新密码重新加载
            setCurrentPassword(value);
            reload();
          }}
          onCancel={() => {
            setPasswordOpen(false);
          }}
          locale={locale}
          messages={messages}
        />
      ) : null}
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
