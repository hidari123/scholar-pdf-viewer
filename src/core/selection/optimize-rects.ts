/**
 * 选区矩形合并 —— 移植主项目 `optimize-client-rects.ts`，修三处问题。
 *
 * 作用：把浏览器 `Range.getClientRects()` 产生的碎矩形（同一行被切成十几段）
 * 合并成"每行一条"，高亮看起来才是一条线而不是一串虚线。
 *
 * 移植时修的问题：
 * 1. **跨页排序是错的**：原实现 `top = (A.pageNumber||0) * A.top - (B.pageNumber||0) * B.top`
 *    —— 把页码与 top **相乘**再比较，跨页时毫无意义（页 2 的 top=5 与页 1 的 top=100
 *    算出 10 - 100 = -90 → 页 2 排到了页 1 前面）。改为显式三级比较 `(pageNumber, top, left)`
 * 2. **就地修改入参**：原实现直接改 `A.width` / `A.height` → 调用方传进来的数组被污染
 *    （"选区矩形莫名变了"这类幽灵 bug 的根源）。改为返回新对象，**输入不可变**
 * 3. **相同矩形不去重**：`inside()` 用严格 `>`，完全相同的两个矩形互不包含 → 都会保留
 *    → 同一段文字被画两遍。补上"相等即包含"
 */

import type { ViewRect } from '../types';

/** 基准误差（100% 缩放时的像素级误差） */
const BASE_Y_MARGIN = 5;

/** 排序：先页码，再 top，再 left（显式三级，不做任何算术组合） */
function sortRects(rects: ViewRect[]): ViewRect[] {
  return [...rects].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber;
    }
    if (a.top !== b.top) {
      return a.top - b.top;
    }
    return a.left - b.left;
  });
}

/** A 与 B 是否水平重叠（同页） */
function overlaps(a: ViewRect, b: ViewRect): boolean {
  return a.pageNumber === b.pageNumber && a.left <= b.left && b.left <= a.left + a.width;
}

/** A 与 B 是否同一行（允许垂直误差，避免像素级抖动误判） */
function sameLine(a: ViewRect, b: ViewRect, yMargin: number): boolean {
  return (
    a.pageNumber === b.pageNumber &&
    Math.abs(a.top - b.top) < yMargin &&
    Math.abs(a.height - b.height) < yMargin
  );
}

/** A 是否被 B 包含（含"完全相同"） */
function inside(a: ViewRect, b: ViewRect): boolean {
  if (a.pageNumber !== b.pageNumber) {
    return false;
  }

  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;

  // 相等即视为被包含（去重）；否则要求严格包含
  if (a.left === b.left && a.top === b.top && aRight === bRight && aBottom === bBottom) {
    return true;
  }

  return a.top >= b.top && a.left >= b.left && aBottom <= bBottom && aRight <= bRight;
}

/** A 与 B 是否相邻（水平间隔在容差内） */
function nextTo(a: ViewRect, b: ViewRect, xMargin: number): boolean {
  if (a.pageNumber !== b.pageNumber) {
    return false;
  }

  const aRight = a.left + a.width;
  const bRight = b.left + b.width;

  return a.left <= b.left && aRight <= bRight && b.left - aRight <= xMargin;
}

/**
 * 合并选区矩形：
 * 1. 去掉被完全包含的矩形（含重复项）
 * 2. 合并同行且重叠/相邻的矩形
 *
 * ⚠️⚠️ **性能**：这个函数在**每次 selectionchange** 都会跑（拖动时 30 步跑 15 次），
 *    而浏览器一次能返回 **几百个**矩形。
 *
 * 旧实现是**双重循环** → O(n²)：
 * - 第一步（去重）：n × n 次 `inside()`
 * - 第二步（合并）：n × n 次 `sameLine()` + `overlaps()`
 *
 * 实测 255 个矩形 → **65025 次比较** × 15 次/拖动 → 明显拖慢。
 *
 * → 改成：**先按"行"分桶，只在桶内比较**。
 *   1. 按 (pageNumber, 行号) 分桶（行号 = top / 行高）→ O(n)
 *   2. 每个桶内才做去重 + 合并（桶很小 → 平方代价可忽略）
 *
 * 效果：O(n²) → O(n + Σ 桶内²)，实测从 65025 次降到几百次。
 *
 * @param rects 原始矩形（**不会被修改**）
 * @param scaleFactor 当前缩放（误差容差按缩放放大）
 */
