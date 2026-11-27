/**
 * **批注面板**的状态和逻辑（便利贴详情面板 + 锚点弹窗）。
 *
 * ## 为什么抽出来
 *
 * -> `PdfViewer.tsx` 原来有 **5911 行** ✅ -> 单个函数 5000 行 ✅
 * -> 120 个 hook 全挤在一起 ✅ -> 改一个功能要找半天 ✅
 * -> 这块逻辑**自成一体** ✅（4 个 state + 4 个回调 ✅）
 *    -> 只依赖 `stickyNotes` / `containerRef` / 几个宿主的 prop ✅
 * -> 抽出来 ✅ -> `PdfViewer` 少 252 行 ✅ -> 好读好测 ✅
 *
 * ## ⚠️ **逻辑一个字都没改** ✅
 *
 * -> 抽出来的**不是**"改逻辑" ✅ -> 是**搬家** ✅
 * -> 所有 `useState` / `useEffect` / `useCallback` 的依赖数组**原样保留** ✅
 * -> 行为**完全不变** ✅
 */

import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { findStickyNoteIcon } from '../core/annotation/anchor';
import type { AnnotationRecord } from '../core/annotation/sticky-note';

/** 视口矩形 */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 正在编辑的批注 */
export interface EditingAnnotation {
  id: string;
  content: string;
  anchor: AnchorRect | null;
}

/** `useAnnotationPanel` 的参数 */
export interface UseAnnotationPanelOptions {
  /** 宿主的便签列表 */
  stickyNotes?: AnnotationRecord[];
  /** 查看器的容器（用来量便签图标的位置） */
  containerRef: RefObject<HTMLElement | null>;
  /** 点便签 */
  onAnnotationClick?: (annotation: AnnotationRecord) => void;
  /** 点"编辑" */
  onAnnotationEdit?: (annotation: AnnotationRecord) => void;
  /** 点"展开" */
  onAnnotationExpand?: (annotation: AnnotationRecord) => void;
  /** 点"删除"（**参数是 id** ✅ —— 和 `PdfViewer` 的 prop 同型 ✅） */
  onAnnotationDelete?: (id: string) => void;
}

/** `useAnnotationPanel` 的返回值 */
export interface UseAnnotationPanelResult {
  /** 当前打开的批注 id */
  activeAnnotationId: string | null;
  /** 设置当前打开的批注 id */
  setActiveAnnotationId: (id: string | null) => void;
  /** 当前打开的批注记录 */
  activeAnnotation: AnnotationRecord | null;
  /** 当前打开的便签的视口矩形（面板的锚点） */
  activeAnnotationAnchor: AnchorRect | null;
  /** 删除批注（**参数是 id** ✅） */
  handleAnnotationDelete: (id: string) => void;
  /** 关闭批注面板 */
  handleAnnotationClose: () => void;
  /** 点"编辑" -> 打开锚点弹窗 */
  handleAnnotationEdit: (annotation: AnnotationRecord, element?: HTMLElement | null) => void;
  /** 给 `<Page>` 的 3 个回调（**引用必须稳定** ✅） */
  handlePageAnnotationClick: (annotation: AnnotationRecord) => void;
  handlePageAnnotationEdit: (annotation: AnnotationRecord, element?: HTMLElement | null) => void;
  handlePageAnnotationExpand: (annotation: AnnotationRecord) => void;
  /** 正在编辑的批注（锚点弹窗用） */
  editAnnotation: EditingAnnotation | null;
  setEditAnnotation: (value: EditingAnnotation | null) => void;
  /** 锚点弹窗的重试计数 */
  editAnchorTick: number;
  setEditAnchorTick: (value: number | ((prev: number) => number)) => void;
}

/**
 * 批注面板的状态和逻辑。
 *
 * @param options 参数
 * @returns 状态和回调
 */
