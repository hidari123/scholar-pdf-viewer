/**
 * **主题选择器**（工具栏里的 🎨 按钮 + 下拉列表）。
 *
 * ## 为什么需要（用户反馈）
 *
 * > "主题应该是包里面内置的 然后宿主可以进行选择配置
 * >  包在工具栏那里也可以加上一个按钮让用户进行选择"
 *
 * ### 现状（❌）
 *
 * -> `core/theme` 里**已经有** 7 个内置主题（`THEMES`）✅
 * -> `theme` prop **也能配** ✅
 * -> 但**包的工具栏没有入口** ❌ -> 只有 demo 的 header 里有个 `<select>` ❌
 *    -> 宿主要自己**另外做一个**切换 UI ❌
 *
 * ### 现在的行为（✅）
 *
 * -> 工具栏右上角有一个**独立分组**的 🎨 按钮 ✅
 * -> 点它 -> 弹出**主题列表**（7 个）✅
 * -> 点一个 -> 调 `onThemeChange(theme)` ✅
 * -> 宿主**不用**自己写切换 UI ✅
 *
 * ### 主题是**受控**的（controlled）
 *
 * -> 包**不自己存**主题状态 ✅
 * -> 调 `onThemeChange` -> **宿主**改 `theme` prop ✅
 * -> 宿主也可以**完全不用**这个按钮（`features.themePicker === false`）✅
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfViewerTheme } from '../core/theme';
import { THEME_LABELS_I18N } from '../core/theme';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';

/** ThemePicker 参数 */
export interface ThemePickerProps {
  /** 当前主题 */
  theme?: PdfViewerTheme;
  /** 切换主题（宿主改 `theme` prop） */
  onThemeChange?: (theme: PdfViewerTheme) => void;
  /**
   * **可选的主题列表**（宿主可自定义）。
   *
   * -> 不传 -> 用**内置的全部 7 个** ✅
   */
  themes?: readonly PdfViewerTheme[];
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
 * 主题选择器。
 *
 * @param props 参数
 */
export function ThemePicker(props: ThemePickerProps) {
  const { theme = 'auto', onThemeChange, themes, locale = 'zh', locales, messages, icons } = props;

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
   * ⚠️ **点外面关闭**。
   *
   * -> 和高亮色板的行为**保持一致** ✅
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

  const options = themes ?? (Object.keys(THEME_LABELS_I18N.zh ?? {}) as PdfViewerTheme[]);

  /*
   * ⚠️ **主题名的多语言**。
   *
   * -> 之前 demo 的下拉框用 `THEME_LABELS`（**永远是中文**）❌
   * -> 用户反馈："切换语言还是没变啊 下拉框选择语言之后
   *   发现页面上语言还是没换啊" ✅
   * -> 现在用 `THEME_LABELS_I18N` -> **跟着语言走** ✅
   */
  const labelFor = (key: PdfViewerTheme): string => {
    const table = THEME_LABELS_I18N[locale] ?? THEME_LABELS_I18N.zh;
    return table?.[key] ?? key;
  };

  return (
    <div className="scpdf-theme-picker" ref={rootRef}>
      <button
        type="button"
        className="scpdf-toolbar__btn"
        aria-label={t('theme.picker')}
        title={t('theme.picker')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="palette" title={t('theme.picker')} overrides={icons} />
      </button>

      {open ? (
        <div className="scpdf-theme-picker__menu" role="menu">
          {options.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={key === theme}
              className="scpdf-theme-picker__item"
              data-active={key === theme ? 'true' : undefined}
              onClick={() => {
                onThemeChange?.(key);
                setOpen(false);
              }}
            >
              <span className="scpdf-theme-picker__swatch" data-theme={key} aria-hidden="true" />
              <span className="scpdf-theme-picker__label">{labelFor(key)}</span>
              {key === theme ? (
                <Icon name="check" title={t('theme.current')} overrides={icons} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
