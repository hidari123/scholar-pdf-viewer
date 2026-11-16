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
    const list = byPage.get(owner.pageNumber) ?? [];
    list.push({
      x: contentLeft - owner.left,
      y: contentTop - owner.top,
      width: rect.width,
      height: rect.height,
    });
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

  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);

  const merged: PageSelectionRect[] = [];

  for (const rect of sorted) {
    const last = merged[merged.length - 1];

    // 与上一个矩形**垂直重叠** → 同一行 → 合并
    if (last) {
      const lastBottom = last.y + last.height;
      const overlapY = Math.min(lastBottom, rect.y + rect.height) - Math.max(last.y, rect.y);
      const overlapX =
        Math.min(last.x + last.width, rect.x + rect.width) - Math.max(last.x, rect.x);

      if (overlapY > 0 && overlapX > 0) {
        const left = Math.min(last.x, rect.x);
        const right = Math.max(last.x + last.width, rect.x + rect.width);
        const top = Math.min(last.y, rect.y);
        const bottom = Math.max(lastBottom, rect.y + rect.height);

        merged[merged.length - 1] = {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        };
        continue;
      }
    }

    merged.push({ ...rect });
  }

  return merged;
}
