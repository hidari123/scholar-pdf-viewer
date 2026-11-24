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
 * -> 只有 **demo 的 header** 里有个"添加高亮"按钮 ✅（`demo/src/App.tsx`）
 * -> 宿主想用包的工具栏做高亮 -> **得自己写一个** ❌
 *
 * ### 现在的行为（✅）
 *
 * -> 传 `onToolbarHighlight` -> 工具栏出现 **🖍 + ▾** 的分裂按钮 ✅
 * -> 点**主按钮** -> **直接用"当前色"高亮** ✅
 *    -> 当前色 = 上次选的；没选过 = **默认色** ✅
 * -> 点**箭头** -> 展开颜色下拉 ✅
 *    -> 选一个色 -> **立刻用那个色高亮** ✅
 * -> **不传 `onToolbarHighlight` -> 不渲染** ✅
 *    -> 宿主自己已经有"加高亮"按钮 -> 不重复 ✅
 *    -> 用户确认："默认隐藏吧" ✅
 *
 * ### 交互和选区浮层**完全一致**（飞书 / WPS）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HighlightPalette } from '../core/highlight/palette';
import { resolveHighlightColorName } from '../core/highlight/palette';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';

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

  /** 容器 ref（点外面关闭） */
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * ⚠️ **当前色**（上次选的；没选过 = 默认色）✅
   */
  const [currentColor, setCurrentColor] = useState<string | null>(defaultColor ?? null);

  /*
   * ⚠️ **默认色变了就跟着变**（宿主改配置）✅
   */
  useEffect(() => {
    setCurrentColor(defaultColor ?? null);
  }, [defaultColor]);

  /*
   * ⚠️ **点外面关闭**（和高亮色板的行为保持一致）✅
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

  const paletteEntries = Object.entries(palette ?? {});

  /*
   * ⚠️ **没有色板 -> 只画主按钮**（没有下拉）✅
   */
  if (paletteEntries.length === 0) {
    return (
      <button
        type="button"
        className="scpdf-toolbar__btn"
        title={t('selection.actionHighlight')}
        aria-label={t('selection.actionHighlight')}
        onClick={() => onHighlight?.(currentColor ?? defaultColor ?? '')}
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
      >
        <Icon name="highlight" title={t('selection.actionHighlight')} overrides={icons} />
        {/*
         * ⚠️ **当前色的小色条**（飞书 / WPS 样式）✅
         * -> 一眼看到"点这个会用哪个颜色" ✅
         */}
        <span
          className="scpdf-toolbar__current-color"
          style={{
            background: palette?.[currentColor ?? defaultColor ?? ''] ?? 'transparent',
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
        <div className="scpdf-toolbar__color-menu" role="menu">
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
                   * ⚠️ **选了颜色就立刻高亮**（和选区浮层一致）✅
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
