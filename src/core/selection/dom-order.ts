/**
 * **按【文档顺序】裁剪选区**
 *
 * ## 为什么需要它
 *
 * -> 浏览器的 `Range` **本来就是**文档顺序的连续区间
 *    （pdf.js 直接用 `::selection` -> 完全不过滤）
 * -> 我们的文本层保持 **PDF 原始顺序**（= 文本流顺序）
 *    （见 `core/text-layer/layout.ts`）
 * -> -> "用户选了哪一段"**用项序判断最准**
 *
 * ## 它解决什么
 *
 * -> **反向选择**（从后往前拖）
 *    -> 浏览器的 Range 永远 `start < end`（**按文档顺序**）
 *    -> 反向拖时浏览器会**归一化方向**
 *    -> -> 我们的几何判断（只看 y）会丢边界项
 *    -> -> 这里按**文档顺序**判断，反向自动对称
 *
 * ## ⚠️ **它不负责矩形精度**
 *
 * -> 矩形精度由 `range.getClientRects()` 决定（**字符级**）
 * -> 本模块只决定"**哪些项在区间内**"
 * -> ⚠️ 千万不要用 `span.getClientRects()` 代替（那是**项级**，会整块涂上）
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
 * **一个文本项**
 *
 * -> `pageNumber` = 来自 `data-page-number`
 * -> `itemIndex`  = 来自 `data-item-index`（页内**文本流**序号）
 */
export interface DomOrderItem {
  /** 页码（1 起）*/
  pageNumber: number;
  /** 页内项序号（文本流顺序）*/
  itemIndex: number;
  /** 该项的浏览器矩形 */
  rect: ClientRectLike;
}

/** 输入 */
export interface DomOrderInput {
  /** 全部候选项 */
  items: readonly DomOrderItem[];
  /** 选区起点所在的项（`null` = 不在文本层里）*/
  start: DomOrderItem | null;
  /** 选区终点所在的项（`null` = 不在文本层里）*/
  end: DomOrderItem | null;
}

/** 输出 */
export interface DomOrderResult {
  /** 保留的矩形 */
  kept: ClientRectLike[];
  /** 丢弃的矩形 */
  dropped: ClientRectLike[];
  /**
   * ⚠️ **保留的项**（用来做字符级矩形分配）
   *
   * ⚠️ **一个项可能对应多个矩形**  （行盒 + 字形盒）
   *    -> `kept` 和 `keptItems` **不是一一对应** ✅ ❌
   *    -> -> 分配时**必须按项分组** ✅ ❌ 不能按数组下标 ✅
   */
  keptItems: DomOrderItem[];
}

/** 调试信息 */
export interface DomOrderDebug {
  /** 参与排序的项数 */
  itemCount: number;
  /** 起点在排序后的下标（-1 = 没找到）*/
  startIndex: number;
  /** 终点在排序后的下标（-1 = 没找到）*/
  endIndex: number;
  /** 保留的项数 */
  keptCount: number;
  /** 丢弃的项数 */
  droppedCount: number;
  /** 区间长度（项数）*/
  spanLength: number;
  /** ⚠️ **是否触发了兜底**（true = 起点/终点没找到）*/
  fallback: boolean;
}

/**
 * **比较两个项的全局顺序**
 *
 * -> 先比页码 -> 再比页内序号
 * -> 这就是**文本流顺序**（左栏到底 -> 右栏）
 */
export function compareItems(a: DomOrderItem, b: DomOrderItem): number {
  if (a.pageNumber !== b.pageNumber) {
    return a.pageNumber - b.pageNumber;
  }
  return a.itemIndex - b.itemIndex;
}

/**
 * **在排序后的数组里找某个项的下标**
 *
 * ## ⚠️ **为什么不能直接用 `indexOf`**
 *
 * -> 调用方可能重新构造过项 -> 引用不同 -> `indexOf` 找不到
 * -> -> 所以按 `(pageNumber, itemIndex)` **按值**找
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
 * **把下标夹到合法范围**
 *
 * ## 为什么需要
 *
 * -> `indexOfItem` 找不到时返回 **-1**
 * -> 不能直接 `Math.min(-1, len - 1)` -> 结果还是 -1 -> 不是最后一项
 */
function clampIndex(index: number, min: number, max: number): number {
  if (index < min) {
    return min;
  }
  if (index > max) {
    return max;
  }
  return index;
}

