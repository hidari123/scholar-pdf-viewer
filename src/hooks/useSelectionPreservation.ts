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
 * ## 做法：按**文本内容**恢复（不用字符偏移）
 *
 * 缩放前记住"选中了什么**文字**" + "它在**哪一页**"，
 * 缩放后（文本层重渲染完）在那一页里**找到这段文字** → 重新选中。
 *
 * ### ⚠️ 为什么不用"字符偏移"
 *
 * 试过用偏移（`offsetOf`），踩了三个坑：
 * 1. 偏移要跨页累加 → 和恢复时的页内坐标系**不一致** → 恢复出"整页"
 *    （实测 88 字符 → 2938 字符）
 * 2. `offsetOf` 按 `span.textContent` 累加、恢复按文本节点累加 → 两者漂移
 * 3. 选区结束在 span 边界时，`endContainer` 是**元素**而不是文本节点
 *    → 偏移算不出来（实测 endOffset=3010，而选区只有 88 字符）
 *
 * → 按**文字**找：稳定、无坐标系问题、也符合用户直觉
 *    （选的还是那段字）。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

/** 选区快照 */
interface SelectionSnapshot {
  /** 选中的文字（用于恢复后核对） */
  text: string;
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
  /** 缩放前手动保存选区（宿主在改缩放**之前**调用） */
  save: () => void;
}

/**
 * 取某一页的文本层 span（**按文档顺序**）。
 *
 * @param container 文本层容器
 * @param pageNumber 页码
 * @returns span 列表
 */
function spansOfPage(container: HTMLElement, pageNumber: number): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-page-number]')].filter(
    (span) => Number(span.getAttribute('data-page-number')) === pageNumber,
  );
}

/**
 * 把一段文字**定位**到 DOM 节点上（并选中它）。
 *
 * 做法：在该页的文本层里**按顺序拼出全文**，
 *       找到目标文字的位置 → 映射回（文本节点, 节点内偏移）。
 *
 * @param text 要找的文字
 * @param pageSpans 该页的 span 列表
 * @returns 找到时返回 { node, offset }；没找到返回 null
 */
function locateText(
  text: string,
  pageSpans: readonly HTMLElement[],
): { node: Text; offset: number; endNode: Text; endOffset: number } | null {
  if (text.length === 0) {
    return null;
  }

  /** 该页的全文（由文本节点拼成） */
  let full = '';
  /** 每个字符对应的（文本节点, 节点内偏移） */
  const positions: { node: Text; offset: number }[] = [];

  for (const span of pageSpans) {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const node = current as Text;
      const content = node.textContent ?? '';
      for (let i = 0; i < content.length; i++) {
        positions.push({ node, offset: i });
      }
      full += content;
      current = walker.nextNode();
    }
  }

  const index = full.indexOf(text);
  if (index < 0 || index >= positions.length) {
    return null;
  }

  const start = positions[index];
  const end = positions[Math.min(index + text.length - 1, positions.length - 1)];
  if (!start || !end) {
    return null;
  }

  return { node: start.node, offset: start.offset, endNode: end.node, endOffset: end.offset + 1 };
}

/**
 * 按文字恢复选区。
 *
 * @param snapshot 快照
 * @param container 文本层容器
 * @returns 是否恢复成功
 */
function restoreSelection(snapshot: SelectionSnapshot, container: HTMLElement): boolean {
  const spans = spansOfPage(container, snapshot.pageNumber);
  if (spans.length === 0) {
    return false;
  }

  const found = locateText(snapshot.text, spans);
  if (!found) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  try {
    range.setStart(found.node, Math.min(found.offset, found.node.textContent?.length ?? 0));
    range.setEnd(found.endNode, Math.min(found.endOffset, found.endNode.textContent?.length ?? 0));
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
  /** 恢复用的 rAF 句柄 */
  const restoreRafRef = useRef(0);

  /** 保存当前选区（宿主在改缩放**之前**调用） */
  const save = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();

    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      snapshotRef.current = null;
      return;
    }

    const text = selection.toString();
    if (text.trim().length === 0) {
      snapshotRef.current = null;
      return;
    }

    const startNode = selection.getRangeAt(0).startContainer;
    const startElement = startNode instanceof Element ? startNode : startNode.parentElement;
    const pageElement = startElement?.closest<HTMLElement>('.scpdf-page');
    const pageNumber = Number(pageElement?.getAttribute('data-page-number'));

    if (!Number.isFinite(pageNumber)) {
      snapshotRef.current = null;
      return;
    }

    snapshotRef.current = { text, pageNumber };
  }, [containerRef]);

  useEffect(() => {
    // 第一次：没有"上一个缩放"可比
    if (lastScaleRef.current === scale) {
      return;
    }

    const snapshot = snapshotRef.current;
    lastScaleRef.current = scale;

    if (!snapshot) {
      return;
    }

    if (restoreRafRef.current !== 0) {
      cancelAnimationFrame(restoreRafRef.current);
      restoreRafRef.current = 0;
    }

    /*
     * ⚠️⚠️ **必须持续重试**（实测踩过的坑）。
     *
     * ```
     * attempt 0: restored=true, selLen=199   ← 恢复了
     * 200ms:     selLen=0                     ← 文本层重渲染 → 又被销毁了！
     * ```
     *
     * 缩放后文本层会**分批**重渲染（不同页、不同 frame），
     * 恢复得太早 → 又被后面的重渲染干掉。
     *
     * → 每帧检查"选区是否还在且文字对得上"
     *   - 不在 → 再恢复一次
     *   - 在 → 连续 10 帧稳定才收工
     */
    let attempts = 0;
    let stableFrames = 0;

    const tryRestore = () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const selection = window.getSelection();
      const alive =
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        selection.toString() === snapshot.text;

      if (alive) {
        stableFrames += 1;
        /*
         * 连续 10 帧稳定 → 收工。
         *
         * 10 帧 ≈ 160ms —— 足够覆盖文本层的重渲染窗口
         * （实测：文本层在恢复后约 100ms 才重渲染完）。
         */
        if (stableFrames >= 10) {
          restoreRafRef.current = 0;
          snapshotRef.current = null;
          onRestored?.();
          return;
        }
      } else {
        stableFrames = 0;
        restoreSelection(snapshot, container);
      }

      attempts += 1;
      if (attempts > 120) {
        // 放弃（约 2s）
        restoreRafRef.current = 0;
        snapshotRef.current = null;
        return;
      }
      restoreRafRef.current = requestAnimationFrame(tryRestore);
    };

    restoreRafRef.current = requestAnimationFrame(tryRestore);

    return () => {
      if (restoreRafRef.current !== 0) {
        cancelAnimationFrame(restoreRafRef.current);
        restoreRafRef.current = 0;
      }
    };
  }, [scale, containerRef, onRestored]);

  useEffect(
    () => () => {
      if (restoreRafRef.current !== 0) {
        cancelAnimationFrame(restoreRafRef.current);
      }
    },
    [],
  );

  /*
   * ⚠️⚠️ **返回值必须稳定**（用 `useMemo` 包）。
   *
   * 否则每次渲染都返回**新对象** → 依赖它的 `useCallback` 每次都变
   * → 再往上传 → `useZoom` 的返回值每次都变
   * → 依赖它的 `useEffect` **每次渲染都重跑**
   * → cleanup 把 `ResizeObserver` 拆了重建 → `lastWidth` 被重置
   * → **宽度变化永远检测不到**！
   *
   * （实测：打开缩略图 → 容器 1384→1139 → 缩放没变 → 页横向溢出）
   */
  return useMemo(() => ({ save }), [save]);
}