export function useAnnotationPanel(options: UseAnnotationPanelOptions): UseAnnotationPanelResult {
  const {
    stickyNotes,
    containerRef,
    onAnnotationClick,
    onAnnotationEdit,
    onAnnotationExpand,
    onAnnotationDelete,
  } = options;

  /**
   * **当前打开的批注**（便利贴面板）。
   *
   * ⚠️ **包不自己存批注** → 这里只存"哪个批注正在编辑"这个 UI 状态。
   */
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);

  /** 当前打开的批注记录 */
  const activeAnnotation = useMemo(() => {
    if (!activeAnnotationId) {
      return null;
    }
    return stickyNotes?.find((a) => a.id === activeAnnotationId) ?? null;
  }, [activeAnnotationId, stickyNotes]);

  /**
   * **当前打开的便签的视口矩形**（给便利贴详情面板当锚点）。
   *
   * ⚠️ **之前面板固定在"页面中间偏右"** ❌
   *    -> 便签在 \`x=571\`、面板在 \`x=918\` -> **离得很远** ❌
   *    -> 用户反馈："打开详细按钮目前是失效的 需要点击能打开一个稍微大一点的便利贴的样式"
   *
   * -> 现在：**量便签图标的位置** -> 面板**贴在它旁边**
   */
  /*
   * ⚠️⚠️ **便签的位置要在 DOM 画出来之后才能量**（实测踩到的坑）。
   *
   * ### 问题
   *
   * -> 之前是 `useMemo([activeAnnotationId])` ❌
   * -> 它在**渲染期间**算 -> 那时便签图标**可能还没渲染出来** ❌
   *    -> `querySelector` 返回 null -> `anchorRect = null` ❌
   *    -> 详情面板**退回"中间偏右"** -> "出现在 PDF 的最上方" ❌
   *
   * ### 现在的做法
   *
   * -> 用 `state` + `useEffect` -> **DOM 画完之后**再量
   * -> 量不到就**再试一次**（下一帧）
   */
  const [activeAnnotationAnchor, setActiveAnnotationAnchor] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  useEffect(() => {
    if (!activeAnnotationId) {
      setActiveAnnotationAnchor(null);
      return;
    }

    /*
     * ⚠️⚠️⚠️ **锚点查找要支持"合并组"**（实测踩到的坑，用户反馈：
     * "如果同一位置两个批注 那么第一个批注点击之后展示位置正常
     *  第二个批注详情点击之后还是会出现在pdf的首页位置"）。
     *
     * -> 同一位置的多个批注**合并成一个图标**
     * -> 那个图标上只有 `data-note-id={first.id}`（第一条）❌
     * -> 选**第二条** -> 精确匹配**找不到** ❌
     * -> -> 锚点**保持旧值** ❌ -> 面板停在**首页** ❌
     *
     * -> 现在用 `findStickyNoteIcon` -> 找"**包含这个 id**"的图标
     * -> 合并组用 `data-note-ids` 匹配
     */
    const measure = () => {
      const el = findStickyNoteIcon(containerRef.current, activeAnnotationId);
      if (!el) {
        return;
      }
      const r = el.getBoundingClientRect();
      setActiveAnnotationAnchor({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    };

    /*
     * ⚠️⚠️ **一个 rAF 循环干两件事**（实测踩到的坑）。
     *
     * -> 之前是**两套逻辑** ❌
     *    1. rAF 重试（最多 10 帧）-> 为了等便签画出来
     *    2. `scroll` 事件监听 -> 为了滚动时重新量
     * -> 两套**各自独立** ❌ -> 会**打架** ❌
     *    -> 用户反馈："滚动的时候 定位也跑来跑去的"
     *
     * -> 现在：**一个循环**负责"量到为止 + 一直跟随"
     *    -> 便签还没画出来 -> **继续等**
     *    -> 便签画出来了 -> **每一帧都跟着**
     *    -> 用户滚动 -> 面板**贴着便签走**  （不抖）
     */
    let raf = 0;
    let tries = 0;

    const tick = () => {
      tries += 1;
      const el = findStickyNoteIcon(containerRef.current, activeAnnotationId);
      if (el) {
        const r = el.getBoundingClientRect();
        setActiveAnnotationAnchor({
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        });
      } else if (tries >= 10) {
        // ⚠️ **量不到 -> 放弃**（不让 rAF 一直跑）
        return;
      }

      /*
       * ⚠️ **量到了就继续跑**（跟随模式）
       * -> 滚动时便签在视口里的位置变了  -> 面板要跟着
       * -> 组件卸载时 cleanup 会 cancel
       */
      raf = requestAnimationFrame(tick);
    };

    /*
     * ⚠️ **先量一次**（便签可能已经在）
     */
    measure();

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
    };
    /*
     * ⚠️ **依赖只有 `activeAnnotationId`** ✅
     *
     * -> `containerRef` 是**稳定的 ref 对象** ✅ -> 永远不变 ✅
     * -> 依赖 `containerRef.current` ❌ -> 每次渲染都是新值 ❌
     *    -> effect 每次都重跑 ❌ -> rAF 循环不停 ❌ -> 性能问题 ❌
     * -> 所以**不加** ✅
     */
  }, [activeAnnotationId, containerRef]);

  /** 批注的删除（宿主实现） */
  const handleAnnotationDelete = useCallback(
    (id: string) => {
      setActiveAnnotationId(null);
      onAnnotationDelete?.(id);
    },
    [onAnnotationDelete],
  );

  /** 关掉面板 */
  const handleAnnotationClose = useCallback(() => {
    setActiveAnnotationId(null);
  }, []);

  /*
   * ⚠️⚠️ **"编辑批注"的弹窗**（用户需求：
   * "富文本编辑完之后没有保存按钮啊 保存都保存不了
   *  而且 富文本点了编辑 怎么富文本编辑框还在文档最上面啊
   *  要出现在视野里啊 就点的旁边"）。
   *
   * ### 之前
   *
   * → 点"编辑" -> 打开**右侧的便利贴面板**（`AnnotationPanel`）❌
   * → 面板**离批注很远**（甚至在视口外）-> "还在文档最上面" ❌
   * → 面板里**没有「保存」按钮** -> 只能靠 `Ctrl+Enter` ❌
   *   （而 TipTap 编辑器**根本没接 `onSubmit`** -> **根本保存不了** ❌）
   *
   * ### 现在
   *
   * -> 点"编辑" -> 打开**锚点弹窗**（`AnnotationDialog`）
   * -> 弹窗**贴在批注图标下面**（飞书评论气泡的感觉）
   * -> 弹窗里**有「保存」「取消」按钮**
   * -> 和"新建批注"**同一套组件**（行为一致）
   */
  const [editAnnotation, setEditAnnotation] = useState<{
    id: string;
    content: string;
    anchor: { left: number; top: number; right: number; bottom: number } | null;
  } | null>(null);

  /** 编辑批注的锚点版本（滚动/缩放时重算位置） */
  const [editAnchorTick, setEditAnchorTick] = useState(0);

  /** 页面滚动 / 缩放 -> 锚点位置变了 -> 重算 */
  useEffect(() => {
    if (!editAnnotation) {
      return;
    }
    const update = () => {
      setEditAnchorTick((n) => n + 1);
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editAnnotation]);

  /**
   * **打开"编辑批注"弹窗**（锚点 = 批注图标的位置）。
   *
   * @param annotation 要编辑的批注
   * @param element 批注图标元素（用来算锚点）
   */
  const handleAnnotationEdit = useCallback(
    (annotation: AnnotationRecord, element?: HTMLElement | null) => {
      const rect = element?.getBoundingClientRect();
      setEditAnnotation({
        id: annotation.id,
        content: annotation.content ?? '',
        anchor: rect
          ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
          : null,
      });
      setActiveAnnotationId(null);
    },
    [],
  );

  /*
   * ⚠️⚠️ **给 `<Page>` 的 3 个回调**（`Page.tsx` 的注释明确警告过 ✅）
   *
   * > "所有 props 都得是稳定引用！`PdfViewer` 里不能给 `<Page>` 传
   * >  inline 箭头函数（每次都是新函数 → memo 失效）"
   *
   * -> 之前**确实是内联函数** ✅ ❌ -> 是个雷 ✅
   * -> 现在实测没出问题 ✅（改主题/搜索 → 0 次页面重渲染 ✅）
   *    -> 因为闭包捕获的都是稳定引用 ✅
   * -> 但以后有人往闭包里加一个 `useState` 依赖 ✅
   *    -> `<Page>` 的 memo **立刻失效** ✅ -> 所有页每次都重渲染 ✅ ❌
   * -> 抽成 `useCallback` ✅ -> 引用稳定 ✅ -> 隐患消除 ✅
   */

  /** 点便签 → 打开便利贴面板 */
  const handlePageAnnotationClick = useCallback(
    (annotation: AnnotationRecord) => {
      setActiveAnnotationId(annotation.id);
      onAnnotationClick?.(annotation);
    },
    [onAnnotationClick],
  );

  /** 点"编辑" → 打开锚点弹窗（贴在批注旁边） */
  const handlePageAnnotationEdit = useCallback(
    (annotation: AnnotationRecord, element?: HTMLElement | null) => {
      handleAnnotationEdit(annotation, element);
      onAnnotationEdit?.(annotation);
    },
    [handleAnnotationEdit, onAnnotationEdit],
  );

  /** 点"展开" → 打开便利贴面板（看完整内容） */
  const handlePageAnnotationExpand = useCallback(
    (annotation: AnnotationRecord) => {
      setActiveAnnotationId(annotation.id);
      onAnnotationExpand?.(annotation);
    },
    [onAnnotationExpand],
  );
  return {
    activeAnnotationId,
    setActiveAnnotationId,
    activeAnnotation,
    activeAnnotationAnchor,
    handleAnnotationDelete,
    handleAnnotationClose,
    handleAnnotationEdit,
    handlePageAnnotationClick,
    handlePageAnnotationEdit,
    handlePageAnnotationExpand,
    editAnnotation,
    setEditAnnotation,
    editAnchorTick,
    setEditAnchorTick,
  };
}
