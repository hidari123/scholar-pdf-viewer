/**
 * SelectionPopover —— 选区浮层（选中文字后出现的小工具条）。
 *
 * **设计要点**（对比原 scholar-club 的实现）：
 * - **自己算位置**（`position: fixed` + 视口坐标）→ 不需要 scroll 换算 → 天然不漂移
 * - **实测弹层尺寸** → 不用魔法数字（原项目猜宽度 200、猜高度 50）
 * - **真翻转**：先试下方，放不下再试上方（原项目只是 `popoverY -= 50`）
 * - **clamp 到容器**可视区
 * - **可注入的动作注册表**（原项目是硬编码 JSX）
 * - **Esc 关闭 / 选区清空关闭 / 滚动缩放关闭**（原项目都没有）
 *
 * **包的边界**：只做 UI + 事件，不做业务（翻译/提问/笔记由宿主实现）。
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HighlightPalette } from '../core/highlight/palette';
import { resolveHighlightColorName } from '../core/highlight/palette';
import type { SelectionAction } from '../core/selection/actions';
import { BUILTIN_ACTION_KEYS, isBuiltinIcon } from '../core/selection/actions';
import { HIGHLIGHT_ACTION_KEYS } from '../core/selection/highlight-actions';
import type { PopoverPosition } from '../core/selection/popover-position';
import { computePopoverPosition } from '../core/selection/popover-position';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { SelectionActionIconView } from './SelectionActionIcons';

/** SelectionPopover 参数 */
export interface SelectionPopoverProps {
  /** 是否显示 */
  open: boolean;
  /**
   * 选区矩形（视口坐标）。
   *
   * ⚠️ **这是"起点"，不是"锚点"** ——
   * 浮层真正用的锚点由组件自己**实时**从 DOM 选区算（见 `liveAnchor`）。
   *
   * 为什么要实时算：
   * - `position: fixed` 的坐标会随**滚动 / 缩放 / 容器尺寸变化**失效
   * - 存下来的坐标**必然**会在某一刻过期 → 浮层跑到别处
   *   （实测：缩放后浮层偏了 130px；滚动后浮层直接消失）
   */
  selectionRect: { left: number; top: number; right: number; bottom: number } | null;
  /** 容器矩形（视口坐标）—— PDF 的可视区 */
  containerRect: { left: number; top: number; right: number; bottom: number } | null;
  /**
   * **外部锚点**（视口坐标）。
   *
   * ⚠️ **给了它就不用读浏览器选区**。
   *
   * ## 为什么需要
   *
   * 浮层原本只绑在**浏览器原生选区**上（`readLiveAnchor()`）。
   * 但用户要求："点击高亮之后 应该也会出现那个选择的弹框 可以选择颜色等"
   * → 点高亮块时，**浏览器里没有选区** → 必须由外部提供锚点。
   *
   * → 同一个组件服务两种场景：
   * - 文字选区 → 不传 `anchorRect` → 从 DOM 选区实时读
   * - 高亮块   → 传 `anchorRect` → 用它
   */
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
  /**
   * 锚点**版本号** —— 外部强制重算位置用。
   *
   * 浮层自己会监听滚动/resize 实时重算，
   * 但"选区被恢复"这类变化它感知不到 → 宿主用这个号通知它。
   */
  anchorVersion?: number;
  /** 要显示的动作 */
  actions: SelectionAction[];
  /** 点击动作 */
  onAction?: (action: SelectionAction) => void;
  /** 关闭 */
  onClose?: () => void;
  /**
   * **彻底取消选区**（Esc 时用）。
   *
   * ⚠️ 为什么需要（实测踩过的坑）：
   *
   * ```
   * 首次 mouseup: ["SPAN.scpdf-text-layer__item"]
   * Esc 后 mouseup: []          ← ❌ 浏览器**一个 mouseup 都不发**
   * ```
   *
   * → Esc 只关浮层、**不清选区** → 浏览器仍认为"用户在操作选区"
   * → 之后的拖动**收不到 mouseup** → 选区不再更新 → **浮层再也不出现**。
   *
   * → Esc = "取消这次选择" → 必须**连选区一起清掉**。
   */
  onDismiss?: () => void;
  /**
   * 高亮色板（语义 key → CSS 颜色）。
   *
   * 传了才显示 🖍 按钮旁边的**颜色下拉**。
   */
  highlightPalette?: HighlightPalette;
  /** 选颜色（key） */
  onPickColor?: (key: string) => void;
  /**
   * **当前高亮色**（语义 key）。
   *
   * → 主按钮会**用它高亮**（用户需求："如果没有选择颜色
   *   也按照默认颜色来展示高亮 不必每次都选择颜色"✅）
   * → 没有（undefined / null）→ 用**宿主配的默认色** ✅
   * → 主按钮下面会显示**一条这个颜色的下划线** ✅（飞书样式）
   */
  currentHighlightColor?: string | null;
  /** 语言 */
  locale?: Locale;
  /**
   * **宿主注册的语言表**（可添加任意语言）。
   */
  locales?: LocaleTable;
  /**
   * **文案覆盖**（当前 locale）。
   *
   * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
   * → 之前浮层的 title / aria-label 是**硬编码中文** → 切语言不变 ❌
   * → 现在全部走文案表 → 跟着语言走 ✅
   */
  messages?: LocaleMessagesMap;
  /**
   * **图标覆盖**（宿主 → 包）。
   *
   * ⚠️ 宿主可以用自己的图标体系（`lucide-react` 等）覆盖内置图标 → 风格统一 ✅
   */
  icons?: Partial<Record<IconName, ReactNode>>;
}

