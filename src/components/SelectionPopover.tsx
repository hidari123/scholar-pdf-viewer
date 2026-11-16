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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HighlightPalette } from '../core/highlight/palette';
import type { SelectionAction } from '../core/selection/actions';
import { BUILTIN_ACTION_KEYS, isBuiltinIcon } from '../core/selection/actions';
import type { PopoverPosition } from '../core/selection/popover-position';
import { computePopoverPosition } from '../core/selection/popover-position';
import { SelectionActionIconView } from './SelectionActionIcons';

/** SelectionPopover 参数 */
export interface SelectionPopoverProps {
  /** 是否显示 */
  open: boolean;
  /** 选区矩形（视口坐标） */
  selectionRect: { left: number; top: number; right: number; bottom: number } | null;
  /** 容器矩形（视口坐标）—— PDF 的可视区 */
  containerRect: { left: number; top: number; right: number; bottom: number } | null;
  /** 要显示的动作 */
  actions: SelectionAction[];
  /** 点击动作 */
  onAction?: (action: SelectionAction) => void;
  /** 关闭 */
  onClose?: () => void;
  /**
   * 高亮色板（语义 key → CSS 颜色）。
   *
   * 传了才显示 🖍 按钮旁边的**颜色下拉**。
   */
  highlightPalette?: HighlightPalette;
  /** 选颜色（key） */
  onPickColor?: (key: string) => void;
}

/**
 * 选区浮层。
 *
 * @param props 参数
 */
export function SelectionPopover({
  open,
  selectionRect,
  containerRect,
  actions,
  onAction,
  onClose,
  highlightPalette,
  onPickColor,
}: SelectionPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  /** 颜色下拉是否展开 */
  const [paletteOpen, setPaletteOpen] = useState(false);

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
   */
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  // 尺寸变化（动作数量/标签变化）→ 重新测量
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
  useLayoutEffect(() => {
    if (!open || !selectionRect || !containerRect || !measured) {
      setPosition(null);
      return;
    }

    setPosition(
      computePopoverPosition({
        selection: selectionRect,
        toolbar: measured,
        container: containerRect,
      }),
    );
  }, [open, selectionRect, containerRect, measured]);

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
      onClose?.();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const visibleActions = actions.filter((action) => !action.disabled);

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
      className="scpdf-selection-popover"
      role="toolbar"
      aria-label="选区操作"
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
           */
          const isHighlight = action.key === BUILTIN_ACTION_KEYS.highlight;
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
                  onAction?.(action);
                }}
              >
                {typeof action.icon === 'string' ? (
                  isBuiltinIcon(action.icon) ? (
                    <SelectionActionIconView name={action.icon} />
                  ) : null
                ) : (
                  action.icon
                )}
              </button>

              {showPalette ? (
                <button
                  type="button"
                  className="scpdf-selection-popover__btn scpdf-selection-popover__btn--split"
                  title="选择颜色"
                  aria-label="选择高亮颜色"
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
                  {Object.entries(highlightPalette).map(([key, color]) => (
                    <button
                      key={key}
                      type="button"
                      className="scpdf-selection-popover__swatch"
                      style={{ background: color }}
                      title={color}
                      aria-label={`高亮色 ${key}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPickColor(key);
                        setPaletteOpen(false);
                      }}
                    />
                  ))}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
