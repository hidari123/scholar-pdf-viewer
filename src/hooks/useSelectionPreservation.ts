/**
 * useSelectionPreservation —— **缩放后保持选区**。
 *
 * ## 为什么需要
 *
 * 用户实测反馈："缩放的时候浮层没跟着一起缩放"、"缩小之后选择跑偏很厉害"。
 *
 * 实测根因：**缩放会销毁浏览器选区**。
 *
 * ```
 * 缩放前: selection = { len: 199, collapsed: false }
 * 缩放后: selection = { len: 0,   collapsed: true  }   ← 选区没了
 * ```
 *
 * 原因：缩放 → 文本层**重新渲染**（span 全被替换）→
 * 浏览器选区锚定的 DOM 节点没了 → 浏览器自动清空选区
 * → `selectionchange` 触发 → 浮层被关闭。
 *
 * → 所以浮层不是"没跟随"，而是**它依附的选区本身没了**。
 *
 * ## 怎么做
 *
 * 缩放**前**记住"选中了什么"（文本内容 + 在文本层里的字符偏移），
 * 缩放**后**（文本层重新渲染完）按字符偏移**恢复**选区。
 *
 * 不用绝对 DOM 位置（会随缩放变），用**文本层的字符偏移**（缩放不变）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** 选区快照（与缩放无关的表示） */
interface SelectionSnapshot {
  /** 选中的文本 */
  text: string;
  /** 起始字符偏移（在整页文本层里） */
  startOffset: number;
  /** 结束字符偏移 */
  endOffset: number;
  /** 所在页码 */
  pageNumber: number;
}

/** useSelectionPreservation 参数 */
export interface UseSelectionPreservationOptions {
  /** 文本层容器（用于查询 span） */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 当前缩放（变化时触发"保存 → 恢复"） */
  scale: number;
  /** 恢复完成后回调（宿主可以据此刷新浮层锚点） */
  onRestored?: () => void;
}

/** useSelectionPreservation 返回值 */
export interface UseSelectionPreservationResult {
  /** 缩放前手动保存选区（可选；缩放变化时会自动保存） */
  save: () => void;
}

/**
 * 计算一个 DOM 节点在文本层里的字符偏移。
 *
 * @param node 节点（文本节点或元素）
 * @param offset 节点内偏移
 * @param container 文本层容器
 * @returns 字符偏移；算不出时返回 -1
 */
function offsetOf(node: Node, offset: number, container: HTMLElement): number {
  const spans = container.querySelectorAll<HTMLElement>('[data-page-number]');
  let total = 0;

  for (const span of spans) {
    if (span === node || span.contains(node)) {
      // 在这个 span 内：算 span 内的偏移
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let within = 0;
      let current = walker.nextNode();
      while (current) {
        if (current === node) {
          return total + within + offset;
        }
        within += current.textContent?.length ?? 0;
        current = walker.nextNode();
      }
      return total + within;
    }
    total += span.textContent?.length ?? 0;
  }

  return -1;
}

/**
 * 按字符偏移恢复选区。
 *
 * @param snapshot 快照
 * @param container 文本层容器
 * @returns 是否恢复成功
 */
function restoreSelection(snapshot: SelectionSnapshot, container: HTMLElement): boolean {
  const spans = [...container.querySelectorAll<HTMLElement>('[data-page-number]')].filter(
    (span) => Number(span.getAttribute('data-page-number')) === snapshot.pageNumber,
  );
  if (spans.length === 0) {
    return false;
  }

  // 先把整页的文本节点按顺序列出来
  const ownerDocument = spans[0]?.ownerDocument;
  if (!ownerDocument) {
    return false;
  }
  const walker = document.createTreeWalker(ownerDocument, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (spans.some((span) => span.contains(current))) {
      texts.push(current as Text);
    }
    current = walker.nextNode();
  }

  let total = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const text of texts) {
    const len = text.textContent?.length ?? 0;
    if (startNode === null && total + len >= snapshot.startOffset) {
      startNode = text;
      startOffset = snapshot.startOffset - total;
    }
    if (endNode === null && total + len >= snapshot.endOffset) {
      endNode = text;
      endOffset = snapshot.endOffset - total;
      break;
    }
    total += len;
  }

  if (!startNode || !endNode) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  try {
    range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length ?? 0));
  } catch {
    return false;
  }

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * 缩放后保持选区。
 *
 * @param options 参数
 * @returns 操作接口
 */
