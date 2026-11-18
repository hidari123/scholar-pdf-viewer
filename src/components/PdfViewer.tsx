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
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { LinkAnnotationLike } from '../core/annotation/links';
import type { DocumentCache } from '../core/cache/store';
import type { DocumentSource, LoadOptions } from '../core/document/loader';
import type { PdfViewerError } from '../core/errors';
import { pdfViewerError } from '../core/errors';
import type { HighlightPalette } from '../core/highlight/palette';
import type { OutlineItemLike } from '../core/outline/outline';
import type { SearchHitRect } from '../core/search/highlight';
import { hitsToRects } from '../core/search/highlight';
import type { PdfSearch, SearchHit } from '../core/search/search';
import type { SelectionAction, SelectionActionContext } from '../core/selection/actions';
import { BUILTIN_ACTION_KEYS, mergeSelectionActions } from '../core/selection/actions';
import { buildHighlightActions, HIGHLIGHT_ACTION_KEYS } from '../core/selection/highlight-actions';
import type { BaselinesByPage, PageBaselines, PageSelectionShape } from '../core/selection/shape';
import { buildSelectionShapes } from '../core/selection/shape';
import { measureAscentRatio } from '../core/text-layer/font-metrics';
import type { PositionedTextItem } from '../core/text-layer/layout';
import type { PdfViewerAppearance, PdfViewerSlots, PdfViewerTheme } from '../core/theme';
import { appearanceStyles, themeClasses } from '../core/theme';
import type {
  HighlightRecord,
  NewHighlight,
  NormPosition,
  PdfDocInfo,
  SelectionData,
} from '../core/types';
import { useCurrentPage } from '../hooks/useCurrentPage';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { usePrint } from '../hooks/usePrint';
import { useSelectionPreservation } from '../hooks/useSelectionPreservation';
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
import { SelectionPopover } from './SelectionPopover';
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

/**
 * `PdfViewer` 的**命令式句柄**（宿主用 `ref` 拿）。
 *
 * ## 为什么需要
 *
 * 宿主可能自己实现 UI（比如工具栏插槽里的"高亮"按钮），
 * 那时**绕过**了包的浮层动作 → 包不知道"高亮做完了"
 * → **选区不会被清掉**（选区的蓝色块一直浮在高亮上）。
 *
 * ```tsx
 * const viewerRef = useRef<PdfViewerHandle>(null);
 *
 * <button onClick={() => {
 *   saveHighlight(...);
 *   viewerRef.current?.clearSelection();   // ← 告诉包"高亮做完了"
 * }}>高亮</button>
 *
 * <PdfViewer ref={viewerRef} ... />
 * ```
 */
export interface PdfViewerHandle {
  /**
   * **清掉当前选区**（自绘蓝色块 + 浏览器原生选区 + 浮层）。
   *
   * 宿主自己做了"高亮"这类**消费选区**的操作后调它。
   */
  clearSelection: () => void;
  /**
   * **宿主自己创建了高亮**（自己的工具栏按钮）→ 通知包。
   *
   * → 包会调 `onHighlightCreate`（宿主存高亮）+ **清掉选区**。
   *
   * ⚠️ **包内置的"高亮"按钮不要用这个**（它自己会走 `onHighlight`）
   *    → 两个都走 → 宿主会保存两次。
   */
  createHighlight: (highlight: NewHighlight) => void;
  /** 当前页码（1 起） */
  getCurrentPage: () => number;
  /** 总页数 */
  getNumPages: () => number;
  /**
   * 每页的**点尺寸**（72dpi，如 A4 = 595 × 842）。
   *
   * ⚠️ **导出带高亮的 PDF 时需要它**（归一化坐标 → PDF 点坐标要按页尺寸换算）。
   *
   * @example
   * ```ts
   * const bytes = await exportHighlightedPdf({
   *   pdfBytes,
   *   highlights,
   *   pageSizesPt: viewerRef.current.getPageSizesPt(),
   * });
   * ```
   */
  getPageSizesPt: () => { width: number; height: number }[];
  /** 跳到某页 */
  goToPage: (page: number) => void;
}