/**
 * 从**当前 DOM 选区**实时读出锚点矩形（视口坐标）。
 *
 * ⚠️ 为什么不用传进来的 `selectionRect`：
 * 它是"选区变化那一刻"的快照，滚动/缩放后就是**过期坐标**。
 *
 * ## ⚠️⚠️ **跨页选区必须用"最后一个 client rect"**（审计发现的**真 bug**）
 *
 * ### 问题
 *
 * -> 之前用 \`getRangeAt(0).getBoundingClientRect()\` ❌
 *   -> **跨页时返回的是【并集矩形】** ❌
 *   -> 实测（视口 1500×1000，跨第 1→2 页）：
 * ```
 * unionBBox:  top=-1571, bottom=2247     ← 巨大的并集 ❌
 * clientRects: 113 个（每行一个）        ← 真正的数据 ✅
 * 最后一行:    top=943, bottom=972       ← 用户最后选到的位置 ✅
 * ```
 * -> 然后 \`computePopoverPosition\` 算：
 * ```
 * below = 2247 + 8 = 2255  → 远超视口底 → 判"下方放不下" ❌
 * above = -1571 - 46 = -1617 → 也放不下 ❌
 * → 两边都不行 → 取空间大的一边 → 再 clamp → top=954（贴视口底）❌
 * ```
 * -> 用户看到：**浮层孤零零挂在屏幕最下面** ❌
 *   -> 和"单页时贴在选区旁边"完全不一样 ❌
 *
 * ### 现在的做法
 *
 * -> **取 \`getClientRects()\` 的【最后一个】** ✅
 *   -> 那是**用户最后选到的那一行** ✅
 *   -> 浮层贴在**手指刚松开的地方** ✅
 *   -> **和单页完全一致** ✅
 *
 * ⚠️ **为什么是"最后一个"而不是"第一个"**：
 * -> 用户是从上往下拖的 -> 最后一行 = 拖拽终点 ✅
 * -> 浮层应该出现在**终点旁边**（用户的手还在那儿）✅
 *
 * @returns 选区矩形；没有选区时返回 null
 */
function readLiveAnchor(): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);

  /*
   * ⚠️ **优先用"最后一个 client rect"**（跨页的关键）。
   */
  const rects = range.getClientRects();
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const rect = rects[i];
    if (rect && rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }
  }

  // 退化：没有有效的 client rect -> 用整体包围盒
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return null;
  }
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

