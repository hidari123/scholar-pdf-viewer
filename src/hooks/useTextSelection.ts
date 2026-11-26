/**
 * useTextSelection —— 文本选择 → 几何输出。
 *
 * 流程（对齐 pdf.js 的 `TextLayerBuilder` + v6 `DrawLayer.#selectionChange()`）：
 *   mouseup → window.getSelection()
 *     → 空 / 不在文本层 → 清除
 *     → Range → 收集涉及的页（靠文本层 span 的 data-page-number）
 *     → 每页取 client rects → 中心点归页 → 页内坐标化 → 同行合并
 *     → 输出 SelectionData（视口 px + 归一化）
 *
 * **关键：选区几何必须来自 DOM，不能自己算。**
 * 浏览器知道 fallback 字体的实际排版结果，
 * 我们用 PDF 的原始几何去"猜"浏览器怎么排 —— 一定会有误差。
 * pdf.js 的做法（v6 `DrawLayer`）也是 `range.getClientRects()`，
 * 只是把它归一化到页面的 0~1 坐标。
 *
 * **归页方式**：pdf.js 按**文本层归属**判断（`closest('.textLayer')`），
 * 我们用 span 上的 `data-page-number` —— 一步到位，
 * 不用像老 scholar-club 那样"每个 rect × 每页"双重循环 + 猜。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DomOrderItem } from '../core/selection/dom-order';
import { clipByDomOrder, describeDomOrder, groupRectsByItem } from '../core/selection/dom-order';
import type { PageFrame } from '../core/selection/extract';
import { extractSelection } from '../core/selection/extract';
import { filterOutliers, VERTICAL_TOLERANCE } from '../core/selection/filter-outliers';
import type { BaselinesByPage } from '../core/selection/shape';
import type { SelectionData } from '../core/types';

/** 文本层 span 上的页码标记（与 PageCanvas 约定） */
export const PAGE_NUMBER_ATTR = 'data-page-number';

/** 文本层的 class（用于 closest 查找） */
const TEXT_LAYER_CLASS = '.scpdf-text-layer';

/** 文本层里**单个文字项**的 class（`fillMissingRects` 用） */
const TEXT_LAYER_ITEM_CLASS = 'scpdf-text-layer__item';
/**
 * 页面的 class。
 *
 * ⚠️ 选区跨多个文本层时，`commonAncestorContainer` 是 **page** 而不是 textLayer
 *    → 判定"选区是否在文本层内"时必须同时认 page。
 */
const PAGE_CLASS = '.scpdf-page';

/**
 * **页容器**的 class（所有页的父元素）。
 *
 * ⚠️ **跨页选区的共同祖先就是这个**（实测）：
 * ```
 * 单页选区: commonAncestorContainer = .scpdf-page
 * 跨页选区: commonAncestorContainer = .scpdf-pages   ← 两者都不是
 * ```
 * → 判定"选区是否合法"时必须**也认**页容器，否则跨页选区会被整个丢弃。
 */
const PAGES_CONTAINER_CLASS = '.scpdf-pages';

/** endOfContent 哨兵的 class */
const END_OF_CONTENT_CLASS = '.scpdf-text-layer__end';

/** useTextSelection 参数 */
export interface UseTextSelectionOptions {
  /** 滚动容器 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 页框列表（用于归页判定） */
  pageFrames: PageFrame[];
  /** 当前缩放（影响合并容差） */
  scale?: number;
  /** 参考尺寸（写入归一化结构） */
  reference: { width: number; height: number };
  /**
   * 每页的**基线表**（把选区裁剪成贴合字形）。
   *
   * ⚠️ 不传 → 选区用浏览器给的行盒高度（比文字高 11px、偏上 6px）
   *    → 选区块/高亮块跟文字对不齐。
   */
  baselines?: BaselinesByPage;
  /** 选区变化 */
  onSelectionChange?: (selection: SelectionData | null) => void;
  /**
   * 选区的**原始** client rects（视口坐标）。
   *
   * ⚠️ **为什么要单独回调**：
   * `SelectionData.rects` 是**合并同行后**的矩形（用于持久化高亮），
   * 而自绘选区层需要**原始形状**（每个 client rect 一个）→ 合并会丢失形状细节。
   *
   * 两条管线各司其职（与 pdf.js 一致）：
   * - 原始 rects → 自绘选区（形状精确）
   * - 合并 rects → 持久化几何（干净、少数据）
   */
  onClientRects?: (rects: { top: number; left: number; width: number; height: number }[]) => void;
}

/** useTextSelection 返回值 */
export interface UseTextSelectionResult {
  /** 清除选区（并通知宿主 `onSelectionChange(null)`） */
  clearSelection: () => void;
  /** 只清包内部状态（**不通知宿主**） */
  clearState: () => void;
  /**
   * 清掉**浏览器原生选区**。
   *
   * ## 为什么需要
   *
   * `clearState()` 只清包内的引用 → **浏览器里的选区还在**
   * → `selectionchange` 还会触发 → 浮层又会被打开。
   *
   * 实测（用户反馈"点击高亮之后无法取消选中状态，一直都有外边框"）：
   * ```
   * 选中后:   nativeSelLen=11  selectionLayer=1  popover=true
   * 点高亮后: nativeSelLen=11  selectionLayer=1  popover=true   ← ❌ 全都没清
   * ```
   *
   * ## ⚠️ 什么时候**不能**调
   *
   * **绝不能在 mousedown / click 处理器里直接调** `removeAllRanges()`
   * → 那会**永久破坏后续的文本选择**（用户再也选不中字）。
   *
   * → 只在**动作完成之后**调（如"高亮已保存"）。
   */
  clearNativeSelection: () => void;
}

/** 选区矩形（视口坐标） */
interface SelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 文本层 span 上的页内项序号属性（文本流顺序）*/
const ITEM_INDEX_ATTR = 'data-item-index';

/**
 * **收集页面上的文本项（按文档顺序）**
 *
 * ## 做什么
 *
 * -> 找出**所有**文本层 span -> 读它们的 `data-page-number` / `data-item-index`
 * -> 读它们的**浏览器矩形**（`getClientRects()`）
 * -> 找出 Range 的**起点 / 终点**分别落在哪个项上
 *
 * ## 为什么
 *
 * -> 浏览器原生选区 = **文档顺序的连续区间**
 * -> 我们的文本层保持 **PDF 原始顺序**（= 文本流顺序）
 * -> -> 用 `(pageNumber, itemIndex)` 就能精确定位"选了哪一段"
 *
 * ## ⚠️ **这里的矩形只用来定位"哪些项"**，不用来画
 *
 * -> `span.getClientRects()` 是**项级**矩形
 * -> 画选区要用 **Range 的矩形**（**字符级**）
 * -> -> 否则选一个字符也会把整个项涂上
 *
 * @param container 容器
 * @param range 当前选区的 Range
 * @returns 项列表 + 起点项 + 终点项
 */
function collectDomOrderItems(
  container: HTMLElement,
  range: Range,
): {
  items: DomOrderItem[];
  start: DomOrderItem | null;
  end: DomOrderItem | null;
} {
  const spans = container.querySelectorAll<HTMLElement>(`.${TEXT_LAYER_ITEM_CLASS}`);

  const items: DomOrderItem[] = [];
  /** span -> 项（用于找起点/终点）*/
  const byEl = new Map<Element, DomOrderItem>();

  for (const span of spans) {
    const pageNumber = Number(span.getAttribute(PAGE_NUMBER_ATTR));
    const itemIndex = Number(span.getAttribute(ITEM_INDEX_ATTR));

    // ⚠️ **没有这两个属性 -> 跳过**（旧版本 / 第三方宿主）
    if (!Number.isFinite(pageNumber) || !Number.isFinite(itemIndex)) {
      continue;
    }

    const rects = span.getClientRects();
    if (rects.length === 0) {
      continue;
    }

    // ⚠️ **一个 span 可能给多个 rect**（行盒 + 字形盒）
    // -> 每个 rect 都属于**这个项** -> 带同一个 (page, index)
    for (const r of rects) {
      if (r.width <= 0 || r.height <= 0) {
        continue;
      }
      const item: DomOrderItem = {
        pageNumber,
        itemIndex,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      };
      items.push(item);
      if (!byEl.has(span)) {
        byEl.set(span, item);
      }
    }
  }

  /*
   * ⚠️ **找起点 / 终点所在的项**
   *
   * -> Range 的边界可能落在**文本节点**里 -> 要往上找 span
   * -> 找不到 -> `null` -> 走"保守全保留"分支
   */
  const findItem = (node: Node | null): DomOrderItem | null => {
    if (!node) {
      return null;
    }
    const el = node instanceof Element ? node : node.parentElement;
    if (!el) {
      return null;
    }
    const span = el.closest(`.${TEXT_LAYER_ITEM_CLASS}`);
    if (!span) {
      return null;
    }
    return byEl.get(span) ?? null;
  };

  return {
    items,
    start: findItem(range.startContainer),
    end: findItem(range.endContainer),
  };
}

