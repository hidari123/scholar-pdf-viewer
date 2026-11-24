/**
 * visible —— 可见页计算（**几何法**，替代 IntersectionObserver）。
 *
 * ## 为什么不用 IntersectionObserver
 *
 * 原来的实现用 IO 判断"哪些页要渲染"，在真实 PDF 上会出**白屏**：
 * - IO 的 `rootMargin` 用**百分比**（`300%`），百分比相对 **root（滚动容器）**算，
 *   **不是**相对元素 → 缩放后页面变高，缓冲区实际覆盖的页数骤降
 * - 缩放时页占位元素的 `top` **全部突变** → IO 的 `isIntersecting` 不跨阈值
 *   → **IO 不重新触发** → `visiblePages` 停留在旧值 → 新进入视口的页没渲染 → 白屏
 *
 * ## 为什么几何法更可靠
 *
 * - **确定性**：给定 scrollTop + 缩放，结果唯一（IO 是异步、时序相关的）
 * - **缩放后立即正确**：不依赖 IO 的回调时机
 * - **可单测**：纯函数，给定输入给定输出
 *
 * 性能：500 页文档 = 500 次 `getBoundingClientRect()`，
 * rAF 节流后完全可接受（远快于一次布局抖动）。
 */

/** 一页的占位元素信息 */
export interface PageBox {
  /** 页码（1-based） */
  pageNumber: number;
  /** 元素的 top（相对滚动容器内容） */
  top: number;
  /** 元素的高度 */
  height: number;
}

/** 可见页计算参数 */
export interface ComputeVisiblePagesOptions {
  /** 滚动容器的 scrollTop */
  scrollTop: number;
  /** 滚动容器的可视高度 */
  viewportHeight: number;
  /** 所有页的占位信息（按页码升序） */
  pages: PageBox[];
  /** 缓冲区页数（可视页前后各扩几页） */
  bufferPages?: number;
}

/**
 * 计算要渲染的页。
 *
 * 算法：
 * 1. 找出与视口 `[scrollTop, scrollTop + viewportHeight]` 相交的页（**视口页**）
 * 2. 视口页前后各扩 `bufferPages` 页（**缓冲区**）
 * 3. 返回升序页码数组
 *
 * @param options 参数
 * @returns 要渲染的页（1-based，升序）
 */
export function computeVisiblePages(options: ComputeVisiblePagesOptions): number[] {
  const { scrollTop, viewportHeight, pages, bufferPages = 3 } = options;

  if (pages.length === 0 || viewportHeight <= 0) {
    return [];
  }

  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewportHeight;

  /** 视口内的页 */
  const viewportPages: number[] = [];
  for (const page of pages) {
    const pageBottom = page.top + page.height;
    // 相交（含边界）
    if (pageBottom > viewTop && page.top < viewBottom) {
      viewportPages.push(page.pageNumber);
    }
  }

  // 一页都没相交（容器高度异常 / 滚动位置越界）→ 兜底取最接近的一页
  if (viewportPages.length === 0) {
    let closest = pages[0];
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const page of pages) {
      const pageCenter = page.top + page.height / 2;
      const distance = Math.abs(pageCenter - (viewTop + viewportHeight / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = page;
      }
    }

    if (closest) {
      viewportPages.push(closest.pageNumber);
    }
  }

  /*
   * ⚠️ **总页数**（用来夹住缓冲区）✅
   *
   * -> `pages` 是**当前 DOM 里有的页** ✅
   * -> 但它可能**少于文档总页数** ✅（虚拟滚动：远处的页还没挂载 ❌）
   * -> -> 拿 `pages.length` 当上限会**算错** ❌
   */
  const maxPageNumber = Math.max(...pages.map((page) => page.pageNumber), 0);

  // 缓冲区扩展
  const withBuffer = new Set<number>();
  for (const pageNumber of viewportPages) {
    for (let offset = -bufferPages; offset <= bufferPages; offset += 1) {
      const target = pageNumber + offset;
      /*
       * ⚠️⚠️ **上下限都要夹**（审核发现的真 bug）✅
       *
       * -> 之前**只夹了下限**（`target >= 1`）❌
       * -> -> 滚到最后几页时，缓冲区会算出**越界的页码** ❌
       *    （实测：10 页的文档算出第 **11** 页 ❌）
       * -> -> 下游会去 `getPage(11)` ❌
       *    -> 严格的实现会**抛 "Invalid page request"** ❌
       *    -> 宽容的实现会**静默失败** ❌（页渲染不出来 ❌）
       */
      if (target >= 1 && target <= maxPageNumber) {
        withBuffer.add(target);
      }
    }
  }

  return [...withBuffer].sort((a, b) => a - b);
}

/**
 * 计算当前页（视口顶部那一页）。
 *
 * @param options 参数
 * @returns 当前页（1-based）；没有页时返回 1
 */
export function computeCurrentPage(options: { scrollTop: number; pages: PageBox[] }): number {
  const { scrollTop, pages } = options;

  if (pages.length === 0) {
    return 1;
  }

  // 页顶边不超过 scrollTop 的最后一页
  let current = pages[0];
  for (const page of pages) {
    if (page.top <= scrollTop) {
      current = page;
    } else {
      break;
    }
  }

  return current?.pageNumber ?? 1;
}
