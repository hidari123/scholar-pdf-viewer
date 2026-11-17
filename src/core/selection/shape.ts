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
 * 每页的**字形框表**（页内坐标）。
 *
 * ⚠️ **这里存的是"文字的盒子"，不是"字体的自然行盒"**：
 *
 * ```
 * fontSize               = 20.62px   ← span 的 font-size
 * fontBoundingBoxAscent  = 22px      ← 字体的自然上伸（比 fontSize 大！）
 * fontBoundingBoxDescent = 5px       ← 字体的自然下伸
 * 自然行盒                = 27px      ← 浏览器用它画选区矩形（偏高）
 * span 的实际盒子          = 20.62px  ← font-size × line-height(1)
 * ```
 *
 * → 选区要贴着**文字**，就该用 span 的盒子：`[item.top, item.top + fontSize]`。
 */
export interface PageBaselines {
  /** 字形框的上边缘（页内坐标，px） */
  top: number;
  /** 字形框的高度（px） */
  height: number;
  /** 该行文字的基线（页内坐标，px）—— 匹配/排序用 */
  baseline: number;
  /** 字形框的左边缘（页内坐标，px）—— 水平匹配用 */
  left: number;
  /** 字形框的宽度（px）—— 水平匹配用 */
  width: number;
}

/** 页码 → 字形框表 */
export type BaselinesByPage = Map<number, PageBaselines[]>;

/**
 * 用最近行的字形框把矩形裁剪成贴合文字。
 *
 * 找行的方式：取**基线最近**的那一行。
 *
 * 泛型：矩形可以是 `{x, y, width, height}`（页内坐标）
 * 或 `{left, top, width, height}`（视图坐标）—— 两者字段名不同。
 *
 * @param rect 选区矩形
 * @param baselines 该页的字形框表
 * @returns 裁剪后的矩形
 */
export function clipToBaseline<
  T extends PageSelectionRect | { left: number; top: number; width: number; height: number },
