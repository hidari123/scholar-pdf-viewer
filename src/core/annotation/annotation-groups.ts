/**
 * **批注分组** —— 把"挤在一起"的批注合并成**一个图标**。
 *
 * ## 用户需求
 *
 * > "如果要批注的内容在同一行呢 别的软件是怎么处理的这个逻辑 你调研一下
 * >  目前这两个批注会叠在一起 我认为可以只出现一个图标 然后悬浮在图标上可以选择批注几"
 *
 * ## 调研：别的软件怎么做（Acrobat / WPS / Preview / Notion）
 *
 * | 软件            | 同一行的多个批注                       | 悬浮时               |
 * | --------------- | -------------------------------------- | -------------------- |
 * | Acrobat        | 叠在一起，点开是一列                   | 点开才展开           |
 * | WPS PDF        | 叠成一个，**带数字角标**               | **弹出列表**可选择   |
 * | macOS 预览      | 叠成一个，**带数字角标**               | 点开才展开           |
 * | Notion / Google Docs | 同一段的评论**合并成一个气泡**（带回复数） | 点开看全部       |
 *
 * → **共识**：**合并成一个图标 + 带数量角标 + 悬浮/点击能选具体哪条**
 *
 * ## 本实现的策略
 *
 * 1. **按锚点位置分组**：同一行（垂直重叠）且水平相距不远 → 一组
 * 2. **每组只渲染一个图标**，角标显示条数（`1` 条时不显示角标）
 * 3. **hover 图标 → 弹出选择列表**（"选择批注 N"）
 * 4. **点某一条 → 打开那张便利贴**
 *
 * ## 为什么放在 `core`
 *
 * → 纯函数、零 React → **可单测** → 分组规则不会悄悄坏掉
 */

/** 分组用的最小几何 */
export interface AnnotationAnchor {
  /** 页内左边界（px） */
  left: number;
  /**
   * **"起点"的左边界**（多行高亮的第一行）。
   *
   * ⚠️ **为什么和 `left` 分开**（实测踩过的坑）：
   * -> `left` 是**所有行的高亮的并集**的左边界 ❌
   * -> 一条跨 3 行的高亮 -> 并集的 left 是**第 3 行**的位置 ❌
   *    -> 分组排序按 `left` -> **顺序反了** ❌
   * -> `startLeft` 是**第一行**的左边界 -> **文档顺序**
   */
  startLeft?: number;
  /** 页内上边界（px） */
  top: number;
  /** 宽（px） */
  width: number;
  /** 高（px） */
  height: number;
}

/**
 * 分组的容差（px）。
 *
 * ⚠️ **为什么是 24px**：
 * → 一行文字的高度大约 **16~20px**（正文）
 * → 同一行的批注图标（22px）会**完全重叠**
 * → 相邻两行（行距 ~24px）则**不该**合并
 * → 所以：**垂直重叠 > 50%** 才算同一行；水平距离 ≤ 120px 才算"挤在一起"
 */
export const ANNOTATION_GROUP_TOLERANCE = {
  /** 垂直重叠比例的阈值（0~1）：超过就算同一行 */
  verticalOverlapRatio: 0.5,
  /** 水平距离阈值（px）：锚点中心相距不超过就合并 */
  horizontalDistance: 120,
};

/** 一组批注 */
export interface AnnotationGroup {
  /** 组的 key（组内第一条的 id） */
  key: string;
  /** 组里的批注（按锚点位置从左到右） */
  annotations: Annotation[];
  /** 组内所有锚点的并集（用来摆图标） */
  anchor: AnnotationAnchor;
}

/** 分组时用的批注（带锚点） */
export interface Annotation extends AnnotationAnchor {
  /** 批注 id */
  id: string;
}

/**
 * **按锚点位置把批注分组**。
 *
 * ## 算法
 *
 * 1. 按锚点**垂直中心**排序
 * 2. 依次遍历：和已有组比较
 *    - 垂直重叠 > 阈值 → **同一行**
 *    - 水平中心距离 ≤ 阈值 → **同一组**
 *    - 否则 → **新开一组**
 *
 * ⚠️ **只合并"真的挤在一起"的**：
 * → 用户说的"同一行"是主因，但**相邻两行**的批注也会视觉重叠
 * → 所以两个条件都要满足 → 不会把整页的批注都并成一组
 *
 * @param items 带锚点的批注
 * @param tolerance 容差（默认用 `ANNOTATION_GROUP_TOLERANCE`）
 * @returns 分组结果（按组内第一条的锚点位置排序）
 */