/**
 * **按【文档顺序】裁剪**
 *
 * ## 语义
 *
 * -> 保留 **起点 → 终点** 之间的所有项
 * -> **反向拖选自动对称**（取 min/max）
 * -> 跨栏时，左栏末尾 → 右栏开头 **整段都保留**
 *
 * ## 兜底策略
 *
 * | 情况 | 行为 | 理由 |
 * |---|---|---|
 * | 起点/终点不在文本层 | **全保留** | 点在空白处 -> 无法判断意图 -> 保守 |
 * | **找不到起点** | **退化到第 0 项** | 至少区间收敛 ❌ 不是全保留 |
 * | **找不到终点** | **退化到最后一项** | 同上 |
 *
 * -> ⚠️ **"找不到"时全保留会多选几十项** -> 必须收敛
 *
 * @param input 输入
 * @returns 保留 / 丢弃的矩形 + 保留的项
 */
export function clipByDomOrder(input: DomOrderInput): DomOrderResult {
  const { items, start, end } = input;

  // 没有项 -> 没什么可裁的
  if (items.length === 0) {
    return { kept: [], dropped: [], keptItems: [] };
  }

  // ⚠️ **起点或终点不在文本层里 -> 保守全保留**
  //    （点在空白处 / 页边距 -> 无法判断意图 -> 不裁）
  if (!start || !end) {
    return {
      kept: items.map((i) => i.rect),
      dropped: [],
      keptItems: [...items],
    };
  }

  // ⚠️ **按全局序排序**
  //    -> 不能假设调用方给的顺序就是文本流顺序
  const sorted = [...items].sort(compareItems);

  const startIndex = indexOfItem(sorted, start);
  const endIndex = indexOfItem(sorted, end);

  /*
   * ⚠️⚠️ **找不到起点/终点**
   *
   * -> 旧写法是**全部保留** -> 实测会**多选 33 个项**
   *    -> 触发条件：调用方先做了垂直过滤 -> 起点项被过滤掉了
   *    -> -> `indexOfItem` 找不到 -> 退化成"全保留"
   *
   * -> 现在的语义：**调用方必须保证 items 含 start / end**
   *    -> 找不到 -> 说明**调用顺序错了**
   *    -> -> **收敛到最近的边界**（保守）❌ 也不要全保留
   */
  let lo: number;
  let hi: number;
  if (startIndex < 0 || endIndex < 0) {
    /*
     * -> 起点找不到 -> 用**第 0 项**
     * -> 终点找不到 -> 用**最后一项**
     */
    const fallbackStart = startIndex < 0 ? 0 : clampIndex(startIndex, 0, sorted.length - 1);
    const fallbackEnd =
      endIndex < 0 ? sorted.length - 1 : clampIndex(endIndex, 0, sorted.length - 1);
    lo = Math.min(fallbackStart, fallbackEnd);
    hi = Math.max(fallbackStart, fallbackEnd);
  } else {
    lo = Math.min(startIndex, endIndex);
    hi = Math.max(startIndex, endIndex);
  }

  const kept: ClientRectLike[] = [];
  const dropped: ClientRectLike[] = [];
  /**
   * ⚠️ **和 `kept` 平行**  （下标一一对应）
   *
   * -> `sorted` 里是**每个矩形一条**  （一个项可能有多个矩形）
   * -> -> 所以 `kept[i]` 对应的项就是 `keptItems[i]`
   */
  const keptItems: DomOrderItem[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];
    if (!item) {
      continue;
    }
    if (i >= lo && i <= hi) {
      kept.push(item.rect);
      keptItems.push(item);
    } else {
      dropped.push(item.rect);
    }
  }

  return { kept, dropped, keptItems };
}

/**
 * **诊断信息**
 *
 * -> 排查"选区丢内容"时**必须能看到**
 * -> 每一级的数量都单独记 -> 一眼看出是哪一级丢的
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

/**
 * **把 Range 的【字符级矩形】按位置分配给各项**
 *
 * ## 为什么需要
 *
 * -> `range.getClientRects()` 给的是**字符级**矩形
 *    （实测：选 1 个字符 -> `w:25`；整个项是 `w:411`）
 * -> 但它**不告诉你属于哪个项**
 * -> -> 用**矩形中心落在哪个项的范围内**来判断
 *
 * ## ⚠️ **为什么不能直接用项的矩形**
 *
 * -> 项的矩形是**项级** -> 选 1 个字符也会把整块涂上
 * -> -> 用户反馈："**明明选在中间 但是只能选择一整行**"
 *
 * @param itemRects 各项的矩形（项级）
 * @param rangeRects Range 的矩形（字符级）
 * @returns 每项该用哪些矩形（key = 项在数组里的下标）
 */