>(rect: T, baselines: readonly PageBaselines[]): T {
  const isXY = 'x' in rect;
  const top0 = isXY ? rect.y : rect.top;

  const center = top0 + rect.height / 2;

  /*
   * ⚠️ **按"基线距离"排序，逐个尝试**。
   *
   * 为什么不能只取最近的那一行：
   * 同一行里可能有**正文**（font-size 20.6）+ **上标**（font-size 16），
   * 它们的基线相差 ~9px，而浏览器的选区矩形是**一段连续的行盒**。
   *
   * 实测（真实 PDF）：
   * ```
   * 选区矩形   y=452.8 h=27      (452.8..479.8)
   * 上标 "*"   y=451.7 h=16      (451.7..467.7)  ← 基线更近
   * 正文       y=456.8 h=20.6    (456.8..477.4)  ← 才是正确的行
   * ```
   *
   * 只取最近的 → 选中上标 → 它的盒子**顶边（451.7）在选区矩形上方**
   * → "裁剪后必须完全在原矩形内"的保险把它**拒绝** → **不裁剪**
   * → 选区还是那个偏高的行盒 ❌
   *
   * → 排序后**依次尝试**，第一个"盒子完全落在矩形内"的胜出。
   */
  const rectLeft = isXY ? rect.x : rect.left;

  /*
   * ⚠️ **先按距离过滤，再按水平重叠排序**。
   *
   * 顺序不能反：
   * - 先排序再过滤 → `break` 的前提（按距离有序）被破坏
   * - 距离过滤的阈值要跟**候选自身的高度**比，不是跟 rect 的高度比
   *   （选区矩形可能比文字高很多 → 阈值太宽 → 匹配到别的行）
   */
  const maxDistance = Math.max(rect.height, ...baselines.map((c) => c.height)) * 2;

  const candidates = baselines
    .map((candidate) => ({
      candidate,
      distance: Math.abs(candidate.baseline - center),
      // 水平重叠
      overlap:
        candidate.width > 0
          ? Math.min(rectLeft + rect.width, candidate.left + candidate.width) -
            Math.max(rectLeft, candidate.left)
          : 0,
    }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => {
      /*
       * 排序：**先按"盒子中心离矩形中心多近"，再按水平重叠**。
       *
       * 理由：
       * - 选区矩形横跨一行时，真正对应的是它盖住的那几个 item
       *   （同一行可能混着正文 + 上标）→ 水平重叠要参与排序
       * - 但**垂直上**离得远的候选（插图里的旋转标签、
       *   上下相邻的行）必须先排掉 → 中心距离优先
       *
       * ⚠️ 之前只按水平重叠排 → 一个宽矩形会选到**上下相邻行**的 item
       *    → 选区框比文字低 18.88px（用户看到的"定位跑偏"）。
       */
      const aCenter = a.candidate.top + a.candidate.height / 2 - center;
      const bCenter = b.candidate.top + b.candidate.height / 2 - center;
      if (Math.abs(aCenter - bCenter) > 2) {
        return Math.abs(aCenter) - Math.abs(bCenter);
      }
      if (Math.abs(a.overlap - b.overlap) > 1) {
        return b.overlap - a.overlap;
      }
      return a.distance - b.distance;
    });

  for (const { candidate } of candidates) {
    const top = candidate.top;
    const bottom = candidate.top + candidate.height;

    /*
     * 保险：裁剪后必须**完全在原矩形内**，且**高度为正**。
     * 否则说明这一行不属于这个矩形（选到了别的行）→ 试下一行。
     *
     * ⚠️ **高度为 0 的行必须跳过**：
     *    后面的合并算法用矩形高度当异常判据的基准，
     *    一个 height=0 的矩形会让基准变成 0 → **所有矩形都被判为异常** → 选区消失。
     */
    if (top < top0 || bottom > top0 + rect.height || bottom <= top) {
      continue;
    }

    return {
      ...rect,
      ...(isXY ? { y: top } : { top }),
      height: bottom - top,
    } as T;
  }

  return rect;
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

    /*
     * ⚠️ **裁剪后高度可能变成 0**（基线刚好在矩形边界上）。
     *    这种矩形必须丢掉 —— 后面合并算法的"异常判据"基准会被它污染。
     */
    if (pageRect.height <= 0 || pageRect.width <= 0) {
      continue;
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
 * **截尾中位数**（trimmed median）：排序后丢掉上下各 25%，再取中位数。
 *
 * 为什么不用普通中位数：
 * - 矩形**很少**时（2-3 个），中位数会被那个离群值本身占据 → 判据失效
 *
 * 为什么不用平均数：
 * - 平均数会被离群值**拉偏** → 阈值过大 → 真正的异常值漏网
 *
 * 截尾中位数两种情况都扛得住：
 * - `[23, 830]` → 截尾后剩 `[23, 830]`（不够截）→ 取较小的一侧 → 23 ✅
 * - `[23, 23, 23, 830]` → 截掉最高 → `[23, 23, 23]` → 23 ✅
 *
 * @param sorted 升序排列的数组
 * @returns 稳健的"正常值"
 */
export function trimmedMedian(sorted: readonly number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0] ?? 0;
  }

  // 少于 4 个时，丢掉**最高**的那个（离群值只可能是高的）
  if (sorted.length < 4) {
    return sorted[0] ?? 0;
  }

  const trim = Math.floor(sorted.length / 4);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return trimmed[Math.floor(trimmed.length / 2)] ?? 0;
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
   * 判据：高度 > **正常高度 × 4** → 异常。
   *
   * ⚠️⚠️ **基准必须是"正常高度"，而且要能抗离群值**：
   *
   *    - 浏览器偶尔返回 **height=0 的矩形**（空白的行盒）。
   *      实测：255 个 rect 里混进一个 h=0 的 → 若用"最小高度"当基准
   *      → 阈值 = 0 → **254 个正常矩形全被判为异常** → **选区整个消失**！
   *      （用户截图里"框选后没有选区"就是这个 bug）
   *
   *    - 但也不能只用"中位数"：矩形**很少**时（比如只有 2-3 个），
   *      中位数会被那个巨型矩形本身占据 → 判据失效 → 巨型矩形漏网。
   *
   *    → 用**截尾中位数**（trimmed median）：
   *      排序后丢掉上下各 25%，再取中位数。
   *      少数离群值（中位数法）或极少数矩形（平均数法）都能扛住。
   */
  const valid = rects.filter((r) => r.height > 0 && r.width > 0);
  if (valid.length === 0) {
    return [];
  }

  const sortedHeights = valid.map((r) => r.height).sort((a, b) => a - b);
  const normalHeight = trimmedMedian(sortedHeights);
  const limit = normalHeight * 4;

  const normal = valid.filter((r) => r.height <= limit);

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
