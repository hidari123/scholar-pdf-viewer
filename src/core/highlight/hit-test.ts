/**
 * highlight —— **重叠高亮的命中判定**。
 *
 * ## 用户需求
 *
 * > "如果两个高亮叠加在一起 删除的话两个都一起删掉了 逻辑不对
 * >  比如说 a和b有部分重叠了，如果是全部重叠 则不能进行再次高亮，
 * >  各种操作还是在原有高亮进行，如果部分重叠，重叠部分为c，
 * > 点击a独有部分，则选中a，点击b独有部分则选中b，
 * > 选中重叠部分c则谁在上面选中的是谁。"
 *
 * ## 场景
 *
 * ```
 *        aaaaaaa
 *      bbbbbbbbbbb      ← a 和 b **部分重叠**（重叠部分 = c）
 * ```
 *
 * ### 期望行为
 *
 * | 点击位置 | 选中谁 |
 * |---|---|
 * | a 的独有部分 | **a** |
 * | b 的独有部分 | **b** |
 * | 重叠部分 c | **在上面那个**（后渲染的 = z-index 高的） |
 *
 * ### 完全重叠
 *
 * ```
 * aaaaaaa
 * aaaaaaa    ← 完全重合
 * ```
 *
 * → **不能进行再次高亮**（各种操作还是在原有高亮进行）
 * → 也就是说：完全重叠时，**下面的那个永远选不到** ✅
 */

/** 一个高亮的矩形（视口 px） */
export interface HighlightRect {
  /** 高亮 id */
  id: string;
  /** 左边界 */
  left: number;
  /** 上边界 */
  top: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /**
   * **层级**（越大越在上面）。
   *
   * → 渲染顺序（后面的在上面）→ 直接用数组下标 ✅
   */
  zIndex: number;
}

/** 命中判定的结果 */
export interface HighlightHit {
  /** 命中的高亮 id */
  id: string;
  /**
   * **是不是"重叠部分"**。
   *
   * → `false` = 点的位置只属于这一个高亮 ✅
   * → `true` = 点的位置**同时**属于多个高亮（重叠部分 c）⚠️
   */
  isOverlapping: boolean;
  /** 参与重叠的高亮 id 列表（`isOverlapping` 为 true 时有多个） */
  overlappingIds: string[];
}

/**
 * 判定一个点命中了哪些高亮。
 *
 * @param x 视口 X
 * @param y 视口 Y
 * @param rects 所有高亮的矩形
 * @returns 命中的高亮列表（**从上到下**）
 */
export function hitsAtPoint(x: number, y: number, rects: readonly HighlightRect[]): HighlightHit[] {
  const hit: HighlightHit[] = [];

  for (const rect of rects) {
    if (
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height
    ) {
      hit.push({ id: rect.id, isOverlapping: false, overlappingIds: [rect.id] });
    }
  }

  if (hit.length === 0) {
    return [];
  }

  // ⚠️ **重叠**（点在多个高亮里）
  if (hit.length > 1) {
    for (const h of hit) {
      h.isOverlapping = true;
      h.overlappingIds = hit.map((x2) => x2.id);
    }
  }

  // **从上到下**（zIndex 大的在上面）
  return hit.sort((a, b) => {
    const za = rects.find((r) => r.id === a.id)?.zIndex ?? 0;
    const zb = rects.find((r) => r.id === b.id)?.zIndex ?? 0;
    return zb - za;
  });
}

/**
 * **判定一个点该选中哪个高亮**。
 *
 * ## 规则（用户需求）
 *
 * 1. **只命中一个** → 选它 ✅
 * 2. **命中多个**（重叠部分 c）→ 选**最上面**的那个 ✅
 *    > "选中重叠部分c则谁在上面选中的是谁"
 * 3. **完全重叠**时 → 下面的选不到（因为总在上面那个赢）✅
 *    > "如果是全部重叠 则不能进行再次高亮，各种操作还是在原有高亮进行"
 *
 * @param x 视口 X
 * @param y 视口 Y
 * @param rects 所有高亮的矩形
 * @returns 该选中的高亮 id；没命中返回 `null`
 */
export function pickHighlightAtPoint(
  x: number,
  y: number,
  rects: readonly HighlightRect[],
): HighlightHit | null {
  const hits = hitsAtPoint(x, y, rects);
  // ⚠️ **第一个就是最上面的**（已排序）→ 重叠时选它 ✅
  return hits[0] ?? null;
}

/**
 * 判定两个高亮是否**完全重叠**。
 *
 * ⚠️ **用途**：完全重叠时**不允许再次高亮**（用户需求）。
 *
 * @param a 高亮 A 的矩形
 * @param b 高亮 B 的矩形
 * @param tolerance 容差（px）
 * @returns 完全重叠则 true
 */
export function isFullyOverlapping(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
  tolerance = 1,
): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/**
 * 判定两个高亮是否**部分重叠**。
 *
 * @param a 高亮 A 的矩形
 * @param b 高亮 B 的矩形
 * @returns 部分重叠则 true
 */
export function isPartiallyOverlapping(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  const ox = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const oy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  if (ox <= 0 || oy <= 0) {
    return false;
  }
  // 有交集但不是完全重合
  return !isFullyOverlapping(a, b);
}