export function assignRectsToItems(
  itemRects: readonly ClientRectLike[],
  rangeRects: readonly ClientRectLike[],
): Map<number, ClientRectLike[]> {
  const result = new Map<number, ClientRectLike[]>();
  if (itemRects.length === 0) {
    return result;
  }

  for (const rect of rangeRects) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // 找中心点落在哪个项的范围内
    let owner = -1;
    for (let i = 0; i < itemRects.length; i += 1) {
      const item = itemRects[i];
      if (!item) {
        continue;
      }
      const right = item.left + item.width;
      const bottom = item.top + item.height;
      if (centerX >= item.left && centerX <= right && centerY >= item.top && centerY <= bottom) {
        owner = i;
        break;
      }
    }

    // 找不到归属 -> 丢掉（保守：避免画出选区外的）
    if (owner < 0) {
      continue;
    }

    const list = result.get(owner);
    if (list) {
      list.push(rect);
    } else {
      result.set(owner, [rect]);
    }
  }

  return result;
}

/**
 * **按【项】把字符级矩形分好组**
 *
 * ## ⚠️ **为什么不能按数组下标对应**
 *
 * -> 一个 span 会给**多个 rect**  （行盒 + 字形盒）
 * -> 所以 `kept`（矩形数组）和 `keptItems`（项数组）**长度不同** ✅ ❌
 * -> -> 按下标对应会**错位**
 *    -> 实测：项漏选 ✅（"T cells and demonstrates" ✅ 没底色 ✅ ❌）
 *
 * ## 做法
 *
 * -> 按 `(pageNumber, itemIndex)` 把矩形**分组**
 * -> -> 每项一组  -> 组内是该项的所有矩形
 *
 * @param itemRects 各项的矩形（**同一个项的矩形会挨在一起**）
 * @param items 对应的项（顺序与 `itemRects` **一致**）
 * @param rangeRects Range 的矩形（字符级）
 * @returns 每项该用哪些矩形（key = 项的序号）
 */
export function groupRectsByItem(
  itemRects: readonly ClientRectLike[],
  items: readonly DomOrderItem[],
  rangeRects: readonly ClientRectLike[],
): Map<string, ClientRectLike[]> {
  const result = new Map<string, ClientRectLike[]>();
  if (itemRects.length === 0 || items.length === 0) {
    return result;
  }

  /*
   * ⚠️ **先建立【项 -> 矩形下标】的映射**
   *
   * -> `itemRects` 和 `items` 是**平行数组**  （一一对应）
   * -> -> 但一个项会有**多个矩形**  -> 所以要按 key 分组
   */
  const rectsByKey = new Map<string, ClientRectLike[]>();
  for (let i = 0; i < itemRects.length; i += 1) {
    const rect = itemRects[i];
    const item = items[i];
    if (!rect || !item) {
      continue;
    }
    const key = `${item.pageNumber}:${item.itemIndex}`;
    const list = rectsByKey.get(key);
    if (list) {
      list.push(rect);
    } else {
      rectsByKey.set(key, [rect]);
    }
  }

  // ⚠️ **按【项的矩形范围】判断归属**
  for (const rect of rangeRects) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let ownerKey: string | null = null;
    for (const [key, rects] of rectsByKey) {
      for (const r of rects) {
        const right = r.left + r.width;
        const bottom = r.top + r.height;
        if (centerX >= r.left && centerX <= right && centerY >= r.top && centerY <= bottom) {
          ownerKey = key;
          break;
        }
      }
      if (ownerKey) {
        break;
      }
    }

    // 找不到归属 -> 丢掉（保守）
    if (!ownerKey) {
      continue;
    }

    const list = result.get(ownerKey);
    if (list) {
      list.push(rect);
    } else {
      result.set(ownerKey, [rect]);
    }
  }

  return result;
}
