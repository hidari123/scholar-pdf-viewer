/**
 * 缩略图 —— 核心逻辑（纯函数，可单测）。
 *
 * 为什么单独放 core：
 * - "哪些页要生成缩略图 / 什么时候生成 / 缓存多久" 是**策略**，
 *   与 React 无关，且是最容易出错的地方（乱生成会把内存吃光）
 * - 策略错了 = 用户滚一下缩略图面板，内存涨几百 MB
 */

/** 缩略图规格 */
export interface ThumbnailSpec {
  /** 缩略图宽度（px） */
  width: number;
  /** 缩略图高度（px） */
  height: number;
  /** 渲染用的缩放比（= width / 页面宽度 pt） */
  scale: number;
}

/**
 * 计算缩略图规格。
 *
 * @param pageWidth 页面宽度（pt）
 * @param pageHeight 页面高度（pt）
 * @param targetWidth 目标宽度（px）
 * @returns 规格（scale 用于 pdf.js 渲染）
 */
export function thumbnailSpec(
  pageWidth: number,
  pageHeight: number,
  targetWidth: number,
): ThumbnailSpec {
  if (pageWidth <= 0 || pageHeight <= 0 || targetWidth <= 0) {
    return { width: 0, height: 0, scale: 1 };
  }

  const scale = targetWidth / pageWidth;

  return {
    width: Math.round(targetWidth),
    height: Math.round(pageHeight * scale),
    scale,
  };
}

/**
 * 决定要生成哪些缩略图（**懒生成 + 窗口化**）。
 *
 * 策略：
 * - 只生成可视区域附近的页（前后各 buffer 页）
 * - 已经在缓存里的页不重复生成
 * - 一次最多生成 batchSize 个（避免一次占满主线程）
 *
 * @param options 参数
 */
export interface ThumbnailPlanOptions {
  /** 总页数 */
  totalPages: number;
  /** 可视区域内的页（1-based） */
  visiblePages: number[];
  /** 已生成缩略图的页 */
  cachedPages: number[];
  /** 缓冲页数（默认 2） */
  bufferPages?: number;
  /** 本次最多生成几个（默认 4） */
  batchSize?: number;
}

/** 缩略图生成计划 */
export interface ThumbnailPlan {
  /** 本次要生成的页（1-based） */
  toRender: number[];
  /** 已缓存的页（跳过） */
  skipped: number[];
}

/**
 * 制定缩略图生成计划。
 *
 * @param options 参数
 * @returns 计划
 */
export function planThumbnails(options: ThumbnailPlanOptions): ThumbnailPlan {
  const { totalPages, visiblePages, cachedPages, bufferPages = 2, batchSize = 4 } = options;

  if (totalPages <= 0 || visiblePages.length === 0) {
    return { toRender: [], skipped: [] };
  }

  const cached = new Set(cachedPages);

  /** 需要生成的页（含缓冲） */
  const wanted = new Set<number>();
  for (const page of visiblePages) {
    for (let offset = -bufferPages; offset <= bufferPages; offset += 1) {
      const target = page + offset;
      if (target >= 1 && target <= totalPages) {
        wanted.add(target);
      }
    }
  }

  /** 按页码排序（先生成靠前的，视觉上更自然） */
  const sorted = [...wanted].sort((a, b) => a - b);

  const toRender: number[] = [];
  const skipped: number[] = [];

  for (const page of sorted) {
    if (cached.has(page)) {
      skipped.push(page);
      continue;
    }
    if (toRender.length >= batchSize) {
      continue;
    }
    toRender.push(page);
  }

  return { toRender, skipped };
}

/**
 * 缩略图缓存（LRU + 数量上限）。
 *
 * 为什么要有上限：500 页文档的缩略图（每张 200×260 RGBA）≈ 100MB+，
 * 不限制会直接把浏览器标签页吃崩。
 *
 * @param maxEntries 最大缓存条数
 */
export class ThumbnailCache {
  /** 缓存：页码 → 缩略图数据 */
  private readonly cache = new Map<number, string>();

  /** 最大条数 */
  private readonly limit: number;

  /** 命中次数 */
  private hits = 0;

  /** 未命中次数 */
  private misses = 0;

  constructor(maxEntries = 100) {
    this.limit = Math.max(1, maxEntries);
  }

  /**
   * 取缩略图。
   *
   * @param pageNumber 页码
   * @returns 缩略图数据（不存在则 undefined）
   */
  get(pageNumber: number): string | undefined {
    const value = this.cache.get(pageNumber);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }

    this.hits += 1;

    // LRU：命中后移到末尾（Map 保持插入序）
    this.cache.delete(pageNumber);
    this.cache.set(pageNumber, value);

    return value;
  }

  /**
   * 存缩略图。
   *
   * @param pageNumber 页码
   * @param data 缩略图数据
   */
  set(pageNumber: number, data: string): void {
    if (this.cache.has(pageNumber)) {
      this.cache.delete(pageNumber);
    }
    this.cache.set(pageNumber, data);

    // 超出上限 → 淘汰最久未用的（Map 的第一个）
    while (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        break;
      }
      this.cache.delete(oldest.value);
    }
  }

  /** 已有缩略图的页码列表 */
  pages(): number[] {
    return [...this.cache.keys()];
  }

  /** 当前缓存条数 */
  get size(): number {
    return this.cache.size;
  }

  /** 最大条数（复制缓存时要保留） */
  get maxEntries(): number {
    return this.limit;
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** 缓存统计 */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