export function groupAnnotations(
  items: Annotation[],
  tolerance: {
    verticalOverlapRatio: number;
    horizontalDistance: number;
  } = ANNOTATION_GROUP_TOLERANCE,
): AnnotationGroup[] {
  if (items.length === 0) {
    return [];
  }

  // 按垂直中心排序（同一行的会挨在一起）
  const sorted = [...items].sort((a, b) => {
    const ca = a.top + a.height / 2;
    const cb = b.top + b.height / 2;
    if (ca !== cb) {
      return ca - cb;
    }
    return a.left - b.left;
  });

  /*
   * ⚠️⚠️ **必须"反复合并"，一遍不够**（实测踩过的坑）。
   *
   * ```
   * a: x=100 ──── 200
   * b:      x=220 ──── 320
   * c:           x=340 ──── 440
   * ```
   *
   * ### 只扫一遍会怎样（按垂直中心排序后）
   *
   * ```
   * 顺序: c(中心208) a(中心209) b(中心210)
   *
   * c → 新组 [c]
   * a → 和 c 差 140px → 新组 [a]        ← a、b 明明只差 20px！
   * b → 和 c 差 20px → 加入 [c] → [c, b]
   *
   * 结果: [c, b] 和 [a]  ← 还是两组 ❌
   * ```
   *
   * ### 修法：**合并到不动点**
   *
   * → 一轮合并后，再扫一遍，看有没有组能合并 → 直到不再变化
   * → `[c,b]` 和 `[a]` 这一轮就会合并 → `[a, b, c]`
   */
  const groups: Annotation[][] = [];

  for (const item of sorted) {
    let merged = false;

    for (const group of groups) {
      if (canJoin(group, item, tolerance)) {
        group.push(item);
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push([item]);
    }
  }

  // 反复合并，直到没有组能再合并
  for (let round = 0; round < 10; round += 1) {
    let changed = false;

    for (let i = 0; i < groups.length; i += 1) {
      const groupA = groups[i];
      if (!groupA) continue;

      for (let j = i + 1; j < groups.length; j += 1) {
        const groupB = groups[j];
        if (!groupB) continue;

        /*
         * ⚠️ **合并的判据：合并后仍然是"一行"，且总跨度不超容差**。
         *
         * → 光看"垂直同一行"不够 → 水平差 800px 的两个也会被合 ❌
         * → 所以还要看**合并后的总水平跨度**
         */
        if (canMergeGroups(groupA, groupB, tolerance)) {
          groupA.push(...groupB);
          groups.splice(j, 1);
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  // 每组按水平位置排序（图标从左到右）
  return groups.map((group) => {
    /*
     * ⚠️ **按"起点"排序**（文档顺序），不是按并集的 left。
     *
     * -> 并集的 left 是**所有行**的最左边 -> 跨行高亮会**排到最后** ❌
     * -> 用户看到的"选择批注"列表**顺序反了** ❌
     */
    const sortedGroup = [...group].sort(
      (a, b) => (a.startLeft ?? a.left) - (b.startLeft ?? b.left),
    );
    return {
      key: sortedGroup[0]?.id ?? '',
      annotations: sortedGroup,
      anchor: unionAnchor(sortedGroup),
    };
  });
}

/**
 * 判断两个组能不能合并。
 *
 * ⚠️ **两个条件都要满足**（实测踩过的坑）：
 *
 * ① **垂直**：合并后所有成员还在**同一行**
 * ② **水平**：合并后的**总跨度** ≤ 容差
 *
 * ### 为什么 ② 不能只看"两组之间的距离"
 *
 * ```
 * [a, b] 占 x=100..320      （组 1）
 * [c]    占 x=340..440      （组 2）  ← 和组 1 只差 20px
 * ```
 * → 合并后总跨度 = 100..440 = **340px** → 超容差 → **不该合并**？
 * → 但实际上 a、b、c 是**同一行连续的三条** → **应该合并**
 *
 * → 所以容差要按**"和最近成员的间距"**算，而不是"和组并集的间距"
 * → 合并后仍然要**每一对相邻成员**都在容差内
 *
 * @param groupA 组 A
 * @param groupB 组 B
 * @param tolerance 容差
 * @returns 能合并则 true
 */
function canMergeGroups(
  groupA: Annotation[],
  groupB: Annotation[],
  tolerance: { verticalOverlapRatio: number; horizontalDistance: number },
): boolean {
  const merged = [...groupA, ...groupB].sort((a, b) => a.left - b.left);

  // ① 垂直：所有成员都在同一行
  const first = merged[0];
  if (!first) {
    return false;
  }
  for (const member of merged) {
    if (!isSameRow(first, member, tolerance.verticalOverlapRatio)) {
      return false;
    }
  }

  // ② 水平：**相邻成员**的间距都要在容差内
  for (let i = 1; i < merged.length; i += 1) {
    const prev = merged[i - 1];
    const cur = merged[i];
    if (!prev || !cur) {
      continue;
    }
    if (horizontalGap(prev, cur) > tolerance.horizontalDistance) {
      return false;
    }
  }

  return true;
}

/**
 * 判断一个批注能不能加入某组。
 *
 * ⚠️ **和"组的并集"比**，不是"和每个成员比"。
 *
 * ### 为什么（实测踩过的坑）
 *
 * ```
 * a: x=100 ──── 200
 * b:      x=220 ──── 320
 * c:           x=340 ──── 440
 * ```
 *
 * → 如果要求新成员和**每个**成员都在 120px 内
 * → `c` 和 `a` 相距 **240px** → `c` 加不进去 ❌
 * → 同一行的三个批注被拆成两组 → 图标还是叠在一起
 *
 * → 正确做法：**和整组的并集比**
 * → `c` 离并集（100..320）只有 20px → 加入
 *
 * @param group 已有组
 * @param item 待加入的批注
 * @param tolerance 容差
 * @returns 能加入则 true
 */
function canJoin(
  group: Annotation[],
  item: Annotation,
  tolerance: { verticalOverlapRatio: number; horizontalDistance: number },
): boolean {
  // 和组里**每一条**都要"同一行"（垂直方向）
  for (const member of group) {
    if (!isSameRow(member, item, tolerance.verticalOverlapRatio)) {
      return false;
    }
  }

  // 水平方向：和**整组的并集**比（不是和每个成员比）
  const span = unionAnchor(group);
  return horizontalGap(span, item) <= tolerance.horizontalDistance;
}

/**
 * 两个矩形是不是"同一行"。
 *
 * ⚠️ **用重叠比例**，不是"中心距离"：
 * → 两行文字的行距可能只有 24px，中心距离不大但**不重叠**
 * → 重叠比例能区分"同一行"和"相邻行"
 *
 * @param a 矩形 a
 * @param b 矩形 b
 * @param ratio 阈值（0~1）
 * @returns 是同一行则 true
 */
export function isSameRow(
  a: AnnotationAnchor,
  b: AnnotationAnchor,
  ratio = ANNOTATION_GROUP_TOLERANCE.verticalOverlapRatio,
): boolean {
  const overlap = verticalOverlap(a, b);
  const minHeight = Math.min(a.height, b.height);
  if (minHeight <= 0) {
    return false;
  }
  return overlap / minHeight >= ratio;
}

/**
 * 两个矩形的垂直重叠高度（px）。
 *
 * @param a 矩形 a
 * @param b 矩形 b
 * @returns 重叠高度
 */
export function verticalOverlap(a: AnnotationAnchor, b: AnnotationAnchor): number {
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return Math.max(0, bottom - top);
}

/**
 * 两个矩形之间的水平间隙（px）。
 *
 * ⚠️ **重叠时是 0**（不是负数）→ 同一个位置的两个批注 → 间隙 0
 *
 * @param a 矩形 a
 * @param b 矩形 b
 * @returns 水平间隙
 */
export function horizontalGap(a: AnnotationAnchor, b: AnnotationAnchor): number {
  const aRight = a.left + a.width;
  const bRight = b.left + b.width;
  const gap = Math.max(a.left, b.left) - Math.min(aRight, bRight);
  return Math.max(0, gap);
}

/**
 * 合并多个矩形的**并集**。
 *
 * @param items 矩形
 * @returns 并集
 */
export function unionAnchor(items: AnnotationAnchor[]): AnnotationAnchor {
  if (items.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const item of items) {
    left = Math.min(left, item.left);
    top = Math.min(top, item.top);
    right = Math.max(right, item.left + item.width);
    bottom = Math.max(bottom, item.top + item.height);
  }

  return { left, top, width: right - left, height: bottom - top };
}
