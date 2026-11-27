/**
 * **工具栏的"高亮"按钮**（分裂按钮：主按钮 + 颜色下拉箭头）。
 *
 * ## 为什么需要（用户反馈）
 *
 * > "包工具栏的高亮也需要加个下拉箭头 可以选择颜色
 * >  如果没有选就是默认的高亮色"
 *
 * ### 现状（❌）
 *
 * -> 包的工具栏**根本没有"高亮"按钮** ❌
 * -> 只有 **demo 的 header** 里有个"添加高亮"按钮  （`demo/src/App.tsx`）
 * -> 宿主想用包的工具栏做高亮 -> **得自己写一个** ❌
 *
 * ### 现在的行为（）
 *
 * -> 传 `onToolbarHighlight` -> 工具栏出现 **🖍 + ▾** 的分裂按钮
 * -> 点**主按钮** -> **直接用"当前色"高亮**
 *    -> 当前色 = 上次选的；没选过 = **默认色**
 * -> 点**箭头** -> 展开颜色下拉
 *    -> 选一个色 -> **立刻用那个色高亮**
 * -> **不传 `onToolbarHighlight` -> 不渲染**
 *    -> 宿主自己已经有"加高亮"按钮 -> 不重复
 *    -> 用户确认："默认隐藏吧"
 *
 * ### 交互和选区浮层**完全一致**（飞书 / WPS）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HighlightPalette } from '../core/highlight/palette';
import { BUILTIN_HIGHLIGHT_PALETTE, resolveHighlightColorName } from '../core/highlight/palette';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';

/**
 * **兜底的默认色**（宿主没传 `defaultColor` 时用）。
 *
 * -> 内置色板的第一个 key ✅ -> 保证主按钮的色条**不是透明** ✅
 */
const FALLBACK_HIGHLIGHT_COLOR = Object.keys(BUILTIN_HIGHLIGHT_PALETTE)[0] ?? 'yellow';

/** 参数 */
export interface ToolbarHighlightButtonProps {
  /**
   * **点主按钮**（用当前色高亮）。
   *
   * @param color 语义 key（宿主用 key 存"用户选的颜色"）
   */
  onHighlight?: (color: string) => void;
  /** 色板（语义 key -> CSS 颜色） */
  palette?: HighlightPalette;
  /** **默认色**的 key（没选过颜色时用） */
  defaultColor?: string;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
}

/**
 * 工具栏的高亮按钮。
 *
 * @param props 参数
 */
