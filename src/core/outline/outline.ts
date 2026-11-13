/**
 * 目录（Outline）—— 核心逻辑。
 *
 * PDF 的 outline 是一棵树：每个节点有标题、目标页（可能跨多页）、
 * 以及若干子节点。包需要把它转成"可跳转的扁平列表"（带层级）。
 */

/** 目录项（pdf.js OutlineItem 的最小形状） */
export interface OutlineItemLike {
  /** 标题 */
  title: string;
  /** 目标（页码 + 位置） */
  dest?: string | unknown[] | null;
  /** 子项 */
  items?: OutlineItemLike[];
  /** 是否展开 */
  bold?: boolean;
  /** 是否斜体 */
  italic?: boolean;
}

/** 扁平化后的目录项 */
export interface FlatOutlineItem {
  /** 标题 */
  title: string;
  /** 目标页（1-based；解析不出时为 null） */
  pageNumber: number | null;
  /** 层级（0 = 顶层） */
  level: number;
  /** 唯一 id（React key + 展开状态定位） */
  id: string;
  /** 是否展开（默认全展开） */
  expanded: boolean;
}

/**
 * 目标解析：把 dest 转成页码。
 *
 * dest 有两种形态（真实 PDF 两种都有）：
 * 1. **数组**：[pageRef, '/XYZ', left, top, zoom] → 直接有页引用
 * 2. **字符串**：命名目标（如 "section.1"）→ 页引用要由宿主先解析出来
 *
 * 数组形态：页引用 → 页码，用宿主的映射函数查。
 * 字符串形态：宿主已经把"命名目标 → 页码"解析好了，直接查映射。
 *
 * @param dest 目标（数组或命名）
 * @param pageRefToNumber 页引用/命名 → 页码的映射
 * @returns 页码（解析不出时 null）
 */
export function resolveDestPage(
  dest: string | unknown[] | null | undefined,
  pageRefToNumber: (ref: unknown) => number | null,
): number | null {
  if (!dest) {
    return null;
  }

  // 数组形态：第一个元素是页引用
  if (Array.isArray(dest)) {
    if (dest.length === 0) {
      return null;
    }
    const pageNumber = pageRefToNumber(dest[0]);
    return pageNumber !== null && pageNumber >= 1 ? pageNumber : null;
  }

  // 字符串形态：命名目标 → 宿主的映射里直接查（键就是命名本身）
  if (typeof dest === 'string') {
    const pageNumber = pageRefToNumber(dest);
    return pageNumber !== null && pageNumber >= 1 ? pageNumber : null;
  }

  return null;
}

/**
 * 收集目录树里出现的所有页引用（去重）。
 *
 * 用途：宿主可以**提前**把这些引用解析成页码（pdf.js 的 getPageIndex 是异步的），
 * 解析好后再给包一个同步的映射函数 → 目录项立刻可跳转。
 *
 * @param items 目录树
 * @returns 页引用数组
 */
export function collectOutlineRefs(items: OutlineItemLike[] | undefined | null): unknown[] {
  const refs: unknown[] = [];
  const seen = new Set<string>();

  /** 递归收集 */
  const walk = (list: OutlineItemLike[]) => {
    for (const item of list) {
      if (Array.isArray(item.dest) && item.dest[0]) {
        const ref = item.dest[0];
        // 用对象身份去重（同一个页引用在多个目录项里出现）
        const key = `${(ref as { num?: number })?.num ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(ref);
        }
      }
      if (item.items && item.items.length > 0) {
        walk(item.items);
      }
    }
  };

  if (items && items.length > 0) {
    walk(items);
  }

  return refs;
}

/**
 * 把目录树扁平化（带层级）。
 *
 * 为什么扁平：React 里渲染树要递归组件 + 展开状态管理，
 * 扁平后就是一个 map，展开状态用 Set 管理，简单得多也更快。
 *
 * @param items 目录树
 * @param pageRefToNumber 页引用 → 页码的映射
 * @returns 扁平列表
 */
export function flattenOutline(
  items: OutlineItemLike[] | undefined | null,
  pageRefToNumber: (ref: unknown) => number | null,
): FlatOutlineItem[] {
  const result: FlatOutlineItem[] = [];

  /** 递归遍历 */
  const walk = (list: OutlineItemLike[], level: number, path: string) => {
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (!item) {
        continue;
      }

      const id = `${path}-${index}`;

      result.push({
        title: item.title ?? '',
        pageNumber: resolveDestPage(item.dest, pageRefToNumber),
        level,
        id,
        expanded: true,
      });

      if (item.items && item.items.length > 0) {
        walk(item.items, level + 1, id);
      }
    }
  };

  if (items && items.length > 0) {
    walk(items, 0, 'r');
  }

  return result;
}

/**
 * 计算展开状态下的可见项。
 *
 * 做法：维护"当前被折叠的层级"栈 —— 遇到折叠项就记住它的层级，
 * 后续层级更深的项（即它的子项）全部跳过，直到遇到同级或更浅的项。
 *
 * @param items 扁平列表
 * @param collapsedIds 折叠的项 id
 * @returns 可见项（折叠项的子项被隐藏）
 */
export function visibleOutlineItems(
  items: FlatOutlineItem[],
  collapsedIds: Set<string>,
): FlatOutlineItem[] {
  if (collapsedIds.size === 0) {
    return items;
  }

  /** 折叠项的 id → 它的层级 */
  const collapsedLevels = new Map<string, number>();
  for (const item of items) {
    if (collapsedIds.has(item.id)) {
      collapsedLevels.set(item.id, item.level);
    }
  }

  const result: FlatOutlineItem[] = [];
  /** 当前处于折叠状态的最深层级（-1 = 无） */
  let hiddenBelowLevel = -1;

  for (const item of items) {
    // 层级变浅或同级 → 离开之前的折叠子树
    if (hiddenBelowLevel >= 0 && item.level <= hiddenBelowLevel) {
      hiddenBelowLevel = -1;
    }

    // 处于折叠子树内 → 跳过
    if (hiddenBelowLevel >= 0) {
      continue;
    }

    result.push(item);

    // 本身是折叠项 → 它的子项（更深的层级）都要隐藏
    if (collapsedLevels.has(item.id)) {
      hiddenBelowLevel = item.level;
    }
  }

  return result;
}
