/**
 * **按【文档顺序】裁剪选区** ✅
 *
 * ## 为什么需要它 ✅
 *
 * -> 浏览器的 `Range` **本来就是**文档顺序的连续区间 ✅
 *    （pdf.js 直接用 `::selection` ✅ -> 完全不过滤 ✅）
 * -> 我们的文本层保持 **PDF 原始顺序** ✅（= 文本流顺序 ✅）
 *    （见 `core/text-layer/layout.ts` ✅）
 * -> -> "用户选了哪一段"**用项序判断最准** ✅ ✅
 *
 * ## 旧实现错在哪 ✅（实测，真实 PDF ✅）
 *
 * -> 旧实现（`drag-origin.ts` ✅）按"垂直重叠"分行 ✅
 *    -> 浏览器给 **52 个 rect / 7 个视觉行** ✅
 *    -> 垂直重叠法只分出 **3 组** ✅
 *    -> 第 2 组把 **6 个视觉行**吞成一组 ✅
 *    -> 合并后"核心段判定"逐行不同 ✅
 *    -> 实测逐行覆盖：**0% / 0% / 21%** ❌ -> **整行丢失 / 每行少选** ✅
 *
 * ## ⚠️ **为什么不能靠几何猜语义** ✅
 *
 * -> 双栏论文里 ✅ -> 左栏和右栏的 **y 高度不对齐** ✅
 * -> 任何"按 y 分行"的启发式 ✅ -> 跨栏时必然出错 ✅
 * -> -> Chrome 的语义就是 **DOM 顺序** ✅ -> 我们不该自己猜 ✅ ✅
 *
 * @packageDocumentation
 */

/** 一个矩形（视口坐标） */
export interface ClientRectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * **一个文本项** ✅
 *
 * -> `pageNumber` = 来自 `data-page-number` ✅
 * -> `itemIndex`  = 来自 `data-item-index` ✅（页内**文本流**序号 ✅）
 */
export interface DomOrderItem {
  /** 页码（1 起 ✅）*/
  pageNumber: number;
  /** 页内项序号（文本流顺序 ✅）*/
  itemIndex: number;
  /** 该项的浏览器矩形 ✅*/
  rect: ClientRectLike;
}

/** 输入 ✅ */
export interface DomOrderInput {
  /** 全部候选项 ✅*/
  items: readonly DomOrderItem[];
  /** 选区起点所在的项 ✅（`null` = 不在文本层里 ✅）*/
  start: DomOrderItem | null;
  /** 选区终点所在的项 ✅（`null` = 不在文本层里 ✅）*/
  end: DomOrderItem | null;
}

/** 输出 ✅ */
export interface DomOrderResult {
  /** 保留的矩形 ✅*/
  kept: ClientRectLike[];
  /** 丢弃的矩形 ✅*/
  dropped: ClientRectLike[];
}

/** 调试信息 ✅ */
export interface DomOrderDebug {
  /** 参与排序的项数 ✅*/
  itemCount: number;
  /** 起点在排序后的下标 ✅（-1 = 没找到 ✅）*/
  startIndex: number;
  /** 终点在排序后的下标 ✅（-1 = 没找到 ✅）*/
  endIndex: number;
  /** 保留的项数 ✅*/
  keptCount: number;
  /** 丢弃的项数 ✅*/
  droppedCount: number;
  /** 区间长度（项数 ✅）*/
  spanLength: number;
  /** ⚠️ **是否触发了兜底** ✅（true = 起点/终点没找到 ✅）*/
  fallback: boolean;
}

/**
 * **比较两个项的全局顺序** ✅
 *
 * -> 先比页码 ✅ -> 再比页内序号 ✅
 * -> 这就是**文本流顺序** ✅（左栏到底 -> 右栏 ✅）
 */
export function compareItems(a: DomOrderItem, b: DomOrderItem): number {
  if (a.pageNumber !== b.pageNumber) {
    return a.pageNumber - b.pageNumber;
  }
  return a.itemIndex - b.itemIndex;
}

/**
 * **在排序后的数组里找某个项的下标** ✅
 *
 * ## ⚠️ **为什么不能直接用 `indexOf`** ✅
 *
 * -> `items` 的顺序可能和传入的项**不是同一个对象** ✅
 * -> 调用方重新构造过项 ✅ -> 引用不同 ✅ -> `indexOf` 找不到 ✅ ❌
 * -> -> 所以按 `(pageNumber, itemIndex)` **按值**找 ✅ ✅
 */
function indexOfItem(sorted: readonly DomOrderItem[], target: DomOrderItem | null): number {
  if (!target) {
    return -1;
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];
    if (item && item.pageNumber === target.pageNumber && item.itemIndex === target.itemIndex) {
      return i;
    }
  }
  return -1;
}

