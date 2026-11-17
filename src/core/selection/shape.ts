/**
 * 选区形状 —— 把浏览器的选区矩形变成可自绘的几何。
 *
 * **为什么要自绘**（而不是用原生 `::selection`）：
 *
 * 原生 `::selection` 的浏览器会**逐个 client rect** 画背景。
 * 而一行文字里常有两个**不同字号**的 span（正文 + 上标），
 * 它们各自形成一个行盒 → `getClientRects()` 返回**多个垂直重叠的矩形**
 * → 重叠区被**叠涂两次** → 半透明色叠两次 → **阶梯状深浅不一**。
 *
 * 实测（真实 PDF，230%，选 10 行）：
 * - 原生 `::selection`：8/10 行被涂 2 次 ❌
 * - 自绘（SVG clipPath）：每处只涂 1 次 ✅
 *
 * 这也是 pdf.js v6 的做法（`selectionRendering` 模式）：
 * 关掉原生 `::selection`，用 `getClientRects()` 算形状，
 * 画成 SVG `<clipPath>` → **每个像素只画一次**。
 */

/** 页内矩形（相对页面元素左上角） */
export interface PageSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一页的选区形状 */
export interface PageSelectionShape {
  pageNumber: number;
  rects: PageSelectionRect[];
}

/**
 * 每页的**基线表**（页内坐标）。
 *
 * 用途：把浏览器的选区矩形（= 字体自然行盒）裁剪成**贴合字形**的矩形。
 *
 * 每项：基线的 y + 字形的上/下距离。
 */
export interface PageBaselines {
  /** 基线的 y（页内坐标，px） */
  baseline: number;
  /** 字形顶相对基线的高度 */
  above: number;
  /** 字形底相对基线的深度 */
  below: number;
}

/** 页码 → 基线表 */
export type BaselinesByPage = Map<number, PageBaselines[]>;

/**
 * 用最近的基线把矩形裁剪成贴合字形。
 *
 * 找基线的方式：取**离矩形中心最近**的那条基线。
 *
 * @param rect 选区矩形（页内坐标）
 * @param baselines 该页的基线表
 * @returns 裁剪后的矩形
 */
/**
 * 用最近的基线把矩形裁剪成贴合字形。
 *
 * 找基线的方式：取**离矩形中心最近**的那条基线。
 *
 * 泛型：矩形可以是 `{x, y, width, height}`（页内坐标）
 * 或 `{left, top, width, height}`（视图坐标）—— 两者字段名不同。
 *
 * @param rect 选区矩形
 * @param baselines 该页的基线表
 * @returns 裁剪后的矩形
 */
export function clipToBaseline<
  T extends PageSelectionRect | { left: number; top: number; width: number; height: number },
>(rect: T, baselines: readonly PageBaselines[]): T {
  const isXY = 'x' in rect;
  const top0 = isXY ? rect.y : rect.top;

  const center = top0 + rect.height / 2;

  let best: PageBaselines | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of baselines) {
    const distance = Math.abs(candidate.baseline - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (!best) {
    return rect;
  }

  const top = best.baseline - best.above;
  const bottom = best.baseline + best.below;

  /*
   * 保险：裁剪后必须**完全在原矩形内**。
   * 否则说明这条基线不属于这一行（选中了别的行的文字）→ 退回原矩形。
   */
  if (top < top0 || bottom > top0 + rect.height) {
    return rect;
  }

  return {
    ...rect,
    ...(isXY ? { y: top } : { top }),
    height: bottom - top,
  } as T;
}

/**
 * 把浏览器的 client rects 分组成"每页一个形状"。
 *
 * @param rects 浏览器给的矩形（**视口坐标**）
 * @param pageBoxes 每页在容器里的位置与尺寸（容器坐标）
 * @param containerRect 容器在视口里的位置（视口坐标）
 * @param scrollTop 容器的滚动量
 * @returns 每页的选区形状（页内坐标）
 */
export function buildSelectionShapes(
  rects: readonly { top: number; left: number; width: number; height: number }[],
  pageBoxes: readonly {
    pageNumber: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }[],
  containerRect: { top: number; left: number },
  scrollTop: number,
  /**
   * 每页的**基线表**（用于把选区裁剪成贴合字形）。
   *
   * 不传 → 不裁剪（退回浏览器给的行盒高度）。
   */
  baselines?: BaselinesByPage,
): PageSelectionShape[] {
  /** 视口坐标 → 容器内容坐标 */
  const toContentX = (x: number) => x - containerRect.left;
  const toContentY = (y: number) => y - containerRect.top + scrollTop;

  /** 按页分组 */
  const byPage = new Map<number, PageSelectionRect[]>();

  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const contentLeft = toContentX(rect.left);
    const contentTop = toContentY(rect.top);

    // 中心点落在哪一页 → 归哪一页（O(页数)，页数不多）
    const centerX = contentLeft + rect.width / 2;
    const centerY = contentTop + rect.height / 2;

    let owner: (typeof pageBoxes)[number] | undefined;
    for (const box of pageBoxes) {
      if (
        centerX >= box.left &&
        centerX <= box.left + box.width &&
        centerY >= box.top &&
        centerY <= box.top + box.height
      ) {
        owner = box;
        break;
      }
    }

    if (!owner) {
      continue;
    }

    // 页内坐标（相对页面元素）
    let pageRect: PageSelectionRect = {
      x: contentLeft - owner.left,
      y: contentTop - owner.top,
      width: rect.width,
      height: rect.height,
    };

    /*
     * ⚠️ **把矩形裁剪成贴合字形**。
     *
     * 浏览器的选区矩形 = **字体的自然行盒**（比 span 的 box 高 11px、偏上 6px）
     * → 选区框跟文字对不齐（用户说的"定位不准 / 偏了"）。
     *
     * 裁剪方式：用**该行的基线** + 字形的 ascent/descent。
     */
    const pageBaselines = baselines?.get(owner.pageNumber);
    if (pageBaselines && pageBaselines.length > 0) {
      pageRect = clipToBaseline(pageRect, pageBaselines);
    }

    const list = byPage.get(owner.pageNumber) ?? [];
    list.push(pageRect);
    byPage.set(owner.pageNumber, list);
  }

  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, rectsForPage]) => ({ pageNumber, rects: rectsForPage }));
}

