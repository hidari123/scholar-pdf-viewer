/**
 * **列识别**（双栏排版）。
 *
 * ## 要解决什么（用户反馈的真 bug）
 *
 * > "两栏的选中效果有误 会一次选中两栏 应该一次选中一栏"
 *
 * ### 实测数据（真实双栏论文  paper.pdf 第 3 页）
 *
 * **按基线中点做的直方图**：
 * ```
 *   50: ### (3)
 *  125: ## (2)
 *  150: ######################################## (40)   ← 左栏
 *  275: ###################### (22)                  ← 左栏尾部
 *  425: ###################################### (38)   ← 右栏
 * ```
 * -> **两个明显分开的簇**  -> 能分栏
 * -> **各页都成立**  （第 1/3/4/8 页实测）
 *
 * ## ❌ 为什么不能用【x 区间的空隙】
 *
 * 实测（PDF 原始坐标）：
 * ```
 * 第 3 页的空隙:
 *   0.0 - 35.0 pt   (左页边距)
 *   572.0 - 595.3 pt (右页边距)
 *   550.0 - 566.0 pt (页脚)
 * ```
 * -> **两栏之间【没有】空隙**
 * -> 因为**左栏的长单词会伸到 311pt**  而**右栏从 248pt 就开始**
 * -> -> **两栏的 x 范围是【重叠】的** ✅ -> 靠空隙分不开 ❌
 *
 * ## ❌ 为什么不能用【同一行的左右分栏】
 *
 * 实测：第 3 页只有 **5 / 120** 条基线是"左右都有文字"的
 * -> 因为**两栏的行【不在同一个 y】**
 *
 * ##  正确判据：**按基线中点聚类**
 *
 * -> 每条基线算一个**中点**  （x 区间的中心）
 * -> **同一栏的基线，中点会聚成一簇**
 *    -> 因为两栏都是**两端对齐**
 * -> -> **簇之间的空隙就是栏间的分界**
 */

/** 一条基线（一个 y 上的所有文字）*/
export interface BaselineInfo {
  /** 这条基线的 y*/
  top: number;
  /** 左边*/
  left: number;
  /** 右边*/
  right: number;
}

/** 一栏 */
export interface ColumnRange {
  /** 左边界*/
  left: number;
  /** 右边界*/
  right: number;
}

/** 直方图的桶宽（相对页宽的比例  和缩放无关）*/
const HISTOGRAM_BUCKET_RATIO = 0.042;

/** 一个簇最少要有多少条基线*/
export const MIN_BASELINES_PER_COLUMN = 5;

/** 两个簇之间要隔多远才算分开  （相对页宽）*/
export const MIN_COLUMN_SEPARATION_RATIO = 0.12;

/**
 * **算出这些基线属于哪几栏**
 *
 * @param baselines 这一页的所有基线
 * @param pageWidth 页宽（**和 baselines 同一个坐标系**）
 * @returns 栏（从左到右）；**没有分栏 -> 只有一栏**
 */
export function computeColumns(
  baselines: readonly BaselineInfo[],
  pageWidth: number,
): ColumnRange[] {
  if (baselines.length === 0 || pageWidth <= 0) {
    return [];
  }

  // ⚠️ **单栏的快速判断**
  const narrowest = Math.min(...baselines.map((b) => b.right - b.left));
  if (narrowest >= pageWidth * 0.6) {
    return [{ left: 0, right: pageWidth }];
  }

  // ⚠️ **按中点做直方图**
  const bucketWidth = pageWidth * HISTOGRAM_BUCKET_RATIO;
  const bucketCount = Math.max(1, Math.ceil(pageWidth / bucketWidth));
  const histogram = new Int32Array(bucketCount);

  for (const baseline of baselines) {
    const mid = (baseline.left + baseline.right) / 2;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(mid / bucketWidth)));
    histogram[index] = (histogram[index] ?? 0) + 1;
  }

  // ⚠️ **找连续的簇**
  const clusters: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < bucketCount; i++) {
    if ((histogram[i] ?? 0) > 0) {
      current.push(i);
    } else if (current.length > 0) {
      clusters.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    clusters.push(current);
  }

  // ⚠️ **只保留"够大"的簇**
  const major = clusters.filter((cluster) => {
    const count = cluster.reduce((sum, index) => sum + (histogram[index] ?? 0), 0);
    return count >= MIN_BASELINES_PER_COLUMN;
  });

  if (major.length <= 1) {
    return [{ left: 0, right: pageWidth }];
  }

  // ⚠️ **簇之间要隔得够远**
  const kept: number[][] = [];
  for (const cluster of major) {
    const previous = kept[kept.length - 1];
    if (!previous) {
      kept.push(cluster);
      continue;
    }
    const previousEnd = previous[previous.length - 1] ?? 0;
    const clusterStart = cluster[0] ?? 0;
    const separation = (clusterStart - previousEnd - 1) * bucketWidth;
    if (separation >= pageWidth * MIN_COLUMN_SEPARATION_RATIO) {
      kept.push(cluster);
    }
  }

  if (kept.length <= 1) {
    return [{ left: 0, right: pageWidth }];
  }

  // ⚠️ **算出每栏的左右边界**
  const columns: ColumnRange[] = [];
  for (const cluster of kept) {
    const first = cluster[0] ?? 0;
    const last = cluster[cluster.length - 1] ?? 0;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const baseline of baselines) {
      const mid = (baseline.left + baseline.right) / 2;
      const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(mid / bucketWidth)));
      if (index >= first && index <= last) {
        left = Math.min(left, baseline.left);
        right = Math.max(right, baseline.right);
      }
    }
    if (Number.isFinite(left) && Number.isFinite(right)) {
      columns.push({ left, right });
    }
  }

  return columns.length > 0 ? columns : [{ left: 0, right: pageWidth }];
}

/**
 * **某个 x 落在哪一栏**
 *
 * @param columns 栏
 * @param x 横坐标
 * @returns 栏的序号（找不到 -> -1）
 */
export function columnIndexAt(columns: readonly ColumnRange[], x: number): number {
  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];
    if (!column) {
      continue;
    }
    if (x >= column.left && x <= column.right) {
      return i;
    }
  }
  return -1;
}

/**
 * **矩形属于哪一栏**
 *
 * -> 用矩形的**中心点**判断
 *
 * @param columns 栏
 * @param rect 矩形（水平区间）
 * @returns 栏的序号（找不到 -> -1）
 */
export function columnOfRect(
  columns: readonly ColumnRange[],
  rect: { left: number; right: number },
): number {
  return columnIndexAt(columns, (rect.left + rect.right) / 2);
}