/** PdfViewer props */
export interface PdfViewerProps {
  /** 文档来源（URL / Blob / ArrayBuffer） */
  file: DocumentSource | null;
  /** 宿主业务 id（缓存键） */
  documentId?: string;
  /** 受控高亮 */
  highlights?: HighlightRecord[];
  /**
   * 高亮色板：语义 key → CSS 颜色值。
   *
   * **包的边界**：包只负责"把颜色渲染出来"（纯视觉）。
   * 取色器 UI、语义含义、持久化 → 归宿主。
   *
   * 例：`{ yellow: '#ffd54a', 'my-1': '#ff6b6b' }`
   * → 高亮记录的 `color: 'my-1'` 会渲染成 `#ff6b6b`。
   */
  highlightPalette?: HighlightPalette;
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
  theme?: PdfViewerTheme;
  /**
   * **外观配置**（结构开关，不是颜色）。
   *
   * ⚠️ **和 `theme` 的分工**：
   * - `theme` → **整体风格**（颜色、阴影、圆角）
   * - `appearance` → **结构**（显示哪些按钮、密度）
   *
   * ```tsx
   * <PdfViewer
   *   theme="paper"                              // 米黄护眼
   *   appearance={{ density: 'compact' }}        // 紧凑
   * />
   * ```
   */
  appearance?: PdfViewerAppearance;
  /**
   * **打印模式**。
   *
   * - `'with-highlights'`（默认）：打印**带高亮**（用户要求"保留"）
   * - `'original'`：**只打印原 PDF**（不带高亮 / 不带标注）
   *
   * ⚠️ 高亮是 DOM（`.scpdf-annotation`）→ 默认会被打印
   * → `'original'` 模式用 CSS 隐藏它们（见 `viewer.css` 的 `@media print`）。
   *
   * ⚠️ 无论哪种模式，**工具栏 / 侧栏 / 浮层 / 文本层都不会被打印**
   *    （见 `@media print` 里的隐藏规则）。
   */
  printMode?: 'with-highlights' | 'original';
  /**
   * **插槽**（方案 D：完全自定义）。
   *
   * 每个槽给了就**替换**内置的那块；不给就用内置的。
   *
   * | 槽            | 替换什么         | 宿主要自己负责什么                       |
   * | ------------- | ---------------- | ---------------------------------------- |
   * | `toolbar`     | 整个工具栏       | 翻页 / 缩放 / 搜索 / 打印 等所有按钮      |
   * | `panel`       | 侧栏（缩略图/目录） | 缩略图 / 目录的全部逻辑                   |
   * | `pageOverlay` | 页内叠加层       | 盖在页上的任意内容（批注、印章…）         |
   *
   * ⚠️ **替换掉的部分，包不再负责它的功能**：
   * 比如替换了 `toolbar` → 包**不会**再渲染缩放按钮 → 宿主自己接 `viewerRef`。
   *
   * @example
   * ```tsx
   * <PdfViewer
   *   slots={{
   *     toolbar: <MyToolbar onZoomIn={() => viewerRef.current?.zoomIn()} />,
   *   }}
   * />
   * ```
   */
  slots?: PdfViewerSlots;
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
  /**
   * 选区浮层的动作（宿主注入）。
   *
   * - **覆盖**同名内置动作
   * - **追加**新动作
   * - 传 `undefined` → 只显示内置的"高亮 + 复制"
   *
   * ⚠️ **包的边界**：包只提供 UI + 事件，
   * 翻译/提问/笔记的**业务实现全在宿主**。
   */
  selectionActions?: SelectionAction[];
  /** 宿主实现了"翻译"→ 显示翻译按钮（等价于在 selectionActions 里配一个 translate） */
  onTranslate?: (ctx: SelectionActionContext) => void;
  /** 宿主实现了"提问" */
  onAsk?: (ctx: SelectionActionContext) => void;
  /** 宿主实现了"笔记" */
  onNote?: (ctx: SelectionActionContext) => void;
  /** 宿主实现了"解释" */
  onExplain?: (ctx: SelectionActionContext) => void;
  /** 宿主实现了"复制"（不传则用内置的剪贴板实现） */
  onCopy?: (ctx: SelectionActionContext) => void;
  /** 浮层里"高亮"按钮点击（宿主决定颜色与是否保存） */
  onHighlight?: (ctx: SelectionActionContext) => void;
  /** 新建高亮（宿主决定是否保存） */
  onHighlightCreate?: (highlight: NewHighlight) => void;
  /**
   * **宿主自己创建了高亮之后**调一下（可选）。
   *
   * ⚠️ **为什么要这个**：
   * 宿主可能自己实现"高亮"按钮（不走包的浮层动作）
   * → 那时包的浮层动作不会触发 → **选区不会被清掉**
   * → 选区的蓝色块一直浮在高亮上（用户反馈"无法取消选中状态"）。
   *
   * → 宿主调这个 → 包负责清选区（"清选区"是 UI 行为，属于包）。
   *
   * ```tsx
   * <PdfViewer
   *   onHighlightCreate={(h) => save(h)}
   *   onHighlightCreated={() => console.log('包已清选区')}
   * />
   * ```
   */
  onHighlightCreated?: () => void;
  /** 更新高亮 */
  onHighlightUpdate?: (id: string, highlight: NewHighlight) => void;
  /** 删除高亮 */
  onHighlightRemove?: (id: string) => void;
  /** 点击高亮 */
  onHighlightClick?: (highlight: HighlightRecord) => void;
  /**
   * **高亮块操作条**的回调（宿主实现）。
   *
   * ⚠️ **宿主没传 ⇒ 对应按钮不渲染**（和选区浮层一致）。
   */
  /** 换色 */
  onHighlightColorChange?: (id: string, color: string) => void;
  /** 复制高亮的文字 */
  onHighlightCopy?: (text: string) => void;
  /** 更多（宿主自定义） */
  onHighlightMore?: (id: string) => void;
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
 * @param props 参数（React 19：`ref` 是普通 prop）
 */
export function PdfViewer(props: PdfViewerProps & { ref?: React.Ref<PdfViewerHandle> }) {
  const {
    ref,
    file,
    documentId,
    highlights = [],
    highlightPalette,
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
    appearance,
    printMode = 'with-highlights',
    slots,
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
    selectionActions,
    onTranslate,
    onAsk,
    onNote,
    onExplain,
    onCopy,
    onHighlight,
    onHighlightCreate,
    onHighlightCreated,
    onHighlightUpdate,
    onHighlightRemove,
    onHighlightClick,
    onHighlightColorChange,
    onHighlightCopy,
    onHighlightMore,
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

  /*
   * ⚠️ **激活高亮的自动消失定时器**。
   *
   * 用户反馈："点击高亮之后 发现无法取消选中状态 一直都有外边框"
   * → 蓝框（`.scpdf-annotation--active` 的 outline）不能**永久**挂着
   * → 点击后 1.5s 自动消失（给出"刚才点了这条"的反馈）
   * → hover 时也会显示（鼠标移开就没）
   */
  const activeHighlightTimerRef = useRef(0);

  /**
   * **高亮块操作条**的状态。
   *
   * 用户要求："点击高亮之后 应该也会出现那个选择的弹框 可以选择颜色等"
   * → 点高亮块 → 在高亮的位置弹出浮层 → 复用选区浮层的样式。
   *
   * ⚠️ **`rect` 可能为 `null`**（高亮被删了 / 还没渲染出来）
   * → 浮层这时不显示（而不是显示在 0,0）。
   */
  const [highlightPopover, setHighlightPopover] = useState<{
    id: string;
    text: string;
    rect: { left: number; top: number; right: number; bottom: number } | null;
  } | null>(null);

  /** 侧栏：'none' | 'thumbnails' | 'outline' */
  const [sidebar, setSidebar] = useState<'none' | 'thumbnails' | 'outline'>('none');

  /** 目录数据（宿主注入） */
  const [outline, setOutline] = useState<OutlineItemLike[] | null>(null);

  /** 搜索命中（由 SearchPanel 回调） */
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);

  /** 当前激活的搜索命中下标 */
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  /**
   * 各页的文本项（用于把搜索命中的字符偏移转成矩形）。
   *
   * ⚠️ 必须与**搜索索引**用的是同一份 items，
   * 否则偏移错位 → 高亮跑到别的字上。
   * 这里从 `Page` 渲染时用的 textContent 来（宿主注入的 getTextContent）。
   */
  const [textItemsByPage, setTextItemsByPage] = useState<Map<number, PositionedTextItem[]>>(
    new Map(),
  );

  /**
   * 选区的**形状**（每页一组矩形，页内坐标）—— 自绘选区层用。
   *
   * ⚠️ 为什么单独存一份：
   * - `SelectionData.rects` 是**合并同行后**的矩形 → 形状细节丢失
   * - 自绘层需要**原始 client rects** → 精确贴合文字
   */
  const [selectionShapes, setSelectionShapes] = useState<Map<number, PageSelectionShape>>(
    new Map(),
  );

  /** 选区浮层是否打开 */
  const [popoverOpen, setPopoverOpen] = useState(false);

  /** 选区浮层的锚点（选区矩形，视口坐标） */
  const [popoverAnchor, setPopoverAnchor] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  /**
   * **浮层锚点的"版本号"** —— 用来强制浮层重算位置。
   *
   * 浮层自己会实时读 DOM 选区算锚点（滚动/缩放都跟得上），
   * 但有些变化它感知不到（比如选区被**恢复**了）。
   * → 用版本号把这些时刻通知给它。
   */
  const [anchorVersion, setAnchorVersion] = useState(0);

  /** 当前选区（浮层动作的上下文） */
  const [currentSelection, setCurrentSelection] = useState<SelectionData | null>(null);

  /**
   * 浮层里"高亮"当前用的颜色 key。
   *
   * 颜色下拉选完会记到这里 → 点 🖍 主按钮时用它。
   */
  const [pickedColor, setPickedColor] = useState<string | null>(null);

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
   * 页面尺寸表（页码 → **视口 px** 尺寸，搜索高亮归一化用）。
   *
   * ⚠️ 必须用**视口 px**（不是 pt）：文本项的 left/top/width 也是视口 px，
   * 单位不一致会让归一化结果差一个缩放倍数。
   */
  const pageSizesByPage = useMemo(() => {
    const map = new Map<number, { width: number; height: number }>();
    for (let i = 0; i < numPages; i += 1) {
      const size = pageSizes[i];
      if (size) {
        map.set(i + 1, { width: size.width, height: size.height });
      }
    }
    return map;
  }, [numPages, pageSizes]);

  /**
   * **页左边距**（滚动内容坐标）。
   *
   * ⚠️⚠️ **不能假设 `left = 0`**（实测踩过的坑）。
   *
   * 页元素是**居中**的（`.scpdf-page` 用 `margin-inline: auto`）。
   * → 当页宽 < 容器宽时（低缩放 / 适合页面），页会**居中偏移**。
   *
   * 实测（100% 缩放，容器 1384px 宽，页 612px 宽）：
   * ```
   * 页实际 left = 386（居中后）
   * 选区矩形 centerX = 681.5
   * 若按 left=0 判定：  681.5 > 0 + 612  → **不属于任何页** ❌
   *                  → 选区被丢弃 → **自绘选区层为空**
   * ```
   *
   * → **直接量页元素的实际 left**（比算准：能自动处理 padding、滚动条、
   *   居中规则的变化）。
   */
  const [pageLeft, setPageLeft] = useState(0);

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

  /**
   * 要挂**文本层**的页。
   *
   * ⚠️ **比"要渲染 canvas 的页"更多**（实测踩过的坑）。
   *
   * ```
   * 用户从第 1 页底部拖到第 2 页顶部
   * → 第 2 页如果没挂文本层 → 浏览器的选区**到不了第 2 页**
   * → 浏览器只给一个"整页"的大矩形 → 自绘层画不出来 → **跨页选不了**
   * ```
   *
   * → 文本层**必须覆盖可见页 + 缓冲区**（比 canvas 多几页）。
   *
   * ⚠️ canvas 不跟着多渲染（canvas 要重绘 PDF，很贵）
   *    → 缓冲区内的页：**只挂文本层，不挂 canvas**。
   */
  const textLayerPages = useMemo(() => {
    const set = new Set<number>(pagesToRender);

    // 可见页的前后各多几页（跨页选择要够到相邻页）
    const visible = [...visiblePages].sort((a, b) => a - b);
    const first = visible[0] ?? 1;
    const last = visible[visible.length - 1] ?? 1;
    for (let p = Math.max(1, first - 2); p <= Math.min(numPages, last + 2); p++) {
      set.add(p);
    }

    return set;
  }, [pagesToRender, visiblePages, numPages]);

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

  /**
   * **缩放后保持选区**。
   *
   * ⚠️ 缩放会**销毁浏览器选区**（文本层重渲染 → span 全被替换）。
   * → 浮层依附的选区没了 → 浮层被关闭 → 用户看到"缩放后浮层消失 / 选择跑偏"。
   *
   * → 缩放前记住字符偏移，缩放后恢复。
   */
  /**
   * 选区恢复后的回调（**必须稳定**，否则会让恢复循环反复重启）。
   */
  const handleSelectionRestored = useCallback(() => {
    /*
     * 选区恢复了 → 浮层要**重新打开**。
     *
     * ⚠️ 缩放时浏览器**静默丢弃**选区（实测：不触发 `selectionchange`）
     *    → 所以 `handleSelectionChange` 不会被调用
     *    → 浮层的 open 状态没人改（这里要主动打开）。
     *
     * ⚠️ **必须等一帧**再打开：
     *    `onRestored` 触发的那一刻，选区虽然存在，但文本层可能**还在重排**
     *    → `getBoundingClientRect()` 拿到的坐标是**旧的**
     *    → 浮层会停在错误位置（实测偏 129.6px）。
     *    → 下一帧（文本层排版完）再算位置就准了。
     */
    requestAnimationFrame(() => {
      const domSelection = window.getSelection();
      if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
        const rect = domSelection.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          setPopoverAnchor({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          });
          setPopoverOpen(true);
        }
      }
      // 触发浮层重新算锚点
      setAnchorVersion((v) => v + 1);
    });
  }, []);

  const selectionPreservation = useSelectionPreservation({
    containerRef,
    scale,
    onRestored: handleSelectionRestored,
  });

  /*
   * 缩放**前**保存选区。
   *
   * ⚠️ 必须在 `setScale` **之前**保存 ——
   *    `setScale` 会触发重渲染 → 文本层重建 → 浏览器选区就没了。
   */
  const handleZoomChange = useCallback(
    (next: number) => {
      selectionPreservation.save();
      setScale(next);
      onZoomChange?.(next);
    },
    [selectionPreservation, onZoomChange],
  );

  // 5) 缩放
  /**
   * **当前的适配模式**（`'width'` / `'page'` / `null` = 用户手动定的）。
   *
   * ⚠️ **用 state 而不是 ref** → ResizeObserver 的回调要读它 → 得是 state 才会重新订阅。
   */
  const [fitMode, setFitMode] = useState<'width' | 'page' | null>(
    initialScale === 'width' ? 'width' : null,
  );

  const zoom = useZoom({
    containerRef,
    scale,
    onScaleChange: handleZoomChange,
    fitMode,
    onFitModeChange: setFitMode,
  });

  /**
   * **打印**（用 `usePrint` 编排，不自己手写）。
   *
   * ⚠️ **必须用 `usePrint`**（实测踩过的坑）：
   * 之前这里内联手写了一遍"算缩放 → setProperty → 双 rAF → print"
   * → **打印完不恢复**（`--scpdf-print-scale` 永久残留）
   * → 而且和 `usePrint` 的逻辑重复 → 修 bug 要改两处。
   *
   * → 现在统一走 `usePrint` → 它负责：算缩放 → 应用 → 等重排 → 打印 → **恢复**。
   */
  const { print: printDocument } = usePrint({
    pageSizePt: pageSizesPt[0],
    paper: 'A4',
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;

    /*
     * ⚠️ **容器宽度变化 → 页的居中偏移也变** → `pageLeft` 要重算。
     *
     * ⚠️⚠️ **容器变窄 → 自动重新适配**（WPS 式行为，用户要求）。
     *
     * 实测（修复前）：
     * ```
     * 初始:      scale=230%  containerW=1384  pageW=1408
     * 开缩略图:  scale=230%  containerW=1139  pageW=1408   ← ❌ 页比容器还宽！
     * ```
     * → 页**横向溢出了**（要横向滚动才能看全）→ 很难用。
     *
     * WPS / Chrome 的行为：**打开侧栏 → 重新适配宽度** → 页还是完整可见。
     *
     * ⚠️ **只在"适配模式"下才重适配**：
     * - 用户手动缩放过（`fitMode === null`）→ **不动**（尊重用户的偏好）
     * - 适配宽度（`fitMode === 'width'`）→ 按新宽度重算
     * - 适配整页（`fitMode === 'page'`）→ 宽高都变了就重算
     */
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      const widthChanged = Math.abs(width - lastWidth) >= 2;
      const heightChanged = Math.abs(height - lastHeight) >= 2;
      // 宽度没变 → 不管（高度变化不影响适配宽度）
      if (!widthChanged && !heightChanged) {
        return;
      }
      lastWidth = width;
      lastHeight = height;

      if (numPages <= 0 || width <= 0) {
        return;
      }

      const pt = pageSizesPt[0] ?? { width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT };

      /*
       * ⚠️ **只处理"宽度变了"**（适配宽度 / 适配整页）。
       *
       * 高度变化（滚动条出现/消失）不该触发重适配 → 否则会抖。
       */
      if (!widthChanged) {
        return;
      }

      if (fitMode === 'width') {
        zoom.fitWidth(width, pt.width);
        return;
      }
      if (fitMode === 'page') {
        zoom.fitPage(width, height, pt.width, pt.height);
      }
      // fitMode === null → 用户手动定的比例 → 不动
    });

    observer.observe(container);

    /*
     * ⚠️ **量页的居中偏移**（`pageLeft`）。
     *
     * 页是 `margin-inline: auto` 居中的 → left 取决于容器宽和页宽
     * → 容器变宽 / 缩放变化时都会变。
     *
     * → 用 ResizeObserver + 缩放变化后各量一次。
     */
    const measurePageLeft = () => {
      const pageEl = container.querySelector<HTMLElement>('.scpdf-page');
      if (!pageEl) {
        return;
      }

      /*
       * ⚠️⚠️ **必须用 `getBoundingClientRect()` 差值**（不能用 `offsetLeft`）。
       *
       * ## 为什么 `offsetLeft` 不行（实测踩过的坑）
       *
       * ```
       * pageOffsetParent: "scpdf-pages"      ← 页的 offsetParent 不是容器！
       * 面板打开后: pageOffsetLeft=0, containerOffsetLeft=245
       *   offsetLeft 公式 = 0 - 245 = -245     ← ❌ 整个选区偏 245px（面板宽度）
       *   正确公式       = 0                   ← ✅
       * ```
       *
       * `offsetLeft` 是相对 **offsetParent** 的，而页的 offsetParent 是
       * `.scpdf-pages`（不是滚动容器）→ 减容器的 offsetLeft 是**错的**。
       *
       * ## 为什么之前换过公式
       *
       * 早先用的是 `getBoundingClientRect()` 差值，但**测量时机**不对：
       * 布局还没稳定时会算出错值（实测：先算出 395，后面变成 8、0……）。
       * → **根因是时机，不是公式** → 用 rAF 推迟到布局完成后测。
       */
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();

      // 页宽为 0 → 还没布局好 → 不更新（否则会算出垃圾值）
      if (pageRect.width <= 0) {
        return;
      }

      /*
       * ⚠️⚠️ **不要加 `container.scrollLeft`**（实测踩过的坑）。
       *
       * `pageLeft` 的**消费方**是 `buildSelectionShapes`：
       * ```ts
       * const toContentX = (x: number) => x - containerRect.left;   // ← 没有 scrollLeft
       * const toContentY = (y: number) => y - containerRect.top + scrollTop;  // ← 有 scrollTop
       * ```
       * → `toContentX` 给的是**视口相对**的 X（没做滚动补偿）
       * → `pageLeft` 必须和它**同一个坐标空间** → **不能加 scrollLeft**
       *
       * 加了会怎样（实测）：
       * → 缩放后 `scrollLeft` 变了 → `pageLeft` 和选区对不上
       * → 选区**整体横向偏移**（实测：Δtop 从 0.01px 变成 16.48px，
       *   而且选区宽度从 191.8px 变成 403.4px —— 归页都错了）。
       */
      const left = Math.round(pageRect.left - containerRect.left);
      setPageLeft((prev) => (Math.abs(prev - left) >= 1 ? left : prev));
    };

    /*
     * ⚠️ **rAF 里测** → 等布局稳定。
     *
     * ResizeObserver 的回调触发时，布局可能还没完成
     * → 直接测会拿到过期值（实测：395 → 8 → 0）。
     */
    const scheduleMeasure = () => {
      requestAnimationFrame(measurePageLeft);
    };

    scheduleMeasure();
    const pageObserver = new ResizeObserver(() => scheduleMeasure());
    pageObserver.observe(container);
    // 页宽变化（缩放）也会改 left → 观察页自身
    const firstPage = container.querySelector<HTMLElement>('.scpdf-page');
    if (firstPage) {
      pageObserver.observe(firstPage);
    }

    return () => {
      observer.disconnect();
      pageObserver.disconnect();
    };
  }, [numPages, pageSizesPt, zoom, fitMode]);

  /**
   * 收到选区的原始 client rects → 转成"每页的形状"（自绘选区用）。
   *
   * ⚠️ 坐标系：
   * - client rects 是**视口坐标**
   * - `pageFrames` 的 top/left 是**滚动内容坐标**
   * - `buildSelectionShapes` 内部统一换算到页内坐标
   */
  /**
   * **按坐标找链接元素**。
   *
   * ⚠️ 为什么不能用 `document.elementFromPoint()`：
   * 它会**跳过 `pointer-events: none` 的元素** → 链接层是透明的 → 命中不到。
   *
   * → 手动遍历 `.scpdf-link`，用 `getBoundingClientRect()` 判断坐标是否落在里面。
   *   （链接数量不多，一页几十个 → O(n) 完全够用。）
   */
  const findLinkAtPoint = useCallback((clientX: number, clientY: number) => {
    const links = document.querySelectorAll<HTMLElement>('.scpdf-link');
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return link;
      }
    }
    return null;
  }, []);

  /**
   * **容器上的链接点击委托**。
   *
   * ⚠️ 为什么需要事件委托（而不是在 `<a>` 上绑 onClick）：
   *
   * 链接层整体是 `pointer-events: none`（pdf.js v6 的做法），
   * 否则链接矩形会"盖住"文本层 → 从链接上拖选 → **选区完全出不来**。
   *
   * → 在容器上监听 `click`，按**点击坐标**去命中链接矩形。
   * → 拖动时根本不触发 `click` → 文本层正常选区 ✅
   */
  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!onExternalLink && !onInternalLink) {
        return;
      }

      const target = event.target as HTMLElement | null;

      /*
       * ⚠️ **必须按坐标命中**，不能只看 `event.target`。
       *
       * 链接层是 `pointer-events: none` → 点击的 target 是**文本层**，
       * 不是链接元素 → 只看 target 永远命中不了链接。
       *
       * ⚠️ `document.elementFromPoint()` 也不行 ——
       *    它同样会**跳过 `pointer-events: none` 的元素** → 还是命中不到。
       *
       * → 手动遍历链接矩形，按**坐标**判断命中。
       */
      const linkEl =
        findLinkAtPoint(event.clientX, event.clientY) ?? target?.closest?.('[data-link-id]');

      if (!linkEl) {
        return;
      }

      /*
       * ⚠️ **但如果这次点击是"选区的结果"，就不当链接处理**。
       *
       * 拖选结束时浏览器也会触发 `click`（target 是文本层），
       * 如果那时正好点在链接上 → 会误开链接。
       */
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        return;
      }

      const pageEl = linkEl.closest('.scpdf-page');
      const pageNumber = Number(pageEl?.getAttribute('data-page-number'));
      const url = linkEl.getAttribute('data-link-url');
      const destRaw = linkEl.getAttribute('data-link-dest');

      event.preventDefault();
      event.stopPropagation();

      if (url) {
        onExternalLink?.(url);
        return;
      }
      if (destRaw) {
        try {
          const dest = JSON.parse(destRaw) as unknown[];
          onInternalLink?.(dest, Number.isFinite(pageNumber) ? pageNumber : 1);
        } catch {
          // 解析失败 → 忽略（不抛给宿主）
        }
      }
    },
    [onExternalLink, onInternalLink, findLinkAtPoint],
  );

  /**
   * **按坐标找高亮元素**。
   *
   * ⚠️ 高亮块是 `pointer-events: none`（不能挡文字选择）
   * → 点击的 `event.target` 是**文本层**，不是高亮元素
   * → 必须像链接一样**按坐标命中**。
   *
   * @param clientX 视口 X
   * @param clientY 视口 Y
   * @returns 命中的高亮元素；没命中返回 null
   */
  const findHighlightAtPoint = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const elements = container.querySelectorAll<HTMLElement>('[data-highlight-id]');
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return el;
      }
    }
    return null;
  }, []);

  /**
   * 每页的**字形框表**（用来把选区裁剪成贴合文字）。
   *
   * ⚠️ 为什么需要：
   * 浏览器的选区矩形 = **字体的自然行盒**（比文字高 11px、偏上 6px）
   * → 选区框跟文字对不齐（"定位不准 / 偏了"）。
   *
   * ⚠️⚠️ **字形框 = span 的盒子**，不是字体的自然行盒！
   *
   * 实测（真实 PDF）：
   * ```
   * fontSize               = 20.62px   ← span 的 font-size
   * fontBoundingBoxAscent  = 22px      ← 字体的自然上伸（比 fontSize 大！）
   * fontBoundingBoxDescent = 5px       ← 字体的自然下伸
   * 自然行盒                = 27px      ← 浏览器用它画选区矩形（偏高）
   * span 的实际盒子          = 20.62px  ← font-size × line-height(1)
   * ```
   *
   * → 用**基线 + ascent/descent** 推算会偏（基线位置取决于字体的自然 ascent）
   * → 直接用 **`item.top`（= span 的 top）和 `item.fontSize`（= span 的盒高）**
   *   → 实测 `item.top` 与渲染后的 `span.getBoundingClientRect().top` **完全相等** ✅
   */
  const baselinesByPage = useMemo<BaselinesByPage>(() => {
    const result: BaselinesByPage = new Map();

    for (const [pageNumber, items] of textItemsByPage) {
      const list: PageBaselines[] = [];

      /*
       * ⚠️⚠️ **必须换算到"页内坐标"**（实测踩过的坑）。
       *
       * `item.top` / `item.left` 是**视口坐标**（= span 的 `getBoundingClientRect()`）
       * 而 `clipToBaseline` 拿到的是**页内坐标**（相对页元素）
       * → 两个空间差了一整个容器的偏移 → **裁剪到错误的行**！
       *
       * 实测（真实 PDF，跨多行拖选）：
       * ```
       * 原生选区: top=372, 521, 555
       * 画出来的:  y=238（← 页面标题那一行！）, 381, 385, 419
       * ```
       * → 用户看到的现象就是"**中间有的行没有底色**"（多画了标题行，
       *    真正选中的行反而没画上 / 画错位置）。
       *
       * → 换算：`item.top - 页的视口 top` = 页内 y。
       */
      /*
       * ⚠️⚠️ **基线表保持"视口坐标"**（不要在这里换算）。
       *
       * 换算要等到 `buildSelectionShapes` 里做 —— 因为那里才知道
       * **页的视口位置**（页在滚动内容里的位置 + 容器的视口位置 - 滚动量）。
       *
       * → 在这里换算的话，滚动一变就得重算整张表（滚动很频繁）→ 性能差。
       */
      for (const item of items) {
        if (item.text.length === 0 || item.fontSize <= 0) {
          continue;
        }

        list.push({
          // 字形框的上边缘 = span 的 top（**视口坐标**）
          top: item.top,
          // 字形框的高度 = span 的盒高 = fontSize（line-height: 1）
          height: item.fontSize,
          // 基线（匹配用）：top + ascent
          baseline: item.top + item.fontSize * measureAscentRatio(item.fontFamily),
          // 水平范围（匹配用）：用来挑"矩形真正盖住的那几个 item"
          left: item.left,
          width: item.width,
        });
      }
      result.set(pageNumber, list);
    }

    return result;
  }, [textItemsByPage]);

  const handleSelectionClientRects = useCallback(
    (rects: { top: number; left: number; width: number; height: number }[]) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();

      const shapes = buildSelectionShapes(
        rects,
        pageSizes.map((size, index) => ({
          pageNumber: index + 1,
          top: pageTops[index] ?? 0,
          // ⚠️ **不能用 0**（页是居中的，见 `pageLeft` 的注释）
          left: pageLeft,
          width: size.width,
          height: size.height,
        })),
        { top: containerRect.top, left: containerRect.left },
        container.scrollTop,
        // 把选区裁剪成贴合字形（对齐文本层）
        baselinesByPage,
      );

      setSelectionShapes(() => {
        const next = new Map<number, PageSelectionShape>();
        for (const shape of shapes) {
          next.set(shape.pageNumber, shape);
        }
        return next;
      });
    },
    [pageSizes, pageTops, baselinesByPage, pageLeft],
  );

  /*
   * ⚠️⚠️ **基线表变化 → 重算选区形状**（实测踩过的坑）。
   *
   * 缩放后文本层是**异步**重建的 → 基线表会在选区形状算完之后才更新
   * → 形状是用**旧缩放**的基线裁出来的 → 位置不对（实测 Δtop = 16.48px）。
   *
   * → 基线表一变，就**重新采集**当前的 client rects + 用**新的基线**重算。
   *
   * ⚠️ **必须重新采集 rects，不能用缓存的**：
   *   缩放后浏览器选区的 rect **也变了**（文字位置变了）
   *   → 用旧的 rects + 新的基线 = 两个坐标系混用 → 还是不对。
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // 重新采集当前选区的 client rects
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    const range = selection.getRangeAt(0);
    const rects: { top: number; left: number; width: number; height: number }[] = [];
    for (const clientRect of range.getClientRects()) {
      if (clientRect.width > 0 && clientRect.height > 0) {
        rects.push({
          top: clientRect.top,
          left: clientRect.left,
          width: clientRect.width,
          height: clientRect.height,
        });
      }
    }
    if (rects.length === 0) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const shapes = buildSelectionShapes(
      rects,
      pageSizes.map((size, index) => ({
        pageNumber: index + 1,
        top: pageTops[index] ?? 0,
        left: pageLeft,
        width: size.width,
        height: size.height,
      })),
      { top: containerRect.top, left: containerRect.left },
      container.scrollTop,
      baselinesByPage,
    );
    setSelectionShapes(() => {
      const next = new Map<number, PageSelectionShape>();
      for (const shape of shapes) {
        next.set(shape.pageNumber, shape);
      }
      return next;
    });
  }, [baselinesByPage, pageSizes, pageTops, pageLeft]);

  /**
   * 选区变化 → 更新浮层状态 + 通知宿主。
   *
   * 浮层的锚点用**浏览器给的选区矩形**（视口坐标）→ 直接配 `position: fixed`。
   */
  const handleSelectionChange = useCallback(
    (selection: SelectionData | null) => {
      setCurrentSelection(selection);

      if (!selection || selection.text.trim().length === 0) {
        setPopoverOpen(false);
        setPopoverAnchor(null);
        /*
         * ⚠️ **选区清空时必须清掉自绘层**。
         *
         * 旧实现只设不清 → 旧选区的蓝色块**一直留在页面上**，
         * 和用户的高亮叠在一起（实测：取消选区后 `.scpdf-selection-layer` 仍=1）。
         */
        setSelectionShapes(new Map());
        onSelectionChange?.(selection);
        return;
      }

      // 用当前选区的 DOM 矩形做锚点
      const domSelection = window.getSelection();
      if (domSelection && domSelection.rangeCount > 0) {
        const rect = domSelection.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          setPopoverAnchor({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          });
          setPopoverOpen(true);
        }
      }

      onSelectionChange?.(selection);
    },
    [onSelectionChange],
  );

  // 6) 选区
  const textSelection = useTextSelection({
    containerRef,
    pageFrames: pageSizes.map((size, index) => ({
      pageNumber: index + 1,
      top: pageTops[index] ?? 0,
      // ⚠️ **不能用 0**（页是居中的，见 `pageLeft` 的注释）
      left: pageLeft,
      width: size.width,
      height: size.height,
    })),
    scale,
    /*
     * 参考尺寸 = **采集时的真实视口尺寸**。
     *
     * ⚠️ 之前这里硬编码 `595 * scale`（A4 宽度）→ 真实 PDF 可能是
     * Letter(612) / 其他尺寸 → NormRect 里的参考尺寸与实际不符
     * → 读回时 `viewport / norm.width` 的换算比例是错的 → 高亮位置飘。
     *
     * 用真实的页面尺寸（pageSizes 存的就是视口 px）。
     */
    reference: {
      width: pageSizes[0]?.width ?? 595 * scale,
      height: pageSizes[0]?.height ?? 842 * scale,
    },
    // 基线表（把选区裁剪成贴合字形）
    baselines: baselinesByPage,
    onSelectionChange: handleSelectionChange,
    onClientRects: handleSelectionClientRects,
  });

  /*
   * ⚠️⚠️ **文档切换 → 清掉所有"属于上一份文档"的内部状态**。
   *
   * 用户反馈："如果已经高亮或者选中了文字 切换文档的时候还是会展示在文档上"
   *
   * 实测（复现）：
   * ```
   * 高亮后:     annotations=1  selectionLayer=1  nativeSel=11  pages=18
   * 切换文档后: annotations=1  selectionLayer=1  nativeSel=11  pages=3   ← ❌ 全都还在
   * ```
   *
   * ### 为什么高亮也残留
   *
   * 高亮是**受控**的（`highlights` 是宿主的 prop）
   * → 宿主不换 `highlights`，包就一直渲染旧高亮 → **这是设计如此，不是 bug**。
   * → 但**选区**（自绘块 / 浮层 / 原生选区）是**包内部状态** → **必须清**。
   *
   * ⚠️ **依赖用 `documentId` + `file`**，不要用 `data`：
   *    `data` 是 `Uint8Array`，每次都是新引用 → 会误触发（每次重渲染都清一遍）。
   *
   * ⚠️⚠️ **依赖里不能用 `textSelection` 对象**！
   *    `useTextSelection` 每次渲染都返回**新对象** → 依赖永远变
   *    → effect 每次渲染都跑 → setState → 重渲染 → **无限循环**
   *    （实测报 "Maximum update depth exceeded"）。
   *    → 依赖**具体的函数**（它们是稳定的 useCallback）。
   */
  const { clearNativeSelection, clearState } = textSelection;

  useEffect(() => {
    // 浏览器原生选区
    clearNativeSelection();
    // 包内的选区状态（不通知宿主）
    clearState();
    // 自绘的蓝色选区块
    setSelectionShapes(new Map());
    // 浮层
    setPopoverOpen(false);
    setPopoverAnchor(null);
    setCurrentSelection(null);
    setHighlightPopover(null);
    // 激活的高亮（蓝框）
    setActiveHighlightId(null);
    // 搜索
    setSearchHits([]);
    /*
     * ⚠️ **必须用 `-1`**（"没有激活命中"），不能用 `0`。
     *
     * `activeSearchIndex` 是 **0-based** 的数组下标
     * → `0` 意味着"第 0 个命中是激活的" → 语义上不对（明明一个命中都没有）
     * → `-1` → `searchHits[-1]` 是 `undefined` → `activeSearchIndexOnPage` 返回 `null`
     * → **渲染上无差异**，但语义正确（宿主若在切换文档后立刻搜索，不会从 0 开始）。
     */
    setActiveSearchIndex(-1);
    setSearchOpen(false);
    // 滚动位置回到顶部
    // ⚠️ jsdom 里 `scrollTo` 不存在 → 要防御（否则 SSR / 单测直接崩）
    const container = containerRef.current;
    if (container && typeof container.scrollTo === 'function') {
      container.scrollTo({ top: 0 });
    }
    // ⚠️ `documentId` / `file` 只作为**触发器**（ biome 要求在体内引用）
    void documentId;
    void file;
  }, [documentId, file, clearNativeSelection, clearState]);

  /**
   * 卸载时清理定时器。
   */
  useEffect(
    () => () => {
      if (activeHighlightTimerRef.current !== 0) {
        window.clearTimeout(activeHighlightTimerRef.current);
        activeHighlightTimerRef.current = 0;
      }
    },
    [],
  );

  /**
   * 高亮完成后**清掉选区**。
   *
   * ⚠️ 为什么要清：
   * - 自绘选区层（蓝色块）会**叠在高亮上**（用户看到的"高亮区域叠加"）
   * - 浮层还开着，挡住文字
   *
   * ⚠️⚠️ **`removeAllRanges()` 的时机很重要**（实测踩过两次坑）。
   *
   * ### 坑 1：调了 → 下一次拖动完全选不中字
   *
   * 实测（真实 PDF，点了浮层里的"高亮"按钮后）：
   * - 调了 `removeAllRanges()` → 下一次拖动**完全选不中字**
   *   （mousedown + mouseup 都正常触发，但 **一个 selectionchange 都没有**）
   *   → 浏览器把"选区被程序改过"当成"用户正在操作选区"
   *   → 后续的拖动被浏览器吞掉。
   *
   * → 结论：**绝不能在 mousedown / click 处理器里调**。
   * → 但在**动作完成之后**（比如"高亮已保存"）调是安全的。
   *
   * ### 坑 2：不调 → 选区不清除（用户反馈"点了高亮之后无法取消选中状态"）
   *
   * 实测：
   * ```
   * 选中后:   nativeSelLen=11  selectionLayer=1  popover=true
   * 点高亮后: nativeSelLen=11  selectionLayer=1  popover=true   ← ❌ 全都没清
   * ```
   *
   * → 根因：`clearState()` 只清包内引用 → **浏览器原生选区还在**
   * → `selectionchange` 还会触发 → 浮层又被打开。
   *
   * ### 顺序也很重要
   *
   * **先清原生选区**（会触发 `selectionchange`）→ **再关浮层**。
   * 反过来的话，`selectionchange` 会在浮层关闭后又把它打开。
   */
  const clearSelectionAfterHighlight = useCallback(() => {
    // 1) 先清浏览器原生选区（会触发 selectionchange）
    textSelection.clearNativeSelection();
    // 2) 再清包内部状态（**不通知宿主** → 宿主刚显示的反馈不会被冲掉）
    textSelection.clearState();
    setSelectionShapes(new Map());
    setPopoverOpen(false);
    setPopoverAnchor(null);
    setCurrentSelection(null);
    // 3) 去掉高亮的"激活"蓝框（用户反馈的"一直都有外边框"）
    setActiveHighlightId(null);
  }, [textSelection]);

  /*
   * **命令式句柄**（宿主用 `ref` 拿）。
   *
   * ⚠️ 为什么需要：
   * 宿主自己实现 UI（比如工具栏插槽里的"高亮"按钮）时**绕过**了包的浮层动作
   * → 包不知道"高亮做完了" → **选区不会被清掉**
   * → 选区的蓝色块一直浮在高亮上（用户反馈"无法取消选中状态"）。
   *
   * → 宿主做完"消费选区"的操作后调 `ref.current.clearSelection()` 即可。
   */
  useImperativeHandle(
    ref,
    () => ({
      clearSelection: () => {
        textSelection.clearNativeSelection();
        textSelection.clearState();
        setSelectionShapes(new Map());
        setPopoverOpen(false);
        setPopoverAnchor(null);
        setCurrentSelection(null);
        setHighlightPopover(null);
        setActiveHighlightId(null);
      },
      /**
       * **宿主自己创建了高亮**（比如自己的工具栏按钮）→ 通知包。
       *
       * → 包会：① 调 `onHighlightCreate`（宿主存）② 清掉选区。
       *
       * ⚠️ **包内置的"高亮"按钮不要用这个**（它自己会走 `onHighlight`）
       *    → 两个都走 → 宿主保存两次。
       */
      createHighlight: (highlight: NewHighlight) => {
        onHighlightCreate?.(highlight);
        clearSelectionAfterHighlight();
        onHighlightCreated?.();
      },
      getCurrentPage: () => page,
      getNumPages: () => numPages,
      getPageSizesPt: () => pageSizesPt.map((size) => ({ ...size })),
      goToPage: (target: number) => scrollToPage(target),
    }),
    [
      textSelection,
      page,
      numPages,
      pageSizesPt,
      scrollToPage,
      onHighlightCreated,
      onHighlightCreate,
      clearSelectionAfterHighlight,
    ],
  );

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

  /**
   * 量一条高亮的**视口矩形**（浮层锚点用）。
   *
   * ⚠️ 高亮可能**跨多行**（每行一个 DOM 元素）→ 要取所有行的**并集**。
   *
   * @param highlight 高亮记录
   * @returns 视口矩形；找不到元素时返回 null
   */
  const measureHighlightRect = useCallback((highlight: HighlightRecord) => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const elements = container.querySelectorAll<HTMLElement>(
      `[data-highlight-id="${CSS.escape(highlight.id)}"]`,
    );
    if (elements.length === 0) {
      return null;
    }

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) {
        continue;
      }
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }

    if (left === Infinity) {
      return null;
    }
    return { left, top, right, bottom };
  }, []);

  /**
   * 点击高亮。
   *
   * ⚠️ **要清掉当前的浏览器选区**（用户反馈"点了高亮之后无法取消选中状态"）。
   *
   * 点了高亮块 → 用户的意思是"我要操作这个高亮"，不是"我还在选文字"
   * → 旧的原生选区还在 → 浮层还锚在旧选区上 → 看起来"选不掉"。
   *
   * ⚠️ **清原生选区用的是 `clearNativeSelection()`**（不是 `removeAllRanges()`）：
   * `removeAllRanges()` 会让浏览器进入"选区被程序改过"状态 → **后续再也选不中字**。
   * → `clearNativeSelection` 用 `collapseToStart()` + rAF + 归还焦点 → 安全。
   */
  const handleHighlightClick = useCallback(
    (highlight: HighlightRecord) => {
      // 清掉旧选区（原生 + 包内），避免"选不掉"
      textSelection.clearNativeSelection();
      textSelection.clearState();
      setSelectionShapes(new Map());
      setPopoverOpen(false);
      setPopoverAnchor(null);
      setCurrentSelection(null);

      setActiveHighlightId(highlight.id);
      onHighlightClick?.(highlight);

      /*
       * ⚠️ **在高亮的位置弹出操作条**（用户要求）。
       *
       * 锚点 = 高亮块的**视口矩形** → 复用 `SelectionPopover`（同一套样式）。
       *
       * ⚠️ 高亮块可能是**多行**（每行一个 DOM 元素）
       * → 要取所有行的**并集**，不能只取第一行。
       */
      const rect = measureHighlightRect(highlight);
      setHighlightPopover(rect ? { id: highlight.id, text: highlight.selectedText, rect } : null);

      /*
       * ⚠️ **蓝框 1.5s 后自动消失**（用户反馈"一直都有外边框"）。
       *
       * → 不是"永久激活"，而是"刚刚点了这条"的短暂反馈。
       */
      if (activeHighlightTimerRef.current !== 0) {
        window.clearTimeout(activeHighlightTimerRef.current);
      }
      activeHighlightTimerRef.current = window.setTimeout(() => {
        activeHighlightTimerRef.current = 0;
        setActiveHighlightId(null);
      }, 1500);
    },
    [onHighlightClick, textSelection, measureHighlightRect],
  );

  /**
   * **容器上的高亮点击委托**。
   *
   * ⚠️ 为什么需要事件委托（而不是在 `<button>` 上绑 onClick）：
   *
   * 高亮块必须 `pointer-events: none`
   * → 否则高亮块**盖住文字** → 用户在那一块**框选不了字**
   *   （实测：拖动起点落在 `BUTTON.scpdf-annotation` 上 → 选不中）。
   *
   * → 在容器上监听 `click`，按**坐标**命中高亮 → 和链接层一个套路。
   * → 拖动时不触发 `click` → 文本层正常选区 ✅
   */
  const handleHighlightContainerClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!onHighlightClick) {
        return;
      }

      /*
       * ⚠️ **如果这次点击是"选区的结果"，就不当点击高亮处理**。
       *
       * 拖选结束时浏览器也会触发 `click`（target 是文本层）
       * → 如果那时正好点在高亮上 → 会误触发高亮操作条。
       */
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const highlightEl =
        findHighlightAtPoint(event.clientX, event.clientY) ??
        target?.closest?.('[data-highlight-id]');
      if (!highlightEl) {
        return;
      }

      const id = highlightEl.getAttribute('data-highlight-id');
      if (!id) {
        return;
      }
      const highlight = highlights.find((h) => h.id === id);
      if (!highlight) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleHighlightClick(highlight);
    },
    [onHighlightClick, findHighlightAtPoint, highlights, handleHighlightClick],
  );

  /**
   * 选区浮层的**内置动作**。
   *
   * ⚠️ **"翻译/提问/笔记/解释"默认是隐藏的**：
   * 只有宿主传了对应的回调才显示（`when` 返回 false → 不渲染）。
   * 这就是"宿主没配就不展示"的实现。
   */
  const builtinActions = useMemo<SelectionAction[]>(() => {
    const actions: SelectionAction[] = [
      {
        key: BUILTIN_ACTION_KEYS.highlight,
        icon: 'highlight',
        label: '高亮',
        group: 'primary',
        order: 10,
        onSelect: (ctx) => {
          /*
           * ⚠️ **只调 `onHighlight`**（不要同时调 `onHighlightCreate`）。
           *
           * ### 为什么
           *
           * `onHighlight` = 选区浮层里的"高亮"动作 → 宿主决定要不要存。
           * `onHighlightCreate` = **宿主自己**的按钮创建了高亮后通知包。
           *
           * 两个都调 → 宿主**保存两次**（实测：点一次高亮 → 生成了 3 条）。
           *
           * → 包自己清选区（不用宿主再通知一次）。
           */
          onHighlight?.({ ...ctx, color: pickedColor ?? undefined });
          // 包自己清选区（"清选区"是 UI 行为，属于包）
          clearSelectionAfterHighlight();
        },
      },
      {
        key: BUILTIN_ACTION_KEYS.copy,
        icon: 'copy',
        label: '复制',
        group: 'primary',
        order: 20,
        onSelect: (ctx) => {
          if (onCopy) {
            onCopy(ctx);
            return;
          }
          // 内置实现：写剪贴板（失败不打扰用户）
          void navigator.clipboard?.writeText(ctx.text).catch(() => undefined);
        },
      },
    ];

    // 宿主实现了才显示
    if (onTranslate) {
      actions.push({
        key: BUILTIN_ACTION_KEYS.translate,
        icon: 'translate',
        label: '翻译',
        group: 'ai',
        order: 30,
        onSelect: onTranslate,
      });
    }

    if (onAsk) {
      actions.push({
        key: BUILTIN_ACTION_KEYS.ask,
        icon: 'ask',
        label: '提问',
        group: 'ai',
        order: 40,
        onSelect: onAsk,
      });
    }

    if (onExplain) {
      actions.push({
        key: BUILTIN_ACTION_KEYS.explain,
        icon: 'explain',
        label: '解释',
        group: 'ai',
        order: 50,
        onSelect: onExplain,
      });
    }

    if (onNote) {
      actions.push({
        key: BUILTIN_ACTION_KEYS.note,
        icon: 'note',
        label: '笔记',
        group: 'ai',
        order: 60,
        onSelect: onNote,
      });
    }

    return actions;
  }, [
    onCopy,
    onTranslate,
    onAsk,
    onExplain,
    onNote,
    pickedColor,
    /*
     * ⚠️ **内置的"高亮"按钮只调 `onHighlight`**（不要同时调 `onHighlightCreate`）。
     *
     * → 宿主在 `onHighlight` 里存一次 → 不会重复保存。
     */
    onHighlight,
    clearSelectionAfterHighlight,
  ]);

  /** 合并后的动作列表（宿主覆盖 + 追加） */
  const popoverActions = useMemo(
    () => mergeSelectionActions(builtinActions, selectionActions),
    [builtinActions, selectionActions],
  );

  /**
   * 内置动作的"高亮"要带颜色 → 用一个 state 记录当前选的颜色。
   * 颜色下拉选完 → 直接触发高亮。
   */

  /** 关闭浮层 */
  const handlePopoverClose = useCallback(() => {
    setPopoverOpen(false);
    setPopoverAnchor(null);
  }, []);

  /**
   * **彻底取消选区**（Esc 用）。
   *
   * ⚠️ 为什么不能只关浮层（实测踩过的坑）：
   *
   * ```
   * 首次 mouseup: ["SPAN.scpdf-text-layer__item"]
   * Esc 后 mouseup: []          ← ❌ 浏览器**一个 mouseup 都不发**
   * ```
   *
   * → Esc 只关浮层 → 浏览器仍认为"用户在操作选区"
   * → 之后的拖动**收不到 mouseup** → 选区不再更新 → **浮层再也不出现**。
   *
   * → Esc = "取消这次选择" → 连选区一起清掉。
   */
  const handlePopoverDismiss = useCallback(() => {
    textSelection.clearNativeSelection();
    textSelection.clearState();
    setSelectionShapes(new Map());
    setPopoverOpen(false);
    setPopoverAnchor(null);
    setCurrentSelection(null);
  }, [textSelection]);

  /** 选颜色 → 立刻用该颜色高亮 */
  const handlePickHighlightColor = useCallback(
    (key: string) => {
      setPickedColor(key);

      if (!currentSelection) {
        return;
      }

      /*
       * ⚠️ **走 `onHighlight`**（和"高亮"主按钮**同一个**回调）。
       *
       * → 宿主只在一个地方存高亮 → 不会重复保存。
       */
      onHighlight?.({
        text: currentSelection.text,
        position: currentSelection.norm,
        event: undefined as never,
        color: key,
      });

      // 高亮完成后清掉选区
      clearSelectionAfterHighlight();
      handlePopoverClose();
    },
    [currentSelection, onHighlight, handlePopoverClose, clearSelectionAfterHighlight],
  );

  /**
   * 浮层的容器矩形（视口坐标）—— PDF 的可视区。
   *
   * 用 state 而不是 ref：容器位置会随滚动/缩放变化，
   * 浮层要跟着 clamp → 需要重渲染。
   */
  const [popoverContainerRect, setPopoverContainerRect] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  // 滚动 / 缩放 / 尺寸变化时更新容器矩形；并**隐藏浮层**（位置已失效）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // 依赖 scale：缩放会改变容器可视区 → 重新量
    void scale;

    const update = () => {
      const rect = container.getBoundingClientRect();
      setPopoverContainerRect({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    };

    update();

    /*
     * ⚠️ **滚动时浮层跟随**（用户明确要求：方案 A）。
     *
     * 旧实现：滚动时 `setPopoverOpen(false)` → 浮层**直接消失**。
     * 实测：滚动 120px 后浮层 `top=null`（是被卸载，不是隐藏）。
     *
     * 现在：浮层自己在 `useLayoutEffect` 里**实时**读 DOM 选区算位置
     *      → 滚动时它会自然地跟着选区走 → 这里**不需要做任何事**。
     *
     * ⚠️ `update` 只更新**容器矩形**（可视区）—— 用于 clamp。
     *    容器矩形在滚动时**不变**（滚动的是内容，不是容器），
     *    所以监听 scroll 是为了应对"容器自身位置变化"的情况。
     */
    container.addEventListener('scroll', update, { passive: true });

    if (typeof ResizeObserver === 'undefined') {
      return () => container.removeEventListener('scroll', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [scale]);

  /** 浮层动作被点击 */
  const handlePopoverAction = useCallback(
    (action: SelectionAction) => {
      if (!currentSelection) {
        return;
      }

      action.onSelect?.({
        text: currentSelection.text,
        position: currentSelection.norm,
        event: undefined as never,
        /*
         * ⚠️ **给宿主一个"我做完了"的回调**。
         *
         * 宿主自己实现高亮（不走包的内置动作）时，
         * 存完之后调它 → 包清选区（否则蓝色选区块一直浮着）。
         */
        done: clearSelectionAfterHighlight,
      });

      // 高亮后关闭；其他动作保留浮层（宿主可能要连续操作）
      if (action.key === BUILTIN_ACTION_KEYS.highlight) {
        handlePopoverClose();
      }
    },
    [currentSelection, handlePopoverClose, clearSelectionAfterHighlight],
  );

  /*
   * ---------------- 高亮块操作条 ----------------
   */

  /** 找一条高亮的归一化位置（换色时回传用） */
  const findHighlightPosition = useCallback(
    (id: string): NormPosition | undefined => {
      const found = highlights.find((h) => h.id === id);
      return found?.position;
    },
    [highlights],
  );

  /** 高亮浮层：关闭 */
  const handleHighlightPopoverClose = useCallback(() => {
    setHighlightPopover(null);
  }, []);

  /**
   * **高亮浮层的锚点要跟着滚动 / 缩放走**（实测踩过的坑）。
   *
   * ⚠️ 浮层的"实时校正"（`SelectionPopover` 的 100ms 轮询）在
   *    **"外部锚点"模式下是跳过的**（它只认 DOM 选区）
   * → 如果锚点只在点击时算一次 → **滚动一下浮层就飘了**。
   *
   * → 这里自己重算：滚动 / 缩放 / 换页 → 重新量高亮的 DOM 矩形。
   */
  useEffect(() => {
    if (!highlightPopover) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let raf = 0;
    const remeasure = () => {
      raf = 0;
      const highlight = highlights.find((h) => h.id === highlightPopover.id);
      const rect = highlight ? measureHighlightRect(highlight) : null;
      // 只在真的变了才 setState（避免每次滚动都重渲染）
      const prev = highlightPopover.rect;
      const same =
        prev === rect ||
        (prev !== null &&
          rect !== null &&
          Math.abs(prev.left - rect.left) < 0.5 &&
          Math.abs(prev.top - rect.top) < 0.5 &&
          Math.abs(prev.right - rect.right) < 0.5 &&
          Math.abs(prev.bottom - rect.bottom) < 0.5);
      if (!same) {
        setHighlightPopover((current) => (current ? { ...current, rect } : current));
      }
    };

    const onScroll = () => {
      if (raf === 0) {
        raf = requestAnimationFrame(remeasure);
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    // 缩放 / 换页 → 位置也变
    window.addEventListener('resize', onScroll);

    return () => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [highlightPopover, highlights, measureHighlightRect]);

  /**
   * 高亮浮层的**动作列表**。
   *
   * ⚠️ **规则和选区浮层一致**：宿主没传回调 ⇒ 对应按钮不渲染。
   * - 换色 → 需要 `onHighlightColorChange`（或 `onHighlightUpdate`）
   * - 删除 → 需要 `onHighlightRemove`
   * - 更多 → 需要 `onHighlightMore`
   */
  const highlightPopoverActions = useMemo<SelectionAction[]>(() => {
    if (!highlightPopover) {
      return [];
    }
    return buildHighlightActions(highlightPopover.id, highlightPopover.text, {
      onHighlightUpdate: (id, patch) => {
        if (patch.color) {
          onHighlightColorChange?.(id, patch.color);
          return;
        }
        const position = findHighlightPosition(id);
        if (!position) {
          return;
        }
        const current = highlights.find((h) => h.id === id);
        onHighlightUpdate?.(id, {
          selectedText: highlightPopover.text,
          position,
          color: current?.color ?? 'label-6',
        });
      },
      onHighlightRemove: onHighlightRemove ? (id) => onHighlightRemove?.(id) : undefined,
      onHighlightCopy: onHighlightCopy,
      onHighlightMore,
    });
  }, [
    highlightPopover,
    onHighlightColorChange,
    onHighlightUpdate,
    onHighlightRemove,
    onHighlightCopy,
    onHighlightMore,
    highlights.find,
    findHighlightPosition,
  ]);

  /** 高亮浮层：点动作 */
  const handleHighlightPopoverAction = useCallback(
    (action: SelectionAction) => {
      if (!highlightPopover) {
        return;
      }
      action.onSelect?.({
        text: highlightPopover.text,
        position: findHighlightPosition(highlightPopover.id) ?? null,
        event: undefined as never,
      });
      // 换色 / 删除后关闭；复制保留（可能还要连续操作）
      if (
        action.key === HIGHLIGHT_ACTION_KEYS.remove ||
        action.key === HIGHLIGHT_ACTION_KEYS.color
      ) {
        handleHighlightPopoverClose();
      }
    },
    [highlightPopover, findHighlightPosition, handleHighlightPopoverClose],
  );

  /** 高亮浮层：选颜色 → 换色 */
  const handleHighlightColorPick = useCallback(
    (key: string) => {
      if (!highlightPopover) {
        return;
      }
      onHighlightColorChange?.(highlightPopover.id, key);
      // 也可以用通用的 `onHighlightUpdate`（宿主自己决定怎么改）
      handleHighlightPopoverClose();
    },
    [
      highlightPopover,
      onHighlightColorChange, // 也可以用通用的 `onHighlightUpdate`（宿主自己决定怎么改）
      handleHighlightPopoverClose,
    ],
  );

  /**
   * 搜索命中变化（回调给 SearchPanel）。
   *
   * ⚠️ **必须是稳定的引用**（useCallback）：
   * SearchPanel 的搜索 effect 依赖它 → 每次渲染都换引用会导致
   * **反复重搜**并把 activeIndex 重置为 0 → 点"下一个"没反应。
   */
  const handleSearchHitsChange = useCallback((hits: SearchHit[]) => {
    setSearchHits(hits);
  }, []);

  /** 搜索面板关闭 */
  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    // 关闭时清掉高亮
    setSearchHits([]);
  }, []);

  /**
   * 搜索命中 → 高亮矩形。
   *
   * 流程：
   * 1. `SearchPanel` 搜出 `SearchHit[]`（字符偏移）
   * 2. 需要把偏移转成矩形 → 需要该页的**文本项**（与索引同一份）
   * 3. 文本项 → 归一化矩形 → `AnnotationLayer` 渲染
   *
   * ⚠️ **索引与渲染必须用同一份 items**：
   * 索引文本 = `items.map(i => i.str).join('')`，
   * 所以渲染用的 items 顺序必须与索引时完全一致。
   * 包从 `Page` 的文本层拿 items（`Page` 渲染时用的是宿主的 getTextContent）。
   */
  const searchRectsByPage = useMemo(() => {
    if (searchHits.length === 0) {
      return new Map<number, SearchHitRect[]>();
    }

    return hitsToRects(searchHits, textItemsByPage, pageSizesByPage);
  }, [searchHits, textItemsByPage, pageSizesByPage]);

  /**
   * 滚到搜索命中（精确到命中所在的行）。
   *
   * 只跳到页首是不够的 —— 命中可能在页面的第 3 行中间。
   * 所以用命中矩形的 y 坐标算精确滚动位置。
   */
  const scrollToSearchHit = useCallback(
    (hit: SearchHit) => {
      const rects = searchRectsByPage.get(hit.pageNumber);
      const container = containerRef.current;

      if (!rects || !container || rects.length === 0) {
        scrollToPage(hit.pageNumber);
        return;
      }

      // 第一个命中的矩形
      const rect = rects[0];
      if (!rect) {
        scrollToPage(hit.pageNumber);
        return;
      }

      // 页面在文档中的顶边
      const pageTop = pageTops[hit.pageNumber - 1] ?? 0;
      // 命中在页内的 y（px）
      const hitY = rect.y * (pageSizes[hit.pageNumber - 1]?.height ?? 0);
      // 留 100px 余量，让命中在视口上部可见
      const target = pageTop + hitY - 100;

      container.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
    },
    [searchRectsByPage, pageTops, pageSizes, scrollToPage],
  );

  /**
   * 跳到搜索命中。
   *
   * ⚠️ **必须是稳定的引用**（见 handleSearchHitsChange 的说明）。
   */
  const handleSearchNavigate = useCallback(
    (hit: SearchHit, index: number) => {
      setActiveSearchIndex(index);
      scrollToSearchHit(hit);
    },
    [scrollToSearchHit],
  );

  /**
   * 每页的**视口偏移**（页元素相对视口的位置）。
   *
   * ⚠️ **必须单独存成 state** → 缩放 / 滚动 / 面板开合都会变
   * → 基线表要跟着重算（换算到页内坐标）。
   */
  const [_pageOffsets, _setPageOffsets] = useState<Map<number, { top: number; left: number }>>(
    new Map(),
  );

  /** 收到某页的文本项（搜索高亮 + 选区基线表用） */
  /**
   * 页面渲染失败 → 抛给宿主。
   *
   * ⚠️⚠️ **必须是稳定的引用**（实测的性能坑）。
   *
   * 之前是 inline 箭头函数：
   * ```tsx
   * onRenderError={(err, page) => { onError?.(...); }}   // ❌ 每次渲染都是新函数
   * ```
   * → `PageCanvas` 的 `useEffect` 依赖它 → **每次渲染都重跑**
   * → **canvas 被重新渲染**（`drawImage` 占 CPU 的 18%！）
   * → 拖动选区时每一步都在重画 PDF → **明显卡顿**。
   *
   * → 提成 `useCallback` → 引用稳定 → 只在 `page` / `scale` 变化时才重画。
   */
  const handlePageRenderError = useCallback(
    (renderError: unknown, failedPage: number) => {
      onError?.(
        pdfViewerError('E_RENDER_PAGE', {
          cause: renderError,
          pageNumber: failedPage,
        }),
      );
    },
    [onError],
  );

  const handleTextItems = useCallback((pageNumber: number, items: PositionedTextItem[]) => {
    setTextItemsByPage((prev) => {
      const existing = prev.get(pageNumber);

      /*
       * ⚠️ **不能用"数量相同"当"没变"的判据**（曾经踩过）。
       *
       * 缩放时 item 的**数量不变**，但**几何全变了**（left/top/fontSize 随缩放变）
       * → 只比数量 → 缩放后不更新 → **基线表停留在旧缩放级别**
       * → 选区裁剪用错基线 → **选区消失 / 位置跑偏**（用户实测反馈）。
       *
       * → 必须比**几何**：取第一个 item 的 left/top/fontSize 做指纹。
       *   （够用：缩放一定会改这些值；而文字内容变化会改数量。）
       */
      if (existing && existing.length === items.length) {
        /*
         * 指纹：**取几个分布开的 item** 比几何。
         *
         * ⚠️ 不能只比 `existing[0]`：
         *    第一个 item 常常是**空白**（" "）或页眉，
         *    它的 left/top 在缩放时**可能不变**（比如刚好在 0 处）
         *    → 指纹相同 → 跳过更新 → **基线表停留在旧缩放** ❌
         *
         * → 比 3 个位置（第 1 / 中间 / 最后）的 item。
         */
        const indices = [0, Math.floor(items.length / 2), items.length - 1];
        const same = indices.every((index) => {
          const a = existing[index];
          const b = items[index];
          return (
            a !== undefined &&
            b !== undefined &&
            a.left === b.left &&
            a.top === b.top &&
            a.fontSize === b.fontSize &&
            a.text === b.text
          );
        });
        if (same) {
          return prev;
        }
      }

      const next = new Map(prev);
      next.set(pageNumber, items);
      return next;
    });
  }, []);

  /**
   * 当前激活的搜索命中在某页的矩形下标（页内）。
   *
   * ⚠️ 一个命中可能产生**多个矩形**（跨 item / 跨行），
   * 所以不能简单地"数前面有几个命中"——必须按**矩形**数。
   *
   * @param pageNumber 页码
   * @returns 页内下标；该页没有激活命中时返回 null
   */
  const activeSearchIndexOnPage = useCallback(
    (pageNumber: number): number | null => {
      const hit = searchHits[activeSearchIndex];
      if (!hit || hit.pageNumber !== pageNumber) {
        return null;
      }

      // 累加"该页在 activeSearchIndex 之前的所有命中"产生的矩形数
      let pageOffset = 0;
      for (let i = 0; i < activeSearchIndex; i += 1) {
        const earlier = searchHits[i];
        if (!earlier || earlier.pageNumber !== pageNumber) {
          continue;
        }
        const earlierRects = hitsToRects([earlier], textItemsByPage, pageSizesByPage).get(
          pageNumber,
        );
        pageOffset += earlierRects?.length ?? 0;
      }

      return pageOffset;
    },
    [searchHits, activeSearchIndex, textItemsByPage, pageSizesByPage],
  );

  const className = [
    'scpdf-root',
    // ⚠️ 主题 + 外观 → class 名（见 `core/theme` 的 `themeClasses`）
    ...themeClasses(theme, appearance),
    // ⚠️ "只打印原 PDF"模式（不带高亮）
    printMode === 'original' ? 'scpdf-root--print-original' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /*
   * ⚠️ **任意值的外观配置走内联 CSS 变量**（见 `core/theme` 的 `appearanceStyles`）。
   *
   * - `pageRadius`（任意数值）→ class 表达不了（只能特判 0）
   * - `accentColor` / `fontFamily` / `fontSize`（任意值）→ 同理
   *
   * → 走 CSS 变量 → 覆盖主题，不影响其他层。
   */
  const appearanceStyle = appearanceStyles(appearance);

  return (
    <div className={className} style={appearanceStyle} data-testid="pdf-viewer">
      {/*
        插槽 `toolbar`（方案 D）：宿主给了就**整个替换**内置工具栏。

        ⚠️ 替换后包**不再渲染**缩放 / 搜索 / 打印等按钮
        → 宿主自己接 `viewerRef`（`zoomIn` / `zoomOut` / `print` …）。
      */}
      {slots?.toolbar !== undefined ? (
        (slots.toolbar as React.ReactNode)
      ) : (
        <Toolbar
          toolbar={{
            ...toolbar,
            /*
             * ⚠️ **`appearance` 的结构开关覆盖 `toolbar` 的配置**。
             *
             * 优先级：`appearance` > `toolbar`（appearance 更"上层"）。
             * → 宿主用 `appearance` 统一控制，用 `toolbar` 做细调。
             */
            showSearch: appearance?.showSearch ?? toolbar?.showSearch,
            showThumbnails: appearance?.showThumbnails ?? toolbar?.showThumbnails,
            showOutline: appearance?.showOutline ?? toolbar?.showOutline,
          }}
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
          onPrint={features.print === false ? undefined : printDocument}
        />
      )}

      {children}

      {searchOpen ? (
        <SearchPanel
          search={searchEngine ?? null}
          onClose={handleSearchClose}
          onHitsChange={handleSearchHitsChange}
          onNavigate={handleSearchNavigate}
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
        {/*
          插槽 `panel`（方案 D）：宿主给了就**整个替换**内置侧栏。

          ⚠️ 替换后包**不再渲染**缩略图 / 目录面板
          → 宿主自己实现（可以用 `viewerRef` 拿页数、当前页）。
        */}
        {slots?.panel !== undefined ? (
          (slots.panel as React.ReactNode)
        ) : (
          <>
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
          </>
        )}

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
          /*
           * ⚠️ 链接 / 高亮的点击都走**事件委托**
           *（这两层都是 `pointer-events: none`，否则会挡住文字选择）。
           * 见 `handleContainerClick` / `handleHighlightContainerClick` 的说明。
           *
           * `onKeyDown` 满足 a11y 规则（有 click 就要有键盘等价操作）：
           * 链接元素自己已经处理了 Enter/Space，这里只需要不阻断冒泡。
           */
          onClick={(event) => {
            handleHighlightContainerClick(event);
            handleContainerClick(event);
          }}
          onKeyDown={(event) => {
            // 链接元素自己处理 Enter/Space；这里只阻止空格滚动页面
            if (event.key === ' ') {
              event.preventDefault();
            }
          }}
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
                  {isVisible || textLayerPages.has(pageNumber) ? (
                    <Page
                      pageNumber={pageNumber}
                      page={pageProxies.get(pageNumber) ?? null}
                      scale={scale}
                      size={size}
                      pageSizePt={pageSizesPt[index]}
                      renderCanvas={isVisible}
                      annotations={annotations.get(pageNumber) ?? null}
                      searchRects={searchRectsByPage.get(pageNumber)}
                      activeSearchRectIndex={activeSearchIndexOnPage(pageNumber)}
                      highlights={highlights}
                      activeHighlightId={activeHighlightId}
                      palette={highlightPalette}
                      selectionShape={selectionShapes.get(pageNumber)}
                      onHighlightClick={handleHighlightClick}
                      onExternalLink={onExternalLink}
                      onInternalLink={onInternalLink}
                      onTextItems={handleTextItems}
                      ariaLabel={t('a11y.page', { page: pageNumber })}
                      onRenderError={handlePageRenderError}
                    />
                  ) : null}

                  {/*
                    插槽 `pageOverlay`（方案 D）：盖在页上的任意内容。

                    ⚠️ **每页都渲染一次** → 宿主可以在里面做"页内批注 / 印章"之类。
                    → 传函数则按页号调用（能拿到当前页）。
                  */}
                  {slots?.pageOverlay !== undefined
                    ? typeof slots.pageOverlay === 'function'
                      ? (slots.pageOverlay as (pageNumber: number) => React.ReactNode)(pageNumber)
                      : (slots.pageOverlay as React.ReactNode)
                    : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/*
        选区浮层（选中文字后出现的小工具条）。

        ⚠️ 用 `createPortal` 挂到 `document.body`：
        浮层是 `position: fixed` → 不受任何祖先的 transform/overflow 影响。
      */}
      <SelectionPopover
        open={popoverOpen}
        selectionRect={popoverAnchor}
        containerRect={popoverContainerRect}
        anchorVersion={anchorVersion}
        actions={popoverActions}
        onAction={handlePopoverAction}
        onClose={handlePopoverClose}
        onDismiss={handlePopoverDismiss}
        highlightPalette={highlightPalette}
        onPickColor={handlePickHighlightColor}
      />

      {/*
        **高亮块操作条**（点了高亮之后出现）。

        ⚠️ **复用选区浮层的样式**（用户要求"复用选区浮层样式，只换锚点"）
        → 同一个 `SelectionPopover` 组件，只是：
        - 锚点用 `anchorRect`（高亮块的视口矩形）→ 不读浏览器选区
        - 动作是"高亮动作"（换色 / 复制 / 删除 / 更多）
      */}
      <SelectionPopover
        open={highlightPopover !== null}
        selectionRect={null}
        anchorRect={highlightPopover?.rect ?? null}
        containerRect={popoverContainerRect}
        actions={highlightPopoverActions}
        onAction={handleHighlightPopoverAction}
        onClose={handleHighlightPopoverClose}
        highlightPalette={highlightPalette}
        onPickColor={handleHighlightColorPick}
      />

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