/**
 * **按【文档顺序】裁剪** ✅
 *
 * ## 语义 ✅
 *
 * -> 保留 **起点 → 终点** 之间的所有项 ✅
 * -> **反向拖选自动对称** ✅（取 min/max ✅）✅
 * -> 跨栏时 ✅ -> 左栏末尾 → 右栏开头 **整段都保留** ✅ ✅
 *
 * ## 兜底策略 ✅（实测踩到的坑 ✅）
 *
 * | 情况 | 行为 | 理由 |
 * |---|---|---|
 * | 起点/终点不在文本层 | **全保留** | 点在空白处 ✅ -> 无法判断意图 ✅ -> 保守 ✅ |
 * | **找不到起点** | **退化到第 0 项** | 调用方过滤掉了起点 ✅ -> 至少区间收敛 ✅ ❌ 不是全保留 ✅ |
 * | **找不到终点** | **退化到最后一项** | 同上 ✅ |
 *
 * -> ⚠️ **"全保留"只在"起点/终点根本不存在"时用** ✅
 * -> ⚠️ **"找不到"必须收敛** ✅
 *    -> 旧写法 ✅ -> 实测**多选了 33 个项** ✅ ❌
 *
 * @param input 输入
 * @returns 保留 / 丢弃的矩形
 */
export function clipByDomOrder(input: DomOrderInput): DomOrderResult {
  const { items, start, end } = input;

  // 没有项 -> 没什么可裁的 ✅
  if (items.length === 0) {
    return { kept: [], dropped: [] };
  }

  // ⚠️ **起点或终点不在文本层里 -> 保守全保留** ✅
  //    （点在空白处 / 页边距 ✅ -> 无法判断意图 ✅ -> 不裁 ✅）
  if (!start || !end) {
    return { kept: items.map((i) => i.rect), dropped: [] };
  }

  // ⚠️ **按全局序排序** ✅
  //    -> 不能假设调用方给的顺序就是文本流顺序 ✅
  const sorted = [...items].sort(compareItems);

  const startIndex = indexOfItem(sorted, start);
  const endIndex = indexOfItem(sorted, end);

  /*
   * ⚠️⚠️ **找不到起点/终点** ✅（实测踩到的坑 ✅）
   *
   * -> 旧写法：**全部保留** ✅ -> 实测**多选了 33 个项** ✅ ❌
   *    -> 触发条件 ✅：调用方先做了垂直过滤 ✅ -> 起点项被过滤掉了 ✅
   *    -> -> `indexOfItem` 找不到 ✅ -> 退化成"全保留" ✅ ❌
   *
   * -> 现在的语义 ✅：**调用方必须保证 items 含 start / end** ✅
   *    -> 找不到 ✅ -> 说明**调用顺序错了** ✅
   *    -> -> **收敛到最近的边界** ✅（保守 ✅）❌ 也不要全保留 ✅
   */
  let lo: number;
  let hi: number;
  if (startIndex < 0 || endIndex < 0) {
    lo = startIndex < 0 ? 0 : startIndex;
    hi = endIndex < 0 ? sorted.length - 1 : endIndex;
    if (lo > hi) {
      const t = lo;
      lo = hi;
      hi = t;
    }
  } else {
    lo = Math.min(startIndex, endIndex);
    hi = Math.max(startIndex, endIndex);
  }

  const kept: ClientRectLike[] = [];
  const dropped: ClientRectLike[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];
    if (!item) {
      continue;
    }
    if (i >= lo && i <= hi) {
      kept.push(item.rect);
    } else {
      dropped.push(item.rect);
    }
  }

  return { kept, dropped };
}

/**
 * **诊断信息** ✅
 *
 * -> 排查"选区丢内容"时**必须能看到** ✅
 * -> 每一级的数量都单独记 ✅ -> 一眼看出是哪一级丢的 ✅
 */
export function describeDomOrder(input: DomOrderInput): DomOrderDebug {
  const { items, start, end } = input;
  const sorted = [...items].sort(compareItems);
  const startIndex = indexOfItem(sorted, start);
  const endIndex = indexOfItem(sorted, end);
  const fallback = startIndex < 0 || endIndex < 0;

  let lo = 0;
  let hi = sorted.length - 1;
  if (startIndex >= 0 && endIndex >= 0) {
    lo = Math.min(startIndex, endIndex);
    hi = Math.max(startIndex, endIndex);
  }

  const keptCount = fallback ? sorted.length : hi - lo + 1;

  return {
    itemCount: sorted.length,
    startIndex,
    endIndex,
    keptCount,
    droppedCount: sorted.length - keptCount,
    spanLength: keptCount,
    fallback,
  };
}