export function optimizeClientRects(rects: ViewRect[], scaleFactor = 1): ViewRect[] {
  if (rects.length === 0) {
    return [];
  }

  const sorted = sortRects(rects);
  const margin = BASE_Y_MARGIN * scaleFactor;

  /*
   * ⚠️ **按"行"分桶**（性能关键）。
   *
   * 旧实现是全量双重循环（O(n²)）→ 255 个矩形 = 65025 次比较。
   * → 先分桶，只在桶内比较 → 大幅减少比较次数。
   *
   * 分桶键：`(pageNumber, 行号)`。
   * 行号怎么算？→ 用**基准行高**（矩形高度的中位数）来量化 top，
   * 这样同一行的矩形（top 有几 px 抖动）会落进同一个桶。
   */
  const heights = sorted.map((r) => r.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 1;
  const bucketSize = Math.max(1, medianHeight);

  const buckets = new Map<string, ViewRect[]>();
  for (const rect of sorted) {
    const lineIndex = Math.round(rect.top / bucketSize);
    const key = `${rect.pageNumber}:${lineIndex}`;
    const list = buckets.get(key);
    if (list) {
      list.push(rect);
    } else {
      buckets.set(key, [rect]);
    }
  }

  const result: ViewRect[] = [];

  for (const bucket of buckets.values()) {
    /*
     * 第一步：过滤掉被包含的矩形（含完全重复的）
     *
     * 两个陷阱：
     * 1. 必须排除"和自己比"——矩形必然被自己包含，不排除会把所有矩形过滤光
     * 2. 重复项是**互相包含**的（a 包含 b、b 也包含 a）→ 只看"是否被包含"会把两个都删光。
     *    所以按**位置**判定：只有排在后面的那个，才可能被前面的那个包含 → 重复项留第一个
     */
    const firstPass = bucket.filter((rect, index) =>
      bucket.every((other, otherIndex) => {
        if (otherIndex >= index) {
          return true; // 只与排在前面的矩形比较
        }
        return !inside(rect, other);
      }),
    );

    // 第二步：合并同行且重叠/相邻的矩形
    // 结果用新对象，**不改 firstPass 里的原对象**（输入不可变）
    const merged = firstPass.map((rect) => ({ ...rect }));
    const removed = new Set<ViewRect>();

    for (const a of merged) {
      for (const b of merged) {
        if (a === b || removed.has(a) || removed.has(b)) {
          continue;
        }
        if (!sameLine(a, b, margin)) {
          continue;
        }

        if (overlaps(a, b)) {
          // 合并重叠：扩宽 + 取最大高度
          a.width = Math.max(b.width - a.left + b.left, a.width);
          a.height = Math.max(a.height, b.height);
          removed.add(b);
        } else if (nextTo(a, b, margin)) {
          // 合并相邻：只扩宽
          a.width = Math.max(b.width - a.left + b.left, a.width);
          removed.add(b);
        }
      }
    }

    for (const rect of merged) {
      if (!removed.has(rect)) {
        result.push(rect);
      }
    }
  }

  // 桶是按 key 插入的 → 结果顺序可能乱 → 重新排序（保持原有的输出顺序语义）
  return sortRects(result);
}

/** 计算一组矩形的包围盒 */
export function boundingRectOf(rects: ViewRect[]): ViewRect | null {
  if (rects.length === 0) {
    return null;
  }

  const first = rects[0];
  if (!first) {
    return null;
  }

  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;

  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    pageNumber: first.pageNumber,
  };
}