/**
 * **补上浏览器漏掉的选区矩形**（实测踩过的坑，用户反馈"多行选择中间有的没有底色"）。
 *
 * ## 现象
 *
 * ```
 * 浏览器原生 rects: 605,381 8x17 / 613,381 5x17 / 637,385 149x23 …
 * 被选中的 span:    787,381 8x17   ← "Zhang*" 的星号
 * ```
 *
 * → `range.intersectsNode(span)` 说这个 span **被选中了**
 * → 但浏览器的 `getClientRects()` **没给它任何矩形**
 * → 自绘层就**漏掉了这一小块** → 用户看到"**中间有的没有底色**" ❌
 *
 * ## 根因
 *
 * 浏览器在选区**边界**处的处理很微妙：
 * Range 的边界正好落在某个 span 的边缘时，
 * 浏览器可能把它算进 `intersectsNode`，却**不产生** client rect。
 *
 * ## 修法
 *
 * **用文字 span 自己的几何补齐**：
 * 1. 找出所有 `intersectsNode` 为真的 span
 * 2. 找出那些**没有对应 client rect** 的 span
 * 3. 用它的 `getBoundingClientRect()` **合成一个矩形**
 *
 * → 我们本来就有每个字的确切位置（文本层）→ 补出来的矩形**比浏览器的更准**。
 *
 * @param rects 浏览器给的矩形（视口坐标）
 * @param range 当前选区
 * @param container 滚动容器
 * @returns 补齐后的矩形
 */
function fillMissingRects(
  rects: readonly SelectionRect[],
  range: Range,
  container: HTMLElement,
): SelectionRect[] {
  if (rects.length === 0) {
    return [...rects];
  }

  /*
   * ⚠️ **只处理"被选中的 span 少得离谱"的情况**（性能）。
   *
   * `intersectsNode` 对每个 span 都要遍历 DOM 树 → 很贵
   * → 只在**确实可能有缺口**时才查（见下）。
   */
  const result = [...rects];

  // 已覆盖的矩形（用于判断某个 span 有没有对应的 rect）
  const covered: SelectionRect[] = [...rects];

  for (const span of container.querySelectorAll<HTMLElement>(`.${TEXT_LAYER_ITEM_CLASS}`)) {
    // 这个 span 被选中了吗？
    if (!range.intersectsNode(span)) {
      continue;
    }

    const spanRect = span.getBoundingClientRect();
    if (spanRect.width <= 0 || spanRect.height <= 0) {
      continue;
    }

    // 已经有 client rect 覆盖它了吗？
    const hasCover = covered.some((r) => {
      const ox = Math.min(spanRect.right, r.left + r.width) - Math.max(spanRect.left, r.left);
      const oy = Math.min(spanRect.bottom, r.top + r.height) - Math.max(spanRect.top, r.top);
      // 只要有一点点重叠 → 算覆盖到了
      return ox > 1 && oy > 1;
    });
    if (hasCover) {
      continue;
    }

    // ⚠️ **只在"这个 span 和浏览器给的最接近的矩形在同一行"时才补**
    //    → 避免把"页边戳"那种异类元素补进来。
    const synth: SelectionRect = {
      left: spanRect.left,
      top: spanRect.top,
      width: spanRect.width,
      height: spanRect.height,
    };
    result.push(synth);
    covered.push(synth);
  }

  return result;
}

/**
 * **某个视口 y 坐标在第几页**（拖动的起点/终点用）。
 *
 * ⚠️ **和 `pageOfRect` 不一样**：
 * -> `pageOfRect` 算的是**矩形**落在哪一页 ✅
 * -> 这里算的是**一个点**（拖动的起点/终点）在哪一页 ✅
 *
 * @param y 视口坐标（相对浏览器窗口）
 * @param frames 页框（滚动内容坐标）
 * @param containerRect 容器的视口矩形
 * @param scrollTop 容器的滚动量
 * @returns 页码（1 起）；找不到返回 null
 */
function pageOfPoint(
  y: number,
  frames: PageFrame[],
  containerRect: DOMRect,
  scrollTop: number,
): number | null {
  // 视口坐标 -> 容器内容坐标
  const contentY = y - containerRect.top + scrollTop;

  let best: PageFrame | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const frame of frames) {
    const top = frame.top;
    const bottom = frame.top + frame.height;
    // 在这一页的范围内 -> 距离 0
    const distance =
      contentY >= top && contentY <= bottom
        ? 0
        : Math.min(Math.abs(contentY - top), Math.abs(contentY - bottom));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = frame;
    }
  }

  return best?.pageNumber ?? null;
}

/**
 * 文本选择。
 *
 * @param options 参数
 */