/**
 * 选区浮层。
 *
 * @param props 参数
 */
export function SelectionPopover({
  open,
  selectionRect,
  anchorRect: externalAnchorRect,
  containerRect,
  anchorVersion: externalAnchorVersion,
  actions,
  onAction,
  onClose,
  onDismiss,
  highlightPalette,
  onPickColor,
  currentHighlightColor,
  messages,
  locale = 'zh',
  locales,
  icons,
}: SelectionPopoverProps) {
  /**
   * 文案解析（支持宿主的语言表）。
   *
   * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
   * → 之前浮层的 title 是**硬编码中文** → 现在全走文案表 ✅
   */
  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  /** 颜色下拉是否展开 */
  const [paletteOpen, setPaletteOpen] = useState(false);

  /** 上一次用的锚点（用于"位置变了没"的比对） */
  const lastAnchorRef = useRef<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  /*
   * **实测弹层尺寸**（不猜）。
   *
   * 为什么必须实测：翻转与 clamp 都需要知道弹层有多大。
   * 原 scholar-club 猜宽度 200（实际 350-400）、猜高度 50 → 位置全错。
   */
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return null;
    }
    const rect = root.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, []);

  /*
   * 位置计算：**先渲染，再测量**。
   *
   * ⚠️ 这里曾经有个"鸡生蛋"死锁：
   * - 位置没算出来 → 返回 null → 元素根本没渲染 → 量不到尺寸
   * - 量不到尺寸 → 算不出位置 → 永远 null
   *
   * 解决：**第一帧先渲染**（定位到 0,0 且不可见），量到尺寸后再算真正的位置。
   *
   * ⚠️ **代价：两帧渲染**（第一帧量尺寸，第二帧算位置）
   *    → 浮层从"选完"到"出现"多一次 React 渲染（约 +15ms）。
   *
   * **优化**：弹层的尺寸只跟**动作数量**有关（按钮固定 28px 宽），
   * 所以可以**预先算出来** → 只渲染一帧。
   * 下面的 `useLayoutEffect` 仍然保留（兜底：万一算错了会自我修正）。
   */
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  /** 可见动作（过滤 disabled） */
  const visibleActions = useMemo(() => actions.filter((action) => !action.disabled), [actions]);

  /**
   * **预估**弹层尺寸（不用等渲染完再量）。
   *
   * 尺寸 = padding(4×2) + border(1×2) + 按钮数 × 28 + 间距(2×(n-1))
   * （色板按钮多一个 16px 的分裂按钮）
   */
  const estimatedSize = useMemo(() => {
    let buttons = visibleActions.length;
    // 🖍 高亮是分裂按钮（多一个 16px 的下拉箭头）
    // ⚠️ **高亮浮层的"选择高亮颜色"也是分裂按钮**（用户要求的第 2 个按钮）
    if (
      visibleActions.some(
        (a) => a.key === BUILTIN_ACTION_KEYS.highlight || a.key === HIGHLIGHT_ACTION_KEYS.color,
      )
    ) {
      buttons += 1;
    }
    const buttonWidth = (visibleActions.length - (buttons - visibleActions.length)) * 28;
    const splitWidth = (buttons - visibleActions.length) * 16;
    const width = 4 * 2 + 1 * 2 + buttonWidth + splitWidth + 2 * Math.max(0, buttons - 1);
    const height = 4 * 2 + 1 * 2 + 28;
    return { width, height };
  }, [visibleActions]);

  // 尺寸变化（动作数量/标签变化）→ 重新测量（兜底，修正预估值）
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    // 依赖 actions：按钮增减 → 尺寸变了 → 重新量
    void actions.length;

    const size = measure();
    if (size && size.width > 0) {
      setMeasured((prev) =>
        prev && Math.abs(prev.width - size.width) < 0.5 && Math.abs(prev.height - size.height) < 0.5
          ? prev
          : size,
      );
    }
  }, [open, actions, measure]);

  // 有了尺寸 + 选区 + 容器 → 算位置
  const effectiveSize = measured ?? estimatedSize;

  /*
   * ⚠️ **实时锚点**。
   *
   * 浮层必须**始终**贴在当前选区上：
   * - 滚动 → 选区的视口坐标变了
   * - 缩放 → 选区的视口坐标变了
   * - 容器尺寸变化 → 可视区变了（clamp 要重算）
   *
   * 旧实现把锚点**存进 state**（选区变化那一刻算一次）→
   * 滚动/缩放后就是过期坐标 → 浮层跑到别处（实测偏 130px）或直接消失。
   *
   * → 改成：**每次布局都从 DOM 选区现算**。
   *
   * 触发源：
   * - 滚动/缩放/resize → 内部版本号 +1
   * - 宿主通知（选区被恢复）→ 外部版本号变化
   */
  const [internalAnchorVersion, setInternalAnchorVersion] = useState(0);

  /** 触发重算的来源（滚动/缩放/resize） */
  useEffect(() => {
    if (!open) {
      return;
    }

    /*
     * ⚠️ **rAF 节流**。
     *
     * 滚动事件在拖动滚动条时能到 60+ 次/秒，
     * 每次都重算位置 + setState → 会掉帧。
     * → 合并到下一帧，最多一帧一次。
     */
    let raf = 0;
    const bump = () => {
      if (raf !== 0) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        setInternalAnchorVersion((v) => v + 1);
      });
    };

    // 滚动（捕获阶段 → 能收到内部容器的滚动）
    window.addEventListener('scroll', bump, { passive: true, capture: true });
    // 窗口缩放
    window.addEventListener('resize', bump, { passive: true });

    /*
     * ⚠️ **持续校正**（每 100ms 检查一次）。
     *
     * 有些变化事件监听不到：
     * - 缩放后文本层**异步重排** → 选区坐标在几帧内连续变化
     * - 浏览器**静默丢弃**选区（缩放时不触发 selectionchange）
     *
     * → 每 100ms 比对一次"DOM 选区的位置"和"当前用的锚点"，
     *   不一致就重算 → 浮层永远贴合。
     *
     * 成本：一次 `getBoundingClientRect()`（微秒级），可忽略。
     */
    const checkTimer = window.setInterval(() => {
      /*
       * ⚠️ **有外部锚点时不要读 DOM 选区**。
       *
       * 场景：点了高亮块 → 浮层用 `anchorRect` 定位。
       * 此时浏览器里**可能还有旧选区**（或没有）→ 读它会得到**错的锚点**
       * → 浮层跑到别的地方。
       */
      if (externalAnchorRect) {
        return;
      }
      const anchor = readLiveAnchor();
      if (!anchor) {
        return;
      }
      // 与当前用的锚点比 → 差得够多才重算（避免无谓的 setState）
      const current = lastAnchorRef.current;
      if (
        !current ||
        Math.abs(current.left - anchor.left) > 1 ||
        Math.abs(current.top - anchor.top) > 1 ||
        Math.abs(current.right - anchor.right) > 1 ||
        Math.abs(current.bottom - anchor.bottom) > 1
      ) {
        bump();
      }
    }, 100);

    return () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
      window.clearInterval(checkTimer);
      window.removeEventListener('scroll', bump, { capture: true });
      window.removeEventListener('resize', bump);
    };
    // ⚠️ `externalAnchorRect` 进依赖 → 外部锚点变了就重建监听
  }, [open, externalAnchorRect]);

  /*
   * **锚点 = 外部锚点优先，否则实时读 DOM 选区**。
   *
   * 优先级：
   * 1. `anchorRect`（外部给的，比如高亮块）→ 用它
   * 2. DOM 里还有选区 → 用它（最准，永远跟得上）
   * 3. DOM 选区没了 → 退回传入的 `selectionRect`（兜底）
   *
   * ⚠️ **不能用 useMemo 缓存**：
   *    选区"恢复"这个时刻，DOM 里的选区是**刚刚**出现的，
   *    而 useMemo 的依赖（版本号）是在**渲染时**读的 —— 时机上可能对不上。
   *    → 直接在 `useLayoutEffect` 里现算（每次布局都算）。
   */
  useLayoutEffect(() => {
    if (!open || !containerRect || !effectiveSize) {
      setPosition(null);
      return;
    }

    void internalAnchorVersion;
    void externalAnchorVersion;

    // 1) 外部锚点（高亮块等）优先
    // 2) 否则实时读 DOM 选区
    // 3) 再否则退回传进来的快照
    const anchor = externalAnchorRect ?? readLiveAnchor() ?? selectionRect;
    if (!anchor) {
      setPosition(null);
      lastAnchorRef.current = null;
      return;
    }
    lastAnchorRef.current = anchor;

    setPosition(
      computePopoverPosition({
        selection: anchor,
        toolbar: effectiveSize,
        container: containerRect,
        // 垂直边界用**视口**（容器可能比窗口高 → 按容器判定会误翻）
        viewport: {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        },
      }),
    );
  }, [
    open,
    internalAnchorVersion,
    externalAnchorVersion,
    selectionRect,
    containerRect,
    effectiveSize,
    externalAnchorRect,
  ]);

  /*
   * 关闭条件：
   * - `mousedown` 落在浮层外
   * - `Esc`
   * - 选区被清空（由上层控制 `open`）
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) {
        return;
      }

      /*
       * ⚠️⚠️ **点在文本层外 → 立刻关闭**（实测踩过的坑）。
       *
       * 旧逻辑：不管点在哪，都等 `setTimeout(0)` 后看"还有没有选区"
       * → 点**工具栏**这类地方时，浏览器**不会清掉**旧选区
       *   （点 `<button>` 只是移动焦点，选区还在）
       * → "还有选区" → **不关** → 浮层赖在屏幕上不走（实测：0 → 0）。
       *
       * → 区分两种情况：
       *   - **点在文本层里** → 用户在**重新框选** → 等选区变化（见下）
       *   - **点在文本层外**（工具栏 / 页面空白）→ 用户**不想选文字了** → 立刻关
       */
      const target = event.target instanceof Element ? event.target : null;
      const inTextLayer = !!target?.closest('.scpdf-text-layer');
      if (!inTextLayer) {
        onClose?.();
        return;
      }

      /*
       * ⚠️ **在文本层上按下时不要关闭浮层**（实测踩过的坑）。
       *
       * 用户重新框选时：mousedown 落在文本层上（浮层外面）
       * → 旧逻辑直接 `onClose()` → 浮层关闭
       * → 然后新的选区建立 → `handleSelectionChange` 想打开浮层
       * → 但此时 `popoverOpen` 已经是 `false` → 打开需要一次状态变化
       * → **实测：浮层再也不出现**（选区有，浮层没有）
       *
       * → 改成：**按下时先不清空，等选区变化后由上层决定开/关**。
       *   只有"按下后没有产生新选区"（比如点空白）才关闭。
       *
       * → 用 `setTimeout(0)` 推迟到 mousedown 之后：
       *   如果这期间产生了新选区 → 选区变化会重新打开浮层 → 不关。
       */
      setTimeout(() => {
        // 推迟后如果**没有选区** → 说明用户是点击空白 → 关闭
        const selection = window.getSelection();
        const hasSelection =
          selection &&
          selection.rangeCount > 0 &&
          !selection.isCollapsed &&
          selection.toString().trim().length > 0;
        if (hasSelection) {
          return;
        }
        onClose?.();
      }, 0);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        /*
         * ⚠️ **Esc = 彻底取消这次选择**（不只是关浮层）。
         *
         * 只关浮层的话，浏览器仍认为"用户在操作选区"
         * → 之后的拖动**收不到 mouseup**（实测：`Esc 后 mouseup: []`）
         * → 选区不再更新 → **浮层再也不出现**。
         */
        onDismiss?.();
        onClose?.();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, onDismiss]);

  if (!open) {
    return null;
  }

  if (visibleActions.length === 0) {
    return null;
  }

  /*
   * ⚠️ **不用 createPortal**：
   * 包只 peer-dep `react`，不引入 `react-dom`（避免给宿主加依赖）。
   *
   * `position: fixed` 的定位**只受 viewport 约束**，与 DOM 位置无关 ——
   * 只要**祖先链上没有 transform / filter / perspective / contain**，
   * 浮层就等价于挂在 body 上。
   * （本包的 CSS 已确保没有这些属性。）
   */
  return (
    <div
      ref={rootRef}
      className={[
        'scpdf-selection-popover',
        /*
         * ⚠️⚠️ **吸附（sticky）模式的 class**（审计修复）。
         *
         * -> 用户反馈："往下滚动页面工具栏也会消失" ❌
         * -> 跨页选完往下滚 -> 选区滚出视野 -> 浮层跟着消失 ❌
         *
         * -> 现在：选区滚出视野 -> 浮层**吸到容器边缘**（不消失）✅
         *   -> 加 \`--sticky\` class -> CSS 给它**不透明 + 阴影**（和普通态区分）✅
         *   -> 用户知道"选区在别处，但工具条还在" ✅
         */
        position?.placement === 'sticky-top' || position?.placement === 'sticky-bottom'
          ? 'scpdf-selection-popover--sticky'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="toolbar"
      aria-label={t('selection.actions')}
      data-placement={position?.placement ?? 'bottom'}
      style={{
        /*
         * 位置还没算出来时（第一帧）：先渲染到 0,0 但**不可见**。
         * → 量得到真实尺寸 → 下一帧算出正确位置。
         * （如果不渲染就量不到 → 死锁）
         */
        top: position ? `${position.top}px` : '0px',
        left: position ? `${position.left}px` : '0px',
        visibility: position ? 'visible' : 'hidden',
      }}
      /*
       * ⚠️ **mousedown 不冒泡到 document**：
       * document 上的 mousedown 会关闭浮层 → 点里面的按钮就关了。
       */
      onMouseDown={(event) => event.stopPropagation()}
    >
      {/* 箭头（指向选区中心） */}
      <span
        className="scpdf-selection-popover__arrow"
        style={{ left: position ? `${position.arrowLeft}px` : '0px' }}
        aria-hidden="true"
        data-placement={position?.placement ?? 'bottom'}
      />

      <div className="scpdf-selection-popover__actions">
        {visibleActions.map((action, index) => {
          const prev = visibleActions[index - 1];
          const showDivider = prev !== undefined && prev.group !== action.group;

          /*
           * 🖍 高亮按钮是**分裂按钮**：
           * - 主按钮 = 用当前颜色高亮
           * - 旁边的小箭头 = 展开颜色下拉
           *
           * （原 scholar-club 也是这个交互，但它新高亮/编辑高亮用了**两套 UI**，
           *   我们统一成一个。）
           *
           * ⚠️ **高亮浮层里的"选择高亮颜色"也要能展开下拉**
           *    （用户反馈"第一个是高亮 但是没有什么效果"）。
           * → 判断条件要覆盖**两个** key：
           *    - `BUILTIN_ACTION_KEYS.highlight`（选区浮层的 🖍）
           *    - `HIGHLIGHT_ACTION_KEYS.color`（高亮浮层的 🖍）
           */
          const isHighlight =
            action.key === BUILTIN_ACTION_KEYS.highlight ||
            action.key === HIGHLIGHT_ACTION_KEYS.color;
          const showPalette = isHighlight && highlightPalette && onPickColor;

          return (
            <span key={action.key} className="scpdf-selection-popover__item">
              {showDivider ? (
                <span className="scpdf-selection-popover__divider" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                className="scpdf-selection-popover__btn"
                title={action.label}
                aria-label={action.label ?? action.key}
                onClick={(event) => {
                  event.stopPropagation();
                  /*
                   * ⚠️⚠️ **主按钮 = 【直接用当前色高亮】**（用户需求：
                   * "文字选取的高亮那里 如果没有选择颜色 也按照默认颜色来展示高亮
                   *  不必每次都选择颜色"✅）。
                   *
                   * ### 之前的行为（❌）
                   *
                   * → 主按钮**只**展开下拉 ❌
                   * → 用户**必须**选一次颜色才能高亮 ❌
                   *    → "第一个是高亮 但是没有什么效果" ✅
                   *
                   * ### 现在的行为（✅）
                   *
                   * → 点**主按钮** → **直接用"当前色"高亮** ✅
                   *    → 当前色 = 上次选的 ✅
                   *    → 没选过 = **宿主配的默认色** ✅（`color` 传 undefined → 走默认）
                   * → 点**旁边的箭头** → 展开颜色下拉 ✅
                   *    → 选一个色 → **立刻用那个色高亮** ✅
                   *    → 之后主按钮就用这个色 ✅
                   *
                   * → 这就是 **飞书 / WPS** 的交互 ✅
                   */
                  onAction?.(action);
                }}
              >
                {typeof action.icon === 'string' ? (
                  isBuiltinIcon(action.icon) ? (
                    <SelectionActionIconView name={action.icon} overrides={icons} />
                  ) : null
                ) : (
                  action.icon
                )}
                {/*
                 * ⚠️ **当前色的小色条**（飞书 / WPS 样式）✅
                 *
                 * -> 让用户**一眼看到**"点这个按钮会用哪个颜色" ✅
                 * -> 没选过颜色 -> 不显示（用的是默认色）✅
                 */}
                {showPalette && currentHighlightColor ? (
                  <span
                    className="scpdf-selection-popover__current"
                    style={{
                      background: highlightPalette?.[currentHighlightColor] ?? 'transparent',
                    }}
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              {showPalette ? (
                <button
                  type="button"
                  className="scpdf-selection-popover__btn scpdf-selection-popover__btn--split"
                  /*
                   * ⚠️ **title 和 aria-label 要一致**（实测踩到的坑）。
                   *
                   * -> 之前 `title="选择颜色"` + `aria-label="展开颜色下拉"` ❌
                   * -> 同一个按钮**两套说法** ❌ -> 用户说"title 变来变去" ✅
                   * -> -> 现在**都用同一个文案** ✅
                   */
                  title={t('selection.expandColor')}
                  aria-label={t('selection.expandColor')}
                  aria-expanded={paletteOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPaletteOpen((v) => !v);
                  }}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M1.5 2.5 L4 5 L6.5 2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}

              {showPalette && paletteOpen ? (
                <span className="scpdf-selection-popover__palette">
                  {Object.entries(highlightPalette).map(([key, color]) => {
                    /*
                     * ⚠️⚠️ **tooltip 要本地化**（实测踩到的坑，用户反馈：
                     * "选区的工具栏里面的中英文title还是会变来变去的
                     *  有时候hover上去 title显示中文 有时候英文"）。
                     *
                     * -> 之前 \`title={color}\` -> 直接显示**原始色值**（\`#ffd54a\`）❌
                     * -> 界面是中文也显示 \`#ffd54a\`，英文还是 \`#ffd54a\` ❌
                     * -> -> **和界面语言完全脱节** ❌
                     * -> -> 用户的体感就是"title 变来变去" ✅
                     *
                     * -> 现在按 key 查**本地化名字** ✅
                     * -> 宿主自定义的 key 查不到 -> **退回 key 本身** ✅
                     */
                    const colorName = resolveHighlightColorName(key, locale);
                    return (
                      <button
                        key={key}
                        type="button"
                        className="scpdf-selection-popover__swatch"
                        /*
                         * ⚠️ **当前选中的色块要标出来** ✅
                         * -> 用户一眼知道"现在用的是哪个颜色" ✅
                         */
                        data-active={key === currentHighlightColor ? 'true' : undefined}
                        style={{ background: color }}
                        title={colorName}
                        aria-label={colorName}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPickColor(key);
                          setPaletteOpen(false);
                        }}
                      />
                    );
                  })}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