/**
 * 合并同一行内**完全重合**的矩形。
 *
 * 为什么需要：同一行里多个 span（正文 + 上标）会产出重叠的 rect，
 * 自绘时重叠部分会被画两次 → 又出现深浅不一。
 * → 合并成"每行的并集"，每个像素只画一次。
 *
 * 合并策略（纯几何，无依赖）：
 * 1. 按 top 排序
 * 2. 同组内取 left 的最小值、right 的最大值、top 的最小值、bottom 的最大值
 *
 * @param rects 矩形列表
 * @returns 合并后的矩形
 */
export function mergeOverlappingRects(rects: readonly PageSelectionRect[]): PageSelectionRect[] {
  if (rects.length === 0) {
    return [];
  }

  /*
   * ---- 0. 先剔除异常矩形（旋转文字等） ----
   *
   * 真实 PDF 实测：arXiv 页边戳是 `transform: rotate(-90deg)` 的竖排文字，
   * 浏览器给它的 rect 是 `h=829`（整页高）。
   * 旧实现只跟 `merged[last]` 比较 → 这个巨型矩形一旦垂直重叠到别的小矩形，
   * 合并后的矩形就长高，然后继续吸收 → **画出一大块**（图里的元素全变蓝块）。
   *
   * 判据：高度 > **最小高度 × 4** → 异常。
   *
   * ⚠️ **必须用"最小高度"当基准**，不能用中位数：
   *    当矩形很少时（比如只有 2 个），中位数会被那个巨型矩形本身占据
   *    → 判据失效 → 巨型矩形漏网。
   *    "最小高度"永远是正常文字行的高度 → 判据始终有效。
   */
  const minHeight = Math.min(...rects.map((r) => r.height));
  const limit = minHeight * 4;

  const normal = rects.filter((r) => r.height <= limit);

  if (normal.length === 0) {
    // 全是异常矩形 → 宁可漏画，也不要画出一大块
    return [];
  }

  // ---- 1. 按"视觉行"分组：垂直中心相近 → 同一行 ----
  const sorted = [...normal].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));

  const rows: PageSelectionRect[][] = [];
  for (const rect of sorted) {
    const center = rect.y + rect.height / 2;
    const row = rows[rows.length - 1];

    if (row) {
      const first = row[0];
      if (first) {
        const rowCenter = first.y + first.height / 2;
        const rowHeight = Math.max(...row.map((r) => r.height));
        if (Math.abs(center - rowCenter) <= Math.max(rowHeight, rect.height) / 2) {
          row.push(rect);
          continue;
        }
      }
    }

    rows.push([rect]);
  }

  // ---- 2. 组内按 x 排序，逐段合并（**只合并水平有重叠的**） ----
  /*
   * ⚠️ **不能把整行取并集** —— 同一行里可能有**互不相邻**的片段
   * （例：一行里 "Name*" / "Mingxun" / "Zhang*" 之间有空隙，
   *   或者选区只覆盖了行的左右两端）。
   * 取并集会把中间的空白也涂上 → **选区看起来比实际选的大**。
   *
   * 正确做法：按 x 排序，**逐段**合并"水平有重叠"的矩形，
   * 遇到有空隙就断开（产生多个矩形）。
   */
  const merged: PageSelectionRect[] = [];

  for (const row of rows) {
    const byX = [...row].sort((a, b) => a.x - b.x);

    let current: PageSelectionRect | null = null;

    for (const rect of byX) {
      if (!current) {
        current = { ...rect };
        continue;
      }

      const currentRight = current.x + current.width;
      const overlapX = Math.min(currentRight, rect.x + rect.width) - Math.max(current.x, rect.x);

      if (overlapX > 0) {
        // 有重叠 → 并进当前段
        const left = Math.min(current.x, rect.x);
        const right = Math.max(currentRight, rect.x + rect.width);
        const top = Math.min(current.y, rect.y);
        const bottom = Math.max(current.y + current.height, rect.y + rect.height);
        current = { x: left, y: top, width: right - left, height: bottom - top };
        continue;
      }

      // 有空隙 → 断开，另起一段
      merged.push(current);
      current = { ...rect };
    }

    if (current) {
      merged.push(current);
    }
  }

  return merged;
}