export function useSelectionPreservation(
  options: UseSelectionPreservationOptions,
): UseSelectionPreservationResult {
  const { containerRef, scale, onRestored } = options;

  /** 上一个缩放值（用来检测"缩放变了"） */
  const lastScaleRef = useRef(scale);
  /** 待恢复的快照 */
  const snapshotRef = useRef<SelectionSnapshot | null>(null);
  /** 恢复定时器 */
  const restoreTimerRef = useRef<number | null>(null);

  /** 保存当前选区 */
  const save = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      snapshotRef.current = null;
      return;
    }

    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;

    const startElement = startNode instanceof Element ? startNode : startNode.parentElement;
    const pageElement = startElement?.closest<HTMLElement>('.scpdf-page');
    const pageNumber = Number(pageElement?.getAttribute('data-page-number'));

    if (!Number.isFinite(pageNumber)) {
      snapshotRef.current = null;
      return;
    }

    const startOffset = offsetOf(startNode, range.startOffset, container);
    const endOffset = offsetOf(endNode, range.endOffset, container);

    if (startOffset < 0 || endOffset < 0) {
      snapshotRef.current = null;
      return;
    }

    snapshotRef.current = {
      text: selection.toString(),
      startOffset,
      endOffset,
      pageNumber,
    };
  }, [containerRef]);

  /*
   * ⚠️⚠️ **保存必须在"恢复"之前跑**（顺序错了 → 永远存不到）。
   *
   * React 的 effect 执行顺序 = 声明顺序（同一次 commit 内）。
   * 如果"恢复"effect 先跑并把 `lastScaleRef.current = scale` 更新了，
   * 那"保存"effect 再跑时 `lastScaleRef.current === scale` → **直接 return，不保存**。
   *
   * → 用 `useLayoutEffect`（在 paint 之前同步执行）+ 声明在前面，
   *   保证：先保存 → 再恢复。
   */
  useLayoutEffect(() => {
    if (lastScaleRef.current === scale) {
      return;
    }
    save();
  }, [scale, save]);

  useEffect(() => {
    // 第一次：不保存（没有"上一个缩放"可比）
    if (lastScaleRef.current === scale) {
      return;
    }

    /*
     * ⚠️ 顺序很重要：
     * 1. **先保存**（上面那个 useLayoutEffect 已经做了）
     * 2. 再等文本层重渲染完 → **恢复**
     */
    const snapshot = snapshotRef.current;
    lastScaleRef.current = scale;

    if (!snapshot) {
      return;
    }

    if (restoreTimerRef.current !== null) {
      cancelAnimationFrame(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }

    /*
     * 等待文本层重渲染完，然后恢复选区。
     *
     * ⚠️⚠️ **不能只试一次**（实测踩过的坑）：
     *
     * ```
     * 100ms: len=199  ← 恢复了（此时文本层还是旧的）
     * 200ms: len=0    ← 文本层重渲染 → 选区又被销毁了！
     * ```
     *
     * 缩放后文本层会**分批**重渲染（不同页、不同 frame），
     * 恢复得太早 → 又被后面的重渲染干掉。
     *
     * → 策略：**持续重试**。
     *   - 每帧检查"选区是否还在"
     *   - 不在 → 再恢复一次
     *   - 连续 N 帧都稳定 → 收工
     */
    /*
     * ⚠️⚠️ **"稳定"的判据必须够强**（实测踩过的坑）。
     *
     * ```
     * attempt 1: restored=true, selLen=199   ← 恢复了
     * 200ms:     selLen=0                     ← 文本层重渲染 → 又被销毁了！
     * ```
     *
     * 早先的判据是"连续 3 帧选区还在" → 第 3 帧就收工
     * → 但文本层在**第 4 帧之后**才重渲染 → 收工得太早 → 选区又被干掉。
     *
     * → 改成：**必须连续 N 帧都活着的"且"期间没有发生重渲染**。
     *   怎么知道"没有重渲染"？→ **文本层 DOM 的版本号**：
     *   每次文本层重渲染，span 会被替换 → 用一个 MutationObserver 计数。
     */
    let attempts = 0;
    let stableFrames = 0;
    /** 上次恢复时的文本层版本 */
    let versionAfterRestore = -1;

    /*
     * 文本层重渲染的计数器 —— 用来知道"选区是不是刚被重渲染干掉"。
     *
     * ⚠️ 每次恢复后如果文本层又重渲染了 → 选区会再次消失
     *    → 稳定计数要归零 → 继续恢复。
     */
    let textLayerVersion = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element && node.matches('.scpdf-text-layer__item')) {
            textLayerVersion += 1;
            break;
          }
        }
      }
    });
    observer.observe(containerRef.current ?? document.body, {
      childList: true,
      subtree: true,
    });

    const tryRestore = () => {
      const container = containerRef.current;
      if (!container) {
        observer.disconnect();
        return;
      }

      const selection = window.getSelection();
      const alive =
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        selection.toString().length > 0;

      if (alive && selection.toString() === snapshot.text) {
        /*
         * ⚠️ 文本层刚重渲染过 → 选区可能**已经又被干掉**了
         *    （浏览器会静默丢弃选区，不触发 selectionchange）
         * → 稳定计数归零，重新恢复。
         */
        if (versionAfterRestore >= 0 && textLayerVersion !== versionAfterRestore) {
          stableFrames = 0;
        }
        stableFrames += 1;
        /*
         * 连续 10 帧稳定 → 收工。
         *
         * 10 帧 ≈ 160ms —— 足够覆盖文本层的重渲染窗口
         * （实测：文本层在恢复后约 100ms 才重渲染完）。
         */
        if (stableFrames >= 10) {
          observer.disconnect();
          snapshotRef.current = null;
          onRestored?.();
          return;
        }
      } else {
        stableFrames = 0;
      }

      // 选区没了 → 恢复
      restoreSelection(snapshot, container);

      // 记下"恢复时的文本层版本" → 下一帧如果版本变了（说明刚被重渲染干掉）→ 稳定计数归零
      versionAfterRestore = textLayerVersion;

      attempts += 1;
      if (attempts > 120) {
        // 放弃（约 2s）
        observer.disconnect();
        snapshotRef.current = null;
        return;
      }
      restoreTimerRef.current = requestAnimationFrame(tryRestore);
    };

    restoreTimerRef.current = requestAnimationFrame(tryRestore);

    return () => {
      observer.disconnect();
      if (restoreTimerRef.current !== null) {
        cancelAnimationFrame(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, [scale, containerRef, onRestored]);

  useEffect(
    () => () => {
      if (restoreTimerRef.current !== null) {
        cancelAnimationFrame(restoreTimerRef.current);
      }
    },
    [],
  );

  return { save };
}