export function ToolbarHighlightButton(props: ToolbarHighlightButtonProps) {
  const { onHighlight, palette, defaultColor, locale = 'zh', locales, messages, icons } = props;

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  /** 下拉是否展开 */
  const [open, setOpen] = useState(false);

  /*
   * ⚠️ **色板的位置**（视口坐标 ✅）
   *
   * -> 色板是 `position: fixed` ✅ -> 坐标由 JS 算 ✅
   * -> 和主题菜单**同一套做法** ✅（`ThemePicker.tsx` ✅）
   *
   * ### 为什么不能用绝对定位 ✅
   *
   * -> 之前是 `position: absolute` + CSS 写死 `right: 0` ❌
   * -> 祖先 `.scpdf-toolbar__right` 有 `overflow-x: auto` ✅
   *    -> 浏览器会把它**强制变成** `overflow-y: auto` ✅（一个轴非 visible ✅）
   *    -> 色板在工具栏**下面** ✅ -> **被裁掉** ✅ ❌
   *    -> 实测：菜单在容器下方 76px ✅ -> 可见高度 -6px ✅（完全看不见 ✅）
   *    -> 而且容器**多出一条纵向滚动条** ✅ ❌（用户反馈 ✅）
   */
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  /** 容器 ref（点外面关闭） */
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * ⚠️ **当前色**（上次选的；没选过 = 默认色）
   */
  const [currentColor, setCurrentColor] = useState<string | null>(
    defaultColor ?? FALLBACK_HIGHLIGHT_COLOR,
  );

  /*
   * ⚠️ **默认色变了就跟着变**（宿主改配置）
   */
  useEffect(() => {
    setCurrentColor(defaultColor ?? FALLBACK_HIGHLIGHT_COLOR);
  }, [defaultColor]);

  /*
   * ⚠️ **展开时算色板的位置**（照抄主题菜单的做法 ✅）
   *
   * -> 量箭头的位置 ✅ -> 色板**右边缘**对齐箭头右边缘 ✅
   * -> 下方放不下 -> **翻到上方** ✅
   */
  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const button = rootRef.current?.querySelector('button[aria-haspopup="menu"]');
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    // 色板宽 156px ✅（CSS 里写死的 ✅）
    const menuWidth = 156;
    const menuHeight = 8 + 24 * 3 + 4 * 2 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;

    const top =
      spaceBelow < menuHeight && rect.top > menuHeight
        ? rect.top - menuHeight - 4
        : rect.bottom + 4;

    setMenuPos({
      top,
      left: Math.max(8, rect.right - menuWidth),
    });
  }, [open]);

  /*
   * ⚠️ **点外面关闭**（和高亮色板的行为保持一致）
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /*
   * ⚠️ **没有色板 -> 用内置的**（宿主不传也能有下拉 ✅）
   *
   * -> 用户需求："包工具栏的高亮也需要加个下拉箭头 可以选择颜色"
   * -> 宿主不传 `highlightPalette` ✅ -> 不该**没有下拉** ✅
   */
  const effectivePalette = palette ?? BUILTIN_HIGHLIGHT_PALETTE;
  const paletteEntries = Object.entries(effectivePalette);

  /*
   * ⚠️ **没有色板 -> 只画主按钮**（没有下拉）
   */
  if (paletteEntries.length === 0) {
    return (
      <button
        type="button"
        className="scpdf-toolbar__btn"
        title={t('selection.actionHighlight')}
        aria-label={t('selection.actionHighlight')}
        onClick={() => onHighlight?.(currentColor ?? defaultColor ?? '')}
        disabled={!onHighlight}
      >
        <Icon name="highlight" title={t('selection.actionHighlight')} overrides={icons} />
      </button>
    );
  }

  return (
    <div className="scpdf-toolbar__split" ref={rootRef}>
      <button
        type="button"
        className="scpdf-toolbar__btn scpdf-toolbar__btn--split-main"
        title={t('selection.actionHighlight')}
        aria-label={t('selection.actionHighlight')}
        onClick={() => onHighlight?.(currentColor ?? defaultColor ?? '')}
        /*
         * ⚠️ **没有回调 -> 置灰**
         *
         * -> `showHighlight: true` 但宿主还没接回调 ✅
         * -> 点了没反应 ✅ -> 用户会以为按钮坏了 ❌
         * -> -> 置灰 ✅ -> 一眼看出"还没接上" ✅
         */
        disabled={!onHighlight}
      >
        <Icon name="highlight" title={t('selection.actionHighlight')} overrides={icons} />
        {/*
         * ⚠️ **当前色的小色条**（飞书 / WPS 样式）
         * -> 一眼看到"点这个会用哪个颜色"
         */}
        <span
          className="scpdf-toolbar__current-color"
          style={{
            background: effectivePalette[currentColor ?? defaultColor ?? ''] ?? 'transparent',
          }}
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        className="scpdf-toolbar__btn scpdf-toolbar__btn--split-arrow"
        title={t('selection.expandColor')}
        aria-label={t('selection.expandColor')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
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

      {open ? (
        <div
          className="scpdf-toolbar__color-menu"
          role="menu"
          style={menuPos ? { top: menuPos.top, left: menuPos.left } : { visibility: 'hidden' }}
        >
          {paletteEntries.map(([key, color]) => {
            const colorName = resolveHighlightColorName(key, locale);
            return (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={key === currentColor}
                className="scpdf-toolbar__color-swatch"
                data-active={key === currentColor ? 'true' : undefined}
                style={{ background: color }}
                title={colorName}
                aria-label={colorName}
                onClick={() => {
                  setCurrentColor(key);
                  setOpen(false);
                  /*
                   * ⚠️ **选了颜色就立刻高亮**（和选区浮层一致）
                   */
                  onHighlight?.(key);
                }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
