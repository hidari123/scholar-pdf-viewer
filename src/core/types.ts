/**
 * core 公共类型 —— 包的数据模型（全部是 PDF 几何或通用状态，**无任何后端业务字段**）。
 *
 * 边界约束（方案 §2.4）：本文件不得出现 noteuuid / contentType / isPrivate / likeNum /
 * commentNum / API 路径 / 登录态 等后端业务字段 —— 包要能换个后端直接用。
 */

/** 页码，1-based */
export type PageNumber = number;

/** 视口像素矩形（当前缩放下的页面内坐标） */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber: PageNumber;
}

/**
 * 页面归一化矩形 —— **缩放无关**的坐标结构。
 *
 * x1..y2 为采集时刻的视口 px，width/height 为采集时的参考尺寸；
 * 读回时按 `当前视口尺寸 / 参考尺寸` 线性映射 → 同一份数据在任何缩放下落点相同。
 */
export interface NormRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 采集时参考尺寸（宽） */
  width: number;
  /** 采集时参考尺寸（高） */
  height: number;
  pageNumber: PageNumber;
}

/** 归一化位置（持久化用） */
export interface NormPosition {
  boundingRect: NormRect;
  rects: NormRect[];
  pageNumber: PageNumber;
}

/** 视口位置（渲染用） */
export interface ViewPosition {
  boundingRect: ViewRect;
  rects: ViewRect[];
  pageNumber: PageNumber;
}

/** PDF 点坐标 bbox：[x1, y1, x2, y2]（72dpi，原点左下、y 向上） */
export type BboxCoord = [number, number, number, number];

/**
 * pdf.js PageViewport 最小形状（依赖注入，便于单测）。
 * 提供 convertToViewportRectangle / convertToPdfPoint 时由 pdf.js 保证旋转正确；
 * 否则仅 rotation=0 时可用纯数学回退。
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

/**
 * 包内统一高亮模型（渲染 + 事件用）。
 *
 * 全部字段都是中立的：`id` 由宿主给（包内不解释语义）、`color` 是语义色 key、
 * `position` 是归一化几何、`source` 只用于区分"我的/他人"的视觉底色。
 */
export interface HighlightRecord {
  /** 宿主 id（包内不解释语义、不假设它来自哪个字段） */
  id: string;
  /** 语义色 key，如 'label-6'（宿主可映射到自己的色板） */
  color: string;
  /** 选中的文本 */
  selectedText: string;
  /** 位置（归一化，缩放无关） */
  position: NormPosition;
  /** 来源：仅用于视觉区分（我的 / 他人高亮底色不同） */
  source?: 'my' | 'others';
  /** 创建时间戳 */
  createdAt?: number;
  /** 更新时间戳 */
  updatedAt?: number;
}

/** 新建/更新高亮的数据 */
export interface NewHighlight {
  color: string;
  selectedText: string;
  position: NormPosition;
}

/** 选区统一输出（**纯几何**，宿主拿它去干什么是宿主的事） */
export interface SelectionData {
  /** 选中的文本 */
  text: string;
  /** 当前缩放下的渲染矩形（已合并优化） */
  rects: ViewRect[];
  /** 持久化用（归一化，缩放无关） */
  norm: NormPosition;
  /** 涉及页（1-based，跨页时多个） */
  pages: PageNumber[];
  /** 定位锚点 */
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
  type: 'hit' | 'miss' | 'save' | 'evict' | 'error';
  /** 缓存键（URL 或宿主 documentId） */
  url: string;
  /** 字节数 */
  size?: number;
  error?: unknown;
}