export function useTextSelection(options: UseTextSelectionOptions): UseTextSelectionResult {
  const {
    containerRef,
    pageFrames,
    scale = 1,
    reference,
    baselines,
    onSelectionChange,
    onClientRects,
  } = options;

  /** 当前选区 */
  const selectionRef = useRef<SelectionData | null>(null);

  /**
   * 几何计算的 **rAF 句柄**（节流用）。
   *
   * 拖动时 `selectionchange` 高频触发 → 合并到下一帧。
   */
  const geometryRafRef = useRef(0);

  /** 清原生选区的 rAF 句柄（延迟清除，见 `clearNativeSelection`） */
  const clearRafRef = useRef(0);

  /**
   * **拖动的起点**（视口坐标）。
   *
   * ## 为什么需要（实测踩过的坑）
   *
   * 真实 PDF（arXiv 论文）的页边戳是**逐字符竖排**的（`left=1231`，每行一个字符）。
   * 浏览器在选区时**按视觉行**把同一行的 inline box 一起选中 →
   * 页边戳的字符虽然 `left=1231`（离正文 1000px），却因为 `top` 相同
   * 被**一起选中**。
   *
   * 实测：拖选正文（x=175~445）→ 浏览器选区宽达 **1060px**！
   * ```
   * clientRects: [
   *   { l: 175.4, ... },   ← 正文
   *   { l: 1225.9, ... },  ← 页边戳（离正文 1000px）
   * ]
   * ```
   *
   * → 自绘层把页边戳也画出来 → 用户看到"选区横跨整页"。
   *
   * ## 修法
   *
   * 记住**鼠标按下和松开的位置** → 只保留**和拖动范围重叠**的矩形。
   * → 页边戳的字符和拖动范围不重叠 → 丢掉。
   */
  /*
   * ⚠️⚠️ **拖动起点 + 按下时的滚动量**（跨页选择的关键，实测踩到的坑）。
   *
   * ### 问题
   *
   * -> 跨页拖选时浏览器**自动滚动**（鼠标拖到容器外）❌
   * -> 滚动后**内容在视口里挪了** ❌
   *    -> 指针的 y 还是那个 y ❌
   *    -> 但**文字已经不在那个 y 上了** ❌
   *    -> -> 用"指针 y"过滤矩形 -> **把真正的文字全过滤掉了** ❌
   * -> 实测：按下时 y=494（页 1 最后一行），自动滚动后那行到了 y=350 ❌
   *    -> 过滤范围 [474, 706] -> **页 1 的正文全被丢掉** ❌
   *
   * ### 修法
   *
   * -> 记录**按下时的 scrollTop** ✅
   * -> 过滤时把起点的 y **加上滚动量** ✅
   *    -> 起点在**内容坐标**里就不会因为滚动而变 ✅
   */
  /*
   * ⚠️⚠️ **拖动起点 + 按下时的页码**（跨页选择的关键，实测踩到的坑）。
   *
   * ### 问题
   *
   * -> 跨页拖选时浏览器**自动滚动**（鼠标拖到容器外）❌
   * -> 滚动后**内容在视口里挪了** ❌
   *    -> 指针的 y 还是那个 y ❌
   *    -> 但**那个 y 现在指的是另一页**了 ❌
   *    -> -> 起点页算错 -> 页范围算错 -> 高亮落到错误的页 ❌
   *
   * ### 修法
   *
   * -> **按下那一刻**就把页码记下来 ✅
   * -> 之后不管怎么滚动，起点页都不变 ✅
   */
  const dragStartRef = useRef<{
    x: number;
    y: number;
    scrollTop: number;
    pageNumber: number | null;
  } | null>(null);
  /** 拖动的终点（视口坐标） */
  const dragEndRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);

  /**
   * **span 按页分组的缓存**（`collectPages` 用）。
   *
   * ⚠️ 旧实现每次都 `querySelectorAll`（518 个 span）+ 518 次 `intersectsNode`
   *    → 而 `collectPages` 在**每次 selectionchange** 都跑（拖动时 30 步跑 15 次）。
   *
   * → 缓存分组结果，DOM 变了才重建（用 MutationObserver 标脏）。
   */
  const pageSpanCacheRef = useRef<{
    byPage: Map<number, Element[]>;
    dirty: boolean;
  }>({ byPage: new Map(), dirty: true });

  /** 清除选区（并通知宿主） */
  const clearSelection = useCallback(() => {
    selectionRef.current = null;
    onSelectionChange?.(null);
  }, [onSelectionChange]);

  /**
   * 只清**包内部**的状态，**不通知宿主**。
   *
   * ⚠️ 什么时候用：
   * 宿主刚基于当前选区做了动作（比如"高亮"）→ 宿主**已经知道**选区没了
   * → 再发一次 `onSelectionChange(null)` 会把宿主刚显示的反馈**冲掉**
   *   （实测：demo 的"已高亮（pink）"被"选中 0 字"覆盖）。
   */
  const clearState = useCallback(() => {
    selectionRef.current = null;
  }, []);

  /**
   * 清掉浏览器原生选区。
   *
   * ⚠️⚠️ **绝不能用 `removeAllRanges()`**（实测踩过的坑）。
   *
   * ### 现象
   *
   * ```
   * 首次: 38 字符
   * 点高亮后重选: 0 字符      ← ❌ 之后再也选不中字了
   * selectionchange 事件: []  ← 浏览器**一个事件都没发**
   * ```
   *
   * ### 根因
   *
   * `removeAllRanges()` 把浏览器推进"**选区被程序改过**"的状态
   * → 浏览器认为"用户正在操作选区" → **后续的拖动被吞掉**
   *   （mousedown / mouseup 都触发，但**没有 selectionchange**）。
   *
   * ### 实测：清选的**方式**不重要，**时机**才重要
   *
   * ```
   * 在页面里直接调（不点按钮）:   removeAllRanges / collapseToStart → 重选 = 38  ✅
   * 在 click 处理器里调:          removeAllRanges / collapseToStart → 重选 = 0   ❌
   * ```
   *
   * → 差别是**点击那一刻**：点击会**移动焦点**（`<button>` 拿到焦点）
   * → 焦点在按钮上时，用户在正文里**无法开始新的文本选择**
   * → 所以必须**把焦点还给容器**。
   *
   * ### 修法（三件事一起做）
   *
   * 1. **下一帧**再清（rAF）→ 浏览器的事件循环回到"空闲"状态
   * 2. **用 `collapseToStart()`** 而不是 `removeAllRanges()`
   *    → 视觉上"没选中"（`toString()` 为空），但**不破坏浏览器的选区控制器**
   * 3. **把焦点还给容器**（容器有 `tabIndex={0}`）→ 后续能正常框选
   */
  const clearNativeSelection = useCallback(() => {
    if (clearRafRef.current !== 0) {
      cancelAnimationFrame(clearRafRef.current);
    }
    clearRafRef.current = requestAnimationFrame(() => {
      clearRafRef.current = 0;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }

      /*
       * ⚠️ **用 `collapseToStart()` 而不是 `removeAllRanges()`**。
       *
       * `removeAllRanges()` → 浏览器进入"选区被程序改过"状态
       * → **后续再也选不中字**（实测：重选 = 0，且没有 selectionchange 事件）。
       */
      try {
        selection.collapseToStart();
      } catch {
        // 某些浏览器在选区跨节点时可能抛错 → 退回 removeAllRanges
        selection.removeAllRanges();
      }

      /*
       * ⚠️⚠️ **把焦点还给容器**（关键！）。
       *
       * 点了"高亮"按钮 → 浏览器把焦点给了 `<button>`
       * → 焦点在按钮上时**无法开始新的文本选择**（实测：重选 = 0 字符）
       * → 把焦点移回容器 → 一切正常（实测：重选 = 38 字符）。
       *
       * ⚠️ 只在"焦点确实在按钮/输入框上"时才抢焦点
       *    → 否则会把用户正在用的输入框焦点抢走。
       */
      const active = document.activeElement;
      const activeTag = active?.tagName ?? '';
      if (activeTag === 'BUTTON' || activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        containerRef.current?.focus({ preventScroll: true });
      }
    });
  }, [containerRef.current?.focus]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    /**
     * 从 Range 收集涉及的页码。
     *
     * 用 `intersectsNode` 判断 span 是否被选中 ——
     * 这是"按文本层归属"的思路，不用猜 rect 属于哪一页。
     *
     * ⚠️⚠️ **性能**：这个函数在**每次 selectionchange** 都会跑（拖动时 30 步跑 15 次）。
     *
     * 旧实现每次都：
     * - `container.querySelectorAll('[data-page-number]')` → **518 个 span**
     * - 对每个 span 调 `range.intersectsNode(span)` → **518 次 DOM 查询**
     *
     * → 改成：**按页分组 + 缓存**。
     *   1. span 列表按 `data-page-number` 分组（缓存，DOM 变了才重建）
     *   2. **按页**判断 → 一旦某页命中就 `break`（不用遍历该页所有 span）
     */
    const collectPages = (range: Range): number[] => {
      const pages = new Set<number>();

      const cache = pageSpanCacheRef.current;
      if (cache.dirty) {
        cache.byPage = new Map();
        for (const span of container.querySelectorAll(`[${PAGE_NUMBER_ATTR}]`)) {
          const pageNumber = Number(span.getAttribute(PAGE_NUMBER_ATTR));
          if (!Number.isFinite(pageNumber)) {
            continue;
          }
          const list = cache.byPage.get(pageNumber) ?? [];
          list.push(span);
          cache.byPage.set(pageNumber, list);
        }
        cache.dirty = false;
      }

      /*
       * ⚠️⚠️ **只对"候选页"做 `intersectsNode`**（实测的性能优化）。
       *
       * 旧实现：逐页遍历该页的**每个 span** → 调 `range.intersectsNode(span)`
       * ```
       * 451 个 span × 每次 selectionchange → intersectsNode 要遍历 DOM 树 → 非常贵
       * ```
       *
       * → 优化：**先用矩形的位置粗筛**，只有候选页才做精确判断。
       *
       * ⚠️ **粗筛要用"缓存的页矩形"，不能每次 `getBoundingClientRect()`**
       *    → 那会**强制重排** → 比 `intersectsNode` 还贵（实测没提速）。
       *    → 页的位置在滚动/缩放时才变 → 用 `pageFrames` 推算。
       */
      /*
       * ⚠️ **防一手**（审核补测发现的健壮性问题）✅
       * -> `Range.getClientRects` 在某些环境里**不存在** ❌
       * -> 抛在 `selectionchange` 处理器里 ❌ -> **整个选区链断掉** ❌
       */
      if (typeof range.getClientRects !== 'function') {
        return [];
      }
      const rects = range.getClientRects();
      const candidates = new Set<number>();

      for (const rect of rects) {
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // 页的位置（视口坐标）：`pageFrames` 是内容坐标 → 换算成视口
        const containerRect = container.getBoundingClientRect();
        for (const frame of pageFrames) {
          const frameTop = containerRect.top + frame.top - container.scrollTop;
          const frameLeft = containerRect.left + frame.left;
          if (
            centerX >= frameLeft - 4 &&
            centerX <= frameLeft + frame.width + 4 &&
            centerY >= frameTop &&
            centerY <= frameTop + frame.height
          ) {
            candidates.add(frame.pageNumber);
          }
        }
      }

      // 候选页 → 用 intersectsNode 确认（准确，但只对少数候选页做）
      for (const [pageNumber, spans] of cache.byPage) {
        if (!candidates.has(pageNumber)) {
          continue;
        }
        for (const span of spans) {
          if (range.intersectsNode(span)) {
            pages.add(pageNumber);
            break;
          }
        }
      }

      /*
       * ⚠️ **兜底**：一个候选页都没命中 → 用老办法全查一遍。
       *
       * 什么时候会这样：选区跨到了**没渲染文字层的页**（虚拟滚动没渲染）
       * → 或者矩形判断漏了 → 宁可多查一次，也不能丢页。
       */
      if (pages.size === 0) {
        for (const [pageNumber, spans] of cache.byPage) {
          for (const span of spans) {
            if (range.intersectsNode(span)) {
              pages.add(pageNumber);
              break;
            }
          }
        }
      }

      return [...pages].sort((a, b) => a - b);
    };

    /**
     * **mouseup 处理**。
     *
     * ⚠️⚠️ **必须延后到下一帧再算**（实测踩过的坑，用户反馈"多行选择中间有的没有底色"）。
     *
     * ### 现象
     *
     * ```
     * 拖选多行 → 浏览器的最终选区有 21 个矩形（top = 232 / 378 / 381 / 385）
     *        → 但自绘层只有 8 个（top = 238 / 381 / 385）→ **378 那行（上下标）没了**
     * ```
     *
     * ### 根因：**时机**
     *
     * `mouseup` 事件处理器运行时，**浏览器的 Range 还没更新完**
     * → `range.getClientRects()` 只返回**当时的**矩形（实测只有 1 个）
     * → 我们按这个**残缺的**选区画了 → **部分行没底色**
     *
     * → 而且之后再没有 `selectionchange` 触发（选区已经稳定了）
     * → **残缺的状态被保留下来** ❌
     *
     * ### 修法
     *
     * - `mouseup` → **下一帧**再算（此时浏览器的 Range 已经稳定）
     * - 再加一个 **`setTimeout(0)` 兜底**（某些浏览器 rAF 仍然偏早）
     */
    const onMouseUp = () => {
      if (geometryRafRef.current !== 0) {
        cancelAnimationFrame(geometryRafRef.current);
      }
      geometryRafRef.current = requestAnimationFrame(() => {
        geometryRafRef.current = 0;
        // ⚠️ 再等一个宏任务 → 保证浏览器的 Range 完全稳定
        setTimeout(() => {
          if (!computeGeometry()) {
            clearSelection();
          }
        }, 0);
      });
    };

    /**
     * **几何计算**（选区矩形 + 选区数据）。
     *
     * ⚠️ 抽成独立函数是为了让 **mouseup** 和 **selectionchange** 都能调它 ——
     *    用户要求"鼠标一开始框选就出现浮层" → 不能只在 mouseup 才算。
     */
    const computeGeometry = (): boolean => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return false;
      }

      const range = selection.getRangeAt(0);
      const text = selection.toString();

      if (text.trim().length === 0) {
        return false;
      }

      /*
       * ⚠️ **选区必须在文本层（或页面）内**（不是选到了别的 DOM）。
       *
       * ⚠️⚠️ **不能用 `closest(TEXT_LAYER_CLASS)` 判定**！
       *
       * 实测（真实 PDF，跨行拖选）：
       * ```
       * range.commonAncestorContainer = .scpdf-page     ← 不是 textLayer!
       * ancEl.closest('.scpdf-text-layer') = null
       * ```
       *
       * 原因：选区跨了**多个 text layer**（每行/每个 span 一个 layer 结构），
       * 或跨了页面的其他子元素 → 共同祖先是 **page**，不是 textLayer。
       *
       * 旧写法直接 `clearSelection()` 放弃 →
       * **自绘选区层完全没有数据** → 用户看到的是**浏览器原生选区**
       *   （就是那个"一大块"！用户截图里就是这个）
       *
       * → 改成：只要祖先里有文本层（或自己在页面里）就算合法。
       */
      const anchorElement =
        range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      if (!anchorElement) {
        return false;
      }
      const inTextLayer = !!anchorElement.closest(TEXT_LAYER_CLASS);
      const inPage = !!anchorElement.closest(PAGE_CLASS);
      /*
       * ⚠️⚠️ **跨页选区：共同祖先是"页容器"，不是某一页**（实测踩过的坑）。
       *
       * ```
       * 单页选区: commonAncestorContainer = .scpdf-page      ✓
       * 跨页选区: commonAncestorContainer = .scpdf-pages     ← 既不是 page 也不是 textLayer！
       * ```
       * → 旧逻辑 `if (!inTextLayer && !inPage) return false;` → **跨页选区直接被丢弃**
       * → 用户看到的现象："**没法跨页选择**"（浏览器选中了 2553 字，但自绘层是空的）。
       *
       * → 补上第三种情况：**在页容器里**（`.scpdf-pages`）也算合法。
       */
      const inPagesContainer = !!anchorElement.closest(PAGES_CONTAINER_CLASS);
      if (!inTextLayer && !inPage && !inPagesContainer) {
        return false;
      }

      const pages = collectPages(range);
      if (pages.length === 0) {
        return false;
      }

      /**
       * 取选区的 client rects。
       *
       * ⚠️ **必须用 `range.getClientRects()`，不能自己按 PDF 几何算**：
       * 浏览器知道 fallback 字体的实际排版（字距、kerning、连字），
       * 我们不知道。pdf.js 的 v6 `DrawLayer.#selectionChange()` 也是这么做的。
       *
       * 注意：`getClientRects()` 会返回**每个行盒**一个 rect，
       * 也可能包含**整页**的 rect（宽高都等于页面）——
       * 这种情况要保留（老 scholar-club 用 `width < pageRect.width` 过滤掉了，
       * 导致"选整页时选区丢失"）。
       */
      const rects: { top: number; left: number; width: number; height: number }[] = [];
      if (typeof range.getClientRects !== 'function') {
        return false;
      }
      for (const clientRect of range.getClientRects()) {
        if (clientRect.width > 0 && clientRect.height > 0) {
          rects.push({
            top: clientRect.top,
            left: clientRect.left,
            width: clientRect.width,
            height: clientRect.height,
          });
        }
      }

      if (rects.length === 0) {
        return false;
      }

      /*
       * ⚠️ **过滤掉"旋转文字"的矩形**。
       *
       * 真实 PDF 实测（arXiv 论文）：页边戳是 `transform: rotate(-90deg)` 的竖排文字。
       * 浏览器给它的 rect 是 `h=829`（**整页高**）→ 自绘层会画出一大块。
       *
       * 判据：矩形高度 > 页面高度的 1/3 → 一定是旋转/异常项。
       * （正常文字行的高度 ≈ 字号 × 1.2，永远不会超过页高的 1/3）
       */
      const tallestPage = pageFrames.reduce((max, f) => Math.max(max, f.height), 0);
      const maxNormalHeight = tallestPage > 0 ? tallestPage / 3 : Infinity;

      const usable = rects.filter((r) => r.height <= maxNormalHeight);

      /*
       * ⚠️⚠️ **补上浏览器漏掉的矩形**（实测踩过的坑，用户截图）。
       *
       * ### 现象
       *
       * ```
       * 浏览器原生 rects: 605,381 8x17 / 613,381 5x17 / 637,385 149x23 …
       * 被选中的 span:    787,381 8x17   ← "Zhang*" 的星号
       * ```
       *
       * → `range.intersectsNode(span)` 说这个 span **被选中了**
       * → 但浏览器的 `getClientRects()` **没有给它任何矩形**
       * → 自绘层就**漏掉了这一小块** → 用户看到"**中间有的没有底色**" ❌
       *
       * ### 根因
       *
       * 浏览器在选区**边界**处的处理很微妙：
       * 当 Range 的边界正好落在某个 span 的边缘时，
       * 浏览器可能只把它算进 `intersectsNode`，却**不产生** client rect。
       *
       * ### 修法
       *
       * **用文字 span 自己的几何补齐**：
       * - 找出所有 `intersectsNode` 为真的 span
       * - 找出那些**没有对应 client rect** 的 span
       * - 用它的 `getBoundingClientRect()` **合成一个矩形**
       *
       * → 我们本来就有每个字的确切位置（文本层）→ 补出来的矩形**比浏览器的更准**。
       */
      const rectsWithGaps = fillMissingRects(usable, range, container);

      /*
       * ⚠️⚠️ **丢掉"另一列"的矩形**（实测踩过的坑）。
       *
       * 真实 PDF（arXiv 论文）的页边戳是**逐字符竖排**的（`left=1231`）。
       * 浏览器按**视觉行**选中同一行的所有 inline box →
       * 页边戳的字符虽然离正文 1000px，`top` 却和正文行相同 → **被一起选中**。
       *
       * 实测：拖选正文（x=175~445）→ 浏览器选区宽达 **1060px**。
       *
       * → 用**水平连续性**判断：把矩形按水平区间合并成"段"，
       *   只保留**和鼠标按下位置同一段**的那些矩形。
       *   （页边戳和正文之间有 780px 的空洞 → 不同段 → 丢掉。）
       *
       * ⚠️ **只在有拖动起点时生效**（没有起点就用全部）。
       */
      /*
       * ⚠️⚠️ **垂直过滤必须在【内容坐标】里做**（实测踩到的坑）✅
       *
       * ### 问题
       *
       * -> 跨页拖选时浏览器**自动滚动**（鼠标拖到容器外）❌
       * -> 滚动后 Range 被**向前扩展到页首** ❌
       *    -> 选区长度 **1726** 字符（本来只有 ~84）❌
       *    -> 页 1 的**页眉**（"上海人工智能实验室"）也被选中了 ❌
       * -> -> 高亮全落在**第 1 页** ❌
       *    -> 用户反馈："第二页的内容也高亮到了第一页" ✅
       *
       * ### 为什么"视口坐标"不行
       *
       * -> 矩形是**当前**视口坐标（自动滚动**之后**）✅
       * -> 拖动起点是**按下那一刻**的视口坐标 ✅
       * -> 两者**不在同一个坐标系** ❌ -> 过滤全错 ❌
       *
       * ### 修法
       *
       * -> 全部换算到**内容坐标**（相对容器内容原点）✅
       *    -> 矩形：\`rect.top - 容器视口top + 当前 scrollTop\` ✅
       *    -> 起点：\`按下时的 y - 容器视口top + 按下时的 scrollTop\` ✅
       * -> -> 自动滚动**不影响**判断 ✅
       */
      const contentRect = container.getBoundingClientRect();
      const dragStart = dragStartRef.current;
      const dragEnd = dragEndRef.current;

      /** 视口坐标 -> 内容坐标 */
      const toContentY = (y: number, scrollTop: number): number => y - contentRect.top + scrollTop;

      /*
       * ⚠️⚠️⚠️ **【核心】按【文档顺序】裁剪** ✅
       *
       * ## 为什么是它
       *
       * -> 浏览器原生选区**本来就是**文档顺序的连续区间 ✅
       *    （pdf.js 直接用 `::selection` ✅ -> 完全不过滤 ✅）
       * -> 我们的文本层保持 **PDF 原始顺序** ✅（= 文本流顺序 ✅）
       * -> -> 所以"用户选了哪一段"**用项序判断最准** ✅ ✅
       *
       * ## 它解决【反向选择】✅
       *
       * -> 浏览器的 Range 永远 `start < end` ✅（**按文档顺序** ✅）
       * -> 反向拖（右栏 -> 左栏 ✅）时 ✅ 浏览器会**归一化方向** ✅
       * -> -> 纯几何判断（只看 y ✅）会把**边界项**丢掉 ✅ ❌
       *    -> 实测：丢的永远是**起点项**和**终点项** ✅
       * -> -> 按文档顺序判断 ✅ -> 反向自动对称 ✅ ✅
       *
       * ## ⚠️ **它只决定"哪些项"，不决定矩形精度** ✅
       *
       * -> 矩形精度来自 **Range 的矩形** ✅（**字符级** ✅）
       * -> ⚠️ 用项的矩形会**整块涂上** ✅ ❌（实测：选 1 个字 -> 涂 21 个字 ✅）
       */
      const domOrderItems = collectDomOrderItems(container, range);
      const domOrder = clipByDomOrder({
        items: domOrderItems.items,
        start: domOrderItems.start,
        end: domOrderItems.end,
      });

      /*
       * ⚠️⚠️ **把 Range 的【字符级矩形】分配给保留的项** ✅
       *
       * -> `domOrder.kept` 里的矩形是**项级** ✅ -> 不能直接画 ✅
       * -> -> 用 Range 的字符级矩形 ✅ 按中心点归属到各项 ✅
       * -> -> 某项没分到 ✅ -> 回退到该项自己的矩形 ✅
       *
       * ⚠️⚠️ **必须按【项】分组** ✅ 不能按数组下标 ✅
       * -> 一个 span 给**多个 rect** ✅（行盒 + 字形盒 ✅）
       * -> -> `kept` 和 `keptItems` **长度不同** ✅ ❌
       * -> -> 按下标对应会**错位** ✅
       *    -> 实测：项漏选 ✅（"T cells and demonstrates" 没底色 ✅ ❌）
       */
      const assigned = groupRectsByItem(domOrder.kept, domOrder.keptItems, rectsWithGaps);

      const charLevelRects = domOrder.keptItems.flatMap((item, i) => {
        const key = `${item.pageNumber}:${item.itemIndex}`;
        const sub = assigned.get(key);
        if (sub && sub.length > 0) {
          return sub;
        }
        // ⚠️ **没分到 -> 回退项级** ✅（保守 ✅）
        const itemRect = domOrder.kept[i];
        return itemRect ? [itemRect] : [];
      });

      /*
       * ⚠️ **换算到【内容坐标】** ✅
       *
       * -> 后面所有步骤（垂直过滤 ✅ / 提取 ✅）都在**内容坐标**里做 ✅
       * -> 这里换算一次 ✅（**只换一次** ✅）
       */
      const contentRects = charLevelRects.map((r) => ({
        top: toContentY(r.top, container.scrollTop),
        left: r.left,
        width: r.width,
        height: r.height,
      }));

      /*
       * ⚠️⚠️⚠️ **垂直范围必须是【双向区间】** ✅（实测踩到的坑 ✅）
       *
       * ## 旧写法错在哪 ✅
       *
       * ```ts
       * // ❌ 只保留下界 ✅
       * const fromY = toContentY(dragStart.y, dragStart.scrollTop) - VERTICAL_TOLERANCE;
       * return r.top + r.height > fromY;
       * ```
       *
       * -> 那个结论**只在"往下拖"时成立** ✅
       * -> **往上拖**时 ✅ -> 起点 y 成了下界 ✅
       *    -> **比起点高的行全被丢掉** ✅ ❌
       *    -> 实测（页 3 ✅ 跨栏 ✅）：
       *       `afterDomOrder: 172` ✅（= Chrome ✅）
       *       `afterVertical: 96` ✅ ❌ -> **砍掉 76 个** ✅
       *    -> 用户反馈："**第二栏的上面部分都没被选中**" ✅ ❌
       *
       * ## Chrome 的语义 ✅
       *
       * -> 选区 = **DOM 顺序上起点→终点的连续区间** ✅
       * -> 与上下方向**无关** ✅
       * -> 往上拖 ✅ -> 保留**上面**的部分 ✅
       *
       * ## 修法 ✅
       *
       * -> 用**起点和终点的内容坐标**算出**上下界** ✅
       * -> 起点：`按下时的 y + 按下时的 scrollTop` ✅（固定 ✅）
       * -> 终点：`松手时的 y + 松手时的 scrollTop` ✅（`dragEndRef` 里记了 ✅）
       * -> 全部在**内容坐标**里算 ✅ -> **自动滚动不影响** ✅
       */
      const verticalRange = (() => {
        if (!dragStart || !dragEnd) {
          return null;
        }
        const startY = toContentY(dragStart.y, dragStart.scrollTop);
        const endY = toContentY(dragEnd.y, dragEnd.scrollTop);
        return {
          fromY: Math.min(startY, endY) - VERTICAL_TOLERANCE,
          toY: Math.max(startY, endY) + VERTICAL_TOLERANCE,
        };
      })();

      /*
       * ⚠️⚠️⚠️ **垂直过滤【只在自动滚动时】才生效** ✅（实测踩到的坑 ✅）
       *
       * ## 为什么不能一直生效 ✅
       *
       * -> 浏览器的 Range 是**文档顺序的连续区间** ✅
       * -> -> 跨栏拖选时 ✅ Range 会**跨过很多视觉行** ✅
       *    -> 实测（页 3 ✅）：鼠标只经过 2 个视觉行 ✅
       *    -> 但 Chrome 选中了 **44 个视觉行 / 172 个项** ✅ ✅
       * -> -> 用鼠标的 y 做过滤 ✅ -> 会把绝大部分**正确内容**砍掉 ✅ ❌
       *    -> 实测：`afterDomOrder: 172` ✅ -> `afterVertical: 66` ✅ ❌
       *
       * ## 垂直过滤的【唯一】用途 ✅
       *
       * -> 跨页拖选时浏览器**自动滚动** ✅
       * -> -> Range 被**向前扩展到页首** ✅
       *    -> 页 1 的**页眉**也被选中了 ✅ -> 高亮全落在第 1 页 ✅ ❌
       * -> -> 这时候才需要过滤 ✅ ✅
       *
       * ## 怎么判断"发生了自动滚动" ✅
       *
       * -> **起点和终点的 `scrollTop` 不一样** ✅ -> 说明中途滚动了 ✅
       * -> 没滚动 ✅ -> 区间就是鼠标划过的范围 ✅ -> 不用过滤 ✅ ✅
       *
       * -> ⚠️ 实测：跨栏拖选时 ✅ 起点终点 `scrollTop` **相同** ✅
       *    -> -> 不用垂直过滤 ✅ -> 内容完整保留 ✅ ✅
       */
      const didAutoScroll =
        dragStart && dragEnd ? dragStart.scrollTop !== dragEnd.scrollTop : false;

      const verticalKept =
        verticalRange && didAutoScroll
          ? contentRects.filter((r) => {
              /*
               * -> 双向 ✅
               * -> 跨页时浏览器**自动滚动** ✅ -> Range 被**向前扩展到页首** ✅
               *    -> 页 1 的**页眉**也被选中了 ✅ -> 高亮全落在第 1 页 ✅ ❌
               * -> -> 上下界把它挡在外面 ✅ ✅
               */
              return r.top + r.height > verticalRange.fromY && r.top < verticalRange.toY;
            })
          : contentRects;

      /*
       * ⚠️ **剔除离群项** ✅（整页矩形 ✅ / 旋转文字 ✅ / 竖排页边戳 ✅）
       *
       * -> 跨页时浏览器会给一个**整页**的矩形 ❌
       *    -> 它的水平范围覆盖整页 -> 会把**真正的正文**一起带出来 ❌
       */
      const outliers = filterOutliers({
        rects: verticalKept,
        pageHeight: tallestPage > 0 ? tallestPage : undefined,
      });

      const withDragOrigin = outliers.kept;

      /*
       * ⚠️ **换回【视口坐标】**（自绘层和提取都用视口坐标）✅
       */
      const withDragOriginInViewport = withDragOrigin.map((r) => ({
        top: r.top + contentRect.top - container.scrollTop,
        left: r.left,
        width: r.width,
        height: r.height,
      }));

      /*
       * 原始形状给自绘选区层（保留每个 client rect 的细节）。
       * 全部异常时传空数组 → 自绘层清空（宁可漏画，也不要画出一大块）。
       */
      onClientRects?.(withDragOriginInViewport.length > 0 ? withDragOriginInViewport : []);

      /**
       * 坐标系统一（⚠️ 这里曾经有个双重扣减的 bug）：
       *
       * - `getClientRects()` 返回的是**视口坐标**（相对浏览器窗口）
       * - `pageFrames` 的 `top` 是**滚动内容坐标**（相对容器内容的原点）
       *
       * 两者要相减，必须先换算到**同一个坐标系**。
       * 这里统一换算到「**容器内容坐标**」（滚动内容坐标系）：
       *
       * ```
       * 容器内容坐标 = 视口坐标 - 容器视口原点 + scrollTop
       * ```
       *
       * ❌ 之前的写法：rect 减了 containerRect.top，frames 也减了 containerRect.top
       *    → containerRect.top 被减了两次 → 页内坐标偏了 containerRect.top
       *    → 实测高亮偏 97px（正好是容器的视口 top）
       */
      const containerRect = container.getBoundingClientRect();

      const frames: PageFrame[] = pageFrames.map((frame) => ({
        pageNumber: frame.pageNumber,
        // pageFrames 已经是滚动内容坐标，**不用再减 containerRect.top**
        top: frame.top,
        left: frame.left,
        width: frame.width,
        height: frame.height,
      }));

      /*
       * ⚠️⚠️ **起点页 ~ 终点页**（跨页选择的过滤范围）✅
       *
       * -> 拖动的起点在**哪一页** ✅
       * -> 拖动的终点在**哪一页** ✅
       * -> -> 只有这两页之间的矩形才该保留 ✅
       *
       * -> ⚠️ **不能只看起点页** ❌
       *    -> 起点在页 1、终点在页 2 -> 只保留页 1 的话页 2 的内容没了 ❌
       * -> ⚠️ **也不能只看终点页** ❌
       *    -> 同理 ❌
       */

      /*
       * ⚠️⚠️ **必须用【过滤后】的矩形**（实测踩到的坑）。
       *
       * -> 之前用的是**原始的 `rects`** ❌
       * -> 过滤结果**只喂给了自绘层** ❌
       *    -> 自绘的选区是对的 ✅
       *    -> 但**提取出来的高亮**用的是原始矩形 ❌
       *    -> 跨页时原始矩形包含**整页** -> 高亮全落在第 1 页 ❌
       * -> 用户反馈："跨页选择高亮的时候 实测只能高亮第一页的内容
       *   第二页的内容也高亮到了第一页" ✅
       */
      /*
       * ⚠️⚠️ **必须用【过滤后】的矩形**（实测踩到的坑）。
       *
       * -> 之前用的是**原始的 `rects`** ❌
       * -> 过滤结果**只喂给了自绘层** ❌
       *    -> 自绘的选区是对的 ✅
       *    -> 但**提取出来的高亮**用的是原始矩形 ❌
       *    -> 跨页时原始矩形包含**页眉** -> 高亮落在错误的页 ❌
       */
      /*
       * ⚠️⚠️ **提取要用【内容坐标】的矩形**（实测踩到的坑）✅
       *
       * -> 过滤是在**内容坐标**里做的 ✅
       * -> -> 提取时**不能再换算一次** ❌（双重换算 -> 位置全错）❌
       * -> -> 直接用过滤后的**内容坐标** ✅
       */
      const filteredRects = withDragOrigin.length > 0 ? withDragOrigin : contentRects;
      if (typeof window !== 'undefined') {
        (window as unknown as { __dbgR?: unknown }).__dbgR = {
          /*
           * ⚠️⚠️ **每一级都要单独记** ✅
           * -> 之前 `raw` / `filtered` 语义混在一起 ✅ -> 排查时极易误判 ✅
           * -> 现在**每一级都单独记** ✅ -> 一眼看出是哪一级丢的 ✅
           */
          browserRects: rects.length,
          afterDomOrder: domOrder.kept.length,
          afterCharLevel: charLevelRects.length,
          afterVertical: verticalKept.length,
          afterOutlier: outliers.kept.length,
          final: filteredRects.length,
          raw: rects.length,
          filtered: filteredRects.length,
          /* 文档顺序裁剪的诊断信息 ✅ */
          dom: describeDomOrder({
            items: domOrderItems.items,
            start: domOrderItems.start,
            end: domOrderItems.end,
          }),
          /* 垂直范围（双向区间）-> 排查"往上拖丢内容"时必须能看到 */
          verticalRange,
          /* 是否发生了自动滚动（决定垂直过滤是否生效 ✅）*/
          didAutoScroll,
          /* 离群项统计 ✅ */
          outlierTooTall: outliers.tooTall,
          outlierHorizontal: outliers.tooFarHorizontally,
          rawMinTop: Math.min(...rects.map((r) => r.top)),
          rawMaxTop: Math.max(...rects.map((r) => r.top)),
          filtMinTop: Math.min(...filteredRects.map((r) => r.top)),
          filtMaxTop: Math.max(...filteredRects.map((r) => r.top)),
          dragY: dragStartRef.current?.y,
          dragObj:
            dragStartRef.current && dragEndRef.current
              ? {
                  startX: dragStartRef.current.x,
                  endX: dragEndRef.current.x,
                  startY: dragStartRef.current.y,
                  endY: dragEndRef.current.y,
                }
              : null,
        };
      }

      const result = extractSelection({
        text,
        /*
         * ⚠️ **已经是内容坐标了**（过滤时换算过了）✅
         * -> 这里**不要再换算** ❌（双重换算 -> 位置全错）❌
         */
        rects: filteredRects.map((rect) => ({
          top: rect.top,
          /*
           * ⚠️⚠️ **水平不要加 `scrollLeft`**（实测踩过的坑）。
           *
           * `pageFrames.left`（= `pageLeft`）是**视口相对**的 X
           * → 这里也必须是**同一个坐标空间** → **不加 scrollLeft**
           *
           * 垂直**要加** `scrollTop`（`toContentCoords` 里加了）
           * → 因为 `pageFrames.top` 是**滚动内容坐标**（页在文档里的位置）。
           *
           * → 水平和垂直的坐标空间**本来就不一样**（一个是视口相对，一个是内容相对）
           *    → 各自和 `pageLeft` / `pageTop` 对齐即可。
           */
          left: rect.left - containerRect.left,
          width: rect.width,
          height: rect.height,
        })),
        pages: frames,
        /*
         * ⚠️⚠️ **只保留【起点页 ~ 终点页】**（跨页选择的关键）✅
         *
         * -> 浏览器在自动滚动后把 Range **扩展到页首** ❌
         *    -> 页 1 的页眉也被选中了 ❌
         * -> -> 只保留起点页和终点页之间的 ✅
         *    -> 页 1 的页眉被丢掉 ✅
         *    -> 页 2 的内容保留 ✅
         *    -> 用户反馈："第二页的内容也高亮到了第一页" ✅
         */
        /*
         * ⚠️ **不用 pageRange** ✅
         *
         * -> 垂直过滤（内容坐标）已经**精确**了 ✅
         * -> pageRange 会因为自动滚动**算错**（终点页会偏）❌
         */
        scale,
        reference,
        // 裁剪成贴合字形
        baselines,
      });

      if (!result) {
        return false;
      }

      selectionRef.current = result;
      onSelectionChange?.(result);
      return true;
    };

    /**
     * selectionchange：① 实时算几何（拖动中就出选区块 + 浮层）② 挪哨兵。
     *
     * ## ① 为什么要在 selectionchange 里算几何
     *
     * 用户要求："我需要鼠标开始框选之后立刻出现浮层"。
     *
     * 旧实现只在 **mouseup** 算 → 拖动全程零反馈 → 手感"巨卡"
     * （实测：按住拖动 900ms，浮层和选区块都是 0 个）。
     *
     * pdf.js v6 的 `DrawLayer.#selectionChange()` 也是在 `selectionchange`
     * 里实时画选区的 → 我们之前只抄了一半。
     *
     * ## ② 哨兵
     *
     * **为什么需要**（pdf.js 的 `text_layer_builder.js` 也有）：
     * 在 Chrome/Safari 里，用户在**页面空白处**点击或拖动时，
     * 选区会一路扩到文本层的末尾（选出一大片空白）。
     * 把哨兵挪到选区边界旁 → 选区不会越过它。
     *
     * ⚠️ **这里曾经抛 `NotFoundError` 导致整页消失**：
     * `insertBefore(newNode, referenceNode)` 要求 `referenceNode` 是
     * `newNode.parentElement` 的子节点，否则浏览器抛
     * "The node before which the new node is to be inserted is not a child of this node"。
     *
     * 缩放时 React 会重建所有 span（key 含位置 → 全变），
     * `endContainer.nextSibling` 可能指向**另一个 parent** 的节点 → 抛错。
     * 异常在事件处理器里未捕获 → React 错误边界 unmount 整棵树 → **页面消失**。
     */
    const onSelectionChangeEvent = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      /*
       * ⚠️⚠️ **实时算几何**（拖动中就出选区块 + 浮层）。
       *
       * ⚠️ **必须 rAF 节流**：
       * 拖动时 `selectionchange` 会高频触发（实测 30 步触发 15 次），
       * 每次都重算 + setState → 会掉帧。
       * → 合并到下一帧，最多一帧一次。
       */
      if (geometryRafRef.current === 0) {
        geometryRafRef.current = requestAnimationFrame(() => {
          geometryRafRef.current = 0;
          computeGeometry();
        });
      }

      const range = selection.getRangeAt(0);
      const anchor = range.startContainer;
      const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
      const textLayer = anchorElement?.closest(TEXT_LAYER_CLASS);
      if (!textLayer) {
        return;
      }

      // 找到该文本层的哨兵
      const end = textLayer.querySelector(END_OF_CONTENT_CLASS);
      if (!(end instanceof HTMLElement)) {
        return;
      }

      // 哨兵跟着选区的结束边界走
      const endContainer =
        range.endContainer instanceof Element
          ? range.endContainer
          : range.endContainer.parentElement;
      if (!endContainer) {
        return;
      }

      const parent = endContainer.parentElement;
      if (!parent) {
        return;
      }

      /*
       * ⚠️ **跨页选择时不能搬哨兵**：
       * 选区可能从第 1 页跨到第 2 页 → `endContainer` 在**另一页**的文本层里。
       * 之前会把哨兵搬到那一页 → 第 1 页的哨兵丢失、第 2 页多一个
       * （实测 `endStillInL1: false`）→ 哨兵彻底失去意义。
       *
       * 每页各有自己的哨兵 → 只在**选区所在的那一页**内移动。
       */
      if (!textLayer.contains(endContainer)) {
        return;
      }

      /*
       * ⚠️ **不要移动 DOM 节点**（性能 + 稳定性）。
       *
       * 旧写法：`parent.insertBefore(end, reference)` —— 每次 `selectionchange`
       * 都把哨兵在 DOM 里挪一次：
       * - 触发整个 text layer 重排
       * - `reference` 可能不属于同一 parent → 抛 `NotFoundError` → 整页消失
       *
       * 改成：**只改 `style.top`**（绝对定位元素改 top → **只重绘，不重排**），
       * DOM 结构保持不变 → 不会抛错，也不会重排。
       *
       * ⚠️ 目标位置必须**自己算**（不能用哨兵自己的 `getBoundingClientRect()`，
       *    那是它**当前**的位置 → 永远算不出新位置）。
       *    用选区下边界：哨兵放在选区底部往下一点 → 用户继续往下拖时选区到此为止
       *    （这正是 pdf.js 哨兵的用途）。
       */
      /*
       * 目标位置 = **选区结束边界**的下一行起点。
       *
       * ⚠️ 不能用哨兵自己的 `getBoundingClientRect()`（那是它**当前**的位置，
       *    永远算不出新位置 —— 会一直停在页底）。
       *
       * 用 `range.getBoundingClientRect()` 的下边界：
       * 哨兵放到选区底部**往下一点** → 用户继续往下拖时，选区到此为止
       * （这正是 pdf.js 哨兵的用途：防止选区一路扩到文本层末尾）。
       */
      /*
       * ⚠️⚠️ **必须防一手**（审核补测发现的健壮性问题）。
       *
       * -> `range.getBoundingClientRect()` **在某些环境里【不存在】** ❌
       *    （jsdom 的 `Range` 上就没有 ✅ -> 实测直接抛 `TypeError` ❌）
       * -> -> 抛在 `selectionchange` 的处理器里 ❌
       *    -> **整个选区处理链断掉** ❌ -> 选区"卡住" ❌
       * -> -> 而且这类异常**没人接** ❌ -> 变成 unhandled error ❌
       *
       * -> 哨兵只是"辅助"功能（防止选区扩到文本层末尾）✅
       *    -> 算不出来就**跳过** ✅（不影响主功能 ✅）
       */
      if (typeof range.getBoundingClientRect !== 'function') {
        return;
      }
      const rangeRect = range.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const offsetY = rangeRect.bottom - parentRect.top + 1;

      // 位置没变就别写（避免无谓的样式失效）
      if (end.dataset.scpdfOffsetY !== String(offsetY)) {
        end.dataset.scpdfOffsetY = String(offsetY);
        end.style.top = `${offsetY}px`;
      }
    };

    /*
     * ⚠️⚠️ **mouseup 必须监听在 `document` 上**（实测踩过的坑）。
     *
     * 之前监听在**容器**上 → 实测**根本没触发**（拖动结束时鼠标已经不在容器里了）
     * → `computeGeometry` 永远停留在 `selectionchange` 的那一次
     * → 而那一次的 Range **还没稳定**（只有 1 个矩形）
     * → **多行选择时中间的行没底色** ❌（用户截图）
     *
     * → 监听在 `document` → 一定能收到 → 再延后一帧算 → 拿到**完整**的选区。
     */
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChangeEvent);

    /*
     * ⚠️ **记住拖动的起点**（用于过滤"另一列"的矩形）。
     *
     * 见 `core/selection/dom-order.ts` 的说明。
     *
     * → 在**容器**上监听（不是 document）→ 点容器外的按钮不算拖动。
     * → 只在**文本层内**按下才算（否则点工具栏也会被记成起点）。
     */
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(TEXT_LAYER_CLASS)) {
        /*
         * ⚠️ **记下按下时的滚动量** ✅
         *
         * -> 之后自动滚动 -> 用滚动量把起点"翻译"回内容坐标 ✅
         */
        const scrollTop = container.scrollTop;
        /*
         * ⚠️ **记下按下时所在的页码** ✅
         *
         * -> 自动滚动之后，"那个 y" 已经不是同一页了 ❌
         * -> 按下时算一次，**之后不再变** ✅
         */
        const pageNumber = pageOfPoint(
          event.clientY,
          pageFrames.map((frame) => ({
            pageNumber: frame.pageNumber,
            top: frame.top,
            left: frame.left,
            width: frame.width,
            height: frame.height,
          })),
          container.getBoundingClientRect(),
          scrollTop,
        );
        dragStartRef.current = { x: event.clientX, y: event.clientY, scrollTop, pageNumber };
        dragEndRef.current = { x: event.clientX, y: event.clientY, scrollTop };
      } else {
        dragStartRef.current = null;
        dragEndRef.current = null;
      }
    };
    container.addEventListener('mousedown', onMouseDown);

    /*
     * ⚠️ **拖动过程中也要更新终点**（但要**节流**）。
     *
     * → `selectionchange` 在拖动中就会触发 → 那时终点还在变
     * → 不用等 mouseup（否则拖动时的浮层位置会不对）。
     *
     * ⚠️⚠️ **必须用 rAF 节流**（实测踩过的坑）。
     *
     * `mousemove` 在拖动时能到 **100+ 次/秒** → 每次都跑一次监听器
     * → 加上 `selectionchange` 的处理 → **p95 从 17ms 涨到 31ms**
     * → 用户能感觉到拖动变卡。
     *
     * → 只在**下一帧**记一次（拖动时 60fps 足够）。
     */
    let moveRaf = 0;
    let moveX = 0;
    let moveY = 0;
    const onMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) {
        return;
      }
      moveX = event.clientX;
      moveY = event.clientY;
      if (moveRaf !== 0) {
        return;
      }
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        if (dragStartRef.current) {
          /*
           * ⚠️⚠️ **y 要用【真实的终点】**（实测踩到的坑）。
           *
           * -> 之前写的是 `y: dragStartRef.current.y` ❌
           *    -> 终点 y **永远是起点 y** ❌
           *    -> 垂直过滤的范围变成"一个点" ❌
           *    -> -> 跨页高亮全落在第 1 页 ❌
           * -> 现在用**真实的鼠标 y** ✅
           */
          dragEndRef.current = { x: moveX, y: moveY, scrollTop: container.scrollTop };
        }
      });
    };
    container.addEventListener('mousemove', onMouseMove, { passive: true });

    /*
     * ⚠️ **span 缓存的失效信号**。
     *
     * 页面渲染/卸载（虚拟滚动、缩放）会增删文本层 span
     * → 缓存的分组就过时了 → 标脏 → 下次重建。
     *
     * 用 MutationObserver（比在每次 selectionchange 里重新 querySelectorAll 便宜得多）。
     */
    const spanObserver = new MutationObserver(() => {
      pageSpanCacheRef.current.dirty = true;
    });
    spanObserver.observe(container, { childList: true, subtree: true });

    return () => {
      spanObserver.disconnect();
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      if (moveRaf !== 0) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
      }
      document.removeEventListener('selectionchange', onSelectionChangeEvent);
      document.removeEventListener('mouseup', onMouseUp);
      if (geometryRafRef.current !== 0) {
        cancelAnimationFrame(geometryRafRef.current);
        geometryRafRef.current = 0;
      }
      /*
       * ⚠️ **不要在这里取消 `clearRafRef`**！
       *
       * 这个 effect 的依赖里有 `pageFrames` / `onSelectionChange` / `onClientRects`
       * → 任何一次重渲染都可能让 effect **重跑** → cleanup 执行。
       *
       * 而"清原生选区"的 rAF 是在**动作完成时**排的，紧接着 `setState` 就会重渲染
       * → cleanup 把它取消掉 → **原生选区永远清不掉**（实测：len 一直是 38）。
       *
       * → rAF 的取消放到**卸载时**单独处理（见下面的 `useEffect`）。
       */
    };
  }, [
    containerRef,
    pageFrames,
    scale,
    reference,
    baselines,
    onSelectionChange,
    onClientRects,
    clearSelection,
  ]);

  /*
   * **卸载时**才取消"清原生选区"的 rAF。
   *
   * ⚠️ 不能放在上面那个 effect 的 cleanup 里：
   *    那个 effect 的依赖（`pageFrames` / `onSelectionChange` / …）会随重渲染变化
   *    → cleanup 会把**还没执行**的清除操作取消掉
   *    → 原生选区永远清不掉（实测：len 一直是 38）。
   *
   * → 单独一个 `[]` 依赖的 effect → **只在真正卸载时**跑。
   */
  useEffect(
    () => () => {
      if (clearRafRef.current !== 0) {
        cancelAnimationFrame(clearRafRef.current);
        clearRafRef.current = 0;
      }
    },
    [],
  );

  /*
   * ⚠️ **返回值必须稳定**（用 `useMemo` 包）。
   *
   * 否则每次渲染都返回**新对象** → 依赖它的 `useCallback` / `useEffect` 每次都变
   * → **effect 每次渲染都重跑** → 观察器被反复重建 → 状态丢失。
   */
  return useMemo(
    () => ({ clearSelection, clearState, clearNativeSelection }),
    [clearSelection, clearState, clearNativeSelection],
  );
}
