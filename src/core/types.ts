/**
 * @scholar-club/pdf-viewer —— 公共类型模型（single source of truth）
 *
 * 坐标三空间约定：
 * - PDF 点（72dpi，原点左下，y 轴向上）—— 后端 BboxData 使用
 * - 归一化坐标（页面比例 0–1，wire 兼容格式）—— 后端 ScaledPosition 使用
 * - 视口 px（当前缩放、页面内坐标）—— 渲染层使用
 */

/** 页码，1-based */
export type PageNumber = number;

/** 视口像素矩形（当前缩放级别下的页面内坐标） */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber: PageNumber;
}

/**
 * 页面归一化矩形 —— wire 兼容格式（与现有后端 ScaledPosition.Scaled 同构）：
 * x1/y1/x2/y2 为采集时刻的视口 px 值，width/height 为采集时的参考页面尺寸，
 * 比例 = 坐标 / 参考尺寸 ∈ [0,1]。与后端既有数据零转换往返。
 */
export interface NormRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 采集时参考页面宽度 */
  width: number;
  /** 采集时参考页面高度 */
  height: number;
  pageNumber: PageNumber;
}

/** 视口坐标位置（一组矩形 + 包围盒） */
export interface ViewPosition {
  boundingRect: ViewRect;
  rects: ViewRect[];
  pageNumber: PageNumber;
}

/** 归一化位置（用于持久化） */
export interface NormPosition {
  boundingRect: NormRect;
  rects: NormRect[];
  pageNumber: PageNumber;
}

/** PDF 坐标 bbox：[x1, y1, x2, y2]，72dpi 点，原点左下、y 向上（后端格式） */
export type BboxCoord = [number, number, number, number];

/** AI bbox 数据 —— 沿用现有后端 wire 格式，包内零转换 */
export interface BboxData {
  /** 多个 bbox（PDF 点） */
  bbox: BboxCoord[];
  /** 每个 bbox 对应的页码，0-based（后端格式） */
  page_info: number[];
  index_num: number;
}

/**
 * pdf.js PageViewport 最小形状（依赖注入，便于单测）。
 * 提供 convertToViewportRectangle / convertToPdfPoint 时使用其换算（支持旋转），
 * 否则使用纯数学回退（仅 rotation = 0）。
 */
export interface PdfViewportLike {
  width: number;
  height: number;
  scale: number;
  convertToViewportRectangle?(pdfRectangle: number[]): number[];
  convertToPdfPoint?(x: number, y: number): number[];
}

/** 页面尺寸（PDF 点） */
export interface PageSize {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/** 包内统一高亮/笔记模型（渲染 + 事件用） */
export interface HighlightRecord {
  /** = 现有 noteuuid */
  id: string;
  /** 色板 key，如 'label-6' */
  color: string;
  selectedText: string;
  position: NormPosition;
  /** 现有 myNotes / othersNotes 的合并表达 */
  source: "my" | "others";
  authorName?: string;
  /** 富文本 JSON 字符串：后端 wire 原样透传，包内不解析 */
  context?: string;
  /** 仅展示数字（点赞/评论交互留宿主业务） */
  likeNum?: number;
  commentNum?: number;
  isPrivate?: boolean;
  createdAt?: number;
  updatedAt?: number;
  /** 业务透传字段（包内不读） */
  meta?: Record<string, unknown>;
}

/** 新建/更新高亮的数据 */
export interface NewHighlight {
  color: string;
  selectedText: string;
  position: NormPosition;
  context?: string;
  meta?: Record<string, unknown>;
}

/** 选区统一输出 */
export interface SelectionData {
  text: string;
  /** 当前缩放下的渲染矩形（已合并优化） */
  rects: ViewRect[];
  /** 持久化用（后端格式） */
  norm: NormPosition;
  /** 1-based，跨页时多个 */
  pages: PageNumber[];
  /** 弹层锚点 */
  anchor: { pageNumber: PageNumber; rect: ViewRect };
}

/** 文档信息 */
export interface PdfDocInfo {
  numPages: number;
  title?: string;
  author?: string;
  creator?: string;
}

/** 缓存事件 */
export interface CacheEvent {
  type: "hit" | "miss" | "save" | "evict" | "error";
  url: string;
  size?: number;
  error?: unknown;
}

/** 查看器错误（code 表见方案 §8） */
export interface PdfViewerError {
  code:
    | "E_LOAD_HTTP"
    | "E_LOAD_NETWORK"
    | "E_PDF_INVALID"
    | "E_EMPTY"
    | "E_PDF_ENCRYPTED"
    | "E_PDF_PASSWORD_WRONG"
    | "E_RENDER_PAGE"
    | "E_LINK_INVALID"
    | "E_CACHE_QUOTA";
  message: string;
  cause?: unknown;
  pageNumber?: PageNumber;
}

/**
 * 高亮/笔记持久化适配器（宿主接后端 API；包内零业务）。
 * 主项目实现见其 `src/adapters/pdf-storage.ts`（noteClub API → 本接口）。
 */
export interface StorageAdapter {
  load(docId: string): Promise<HighlightRecord[]>;
  create(docId: string, h: NewHighlight): Promise<void>;
  update(docId: string, h: NewHighlight): Promise<void>;
  /** withNote：整条笔记（含内容）删除 vs 仅移除高亮色 */
  remove(docId: string, id: string, opts?: { withNote?: boolean }): Promise<void>;
}

/** 选区弹层动作（宿主注册 Explain/Note/Ask/Translate/Delete/高亮） */
export interface PopoverAction {
  id: string;
  label: string;
  labelI18nKey?: string;
  onSelect(sel: SelectionData, ctx: ActionContext): void | Promise<void>;
  /** 如 delete 仅在命中已有高亮时显示 */
  showWhen?(sel: SelectionData): boolean;
  /** 高亮动作（带色板） */
  color?: boolean;
}

/** 弹层动作上下文 */
export interface ActionContext {
  /** 命中已有高亮（点选高亮再弹层的编辑模式） */
  existingHighlight: HighlightRecord | null;
  /** 关闭弹层 */
  cancel(): void;
}
