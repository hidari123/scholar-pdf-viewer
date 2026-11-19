/**
 * 高亮颜色选择器（**宿主侧**的 UI）。
 *
 * ⚠️ **这个组件属于宿主，不属于包**：
 * - 取色器 UI、预设色板、用户自定义颜色的持久化 → 全部是业务/交互
 * - 包只提供两条通道：
 *   1. `highlightPalette` prop —— 语义 key → CSS 颜色
 *   2. `HighlightRecord.color` —— 存语义 key（不是颜色值）
 *
 * 这样包保持"只做 PDF"，换后端/换 UI 都不用动包。
 */

import { useMemo, useState } from 'react';
import type { DemoLocale } from './demo-i18n';
import { demoText } from './demo-i18n';

/** 内置预设色（宿主的业务选择，包不内置） */
const PRESET_COLORS = [
  { key: 'yellow', color: '#ffd54a' },
  { key: 'green', color: '#a5d6a7' },
  { key: 'blue', color: '#90caf9' },
  { key: 'pink', color: '#f48fb1' },
  { key: 'purple', color: '#ce93d8' },
  { key: 'orange', color: '#ffcc80' },
] as const;

/** 预设色的名字（国际化） */
const COLOR_LABEL_KEYS: Record<string, string> = {
  yellow: 'demo.color.yellow',
  green: 'demo.color.green',
  blue: 'demo.color.blue',
  pink: 'demo.color.pink',
  purple: 'demo.color.purple',
  orange: 'demo.color.orange',
};

/** HighlightPicker 参数 */
export interface HighlightPickerProps {
  /** 当前选中的颜色 key */
  value: string;
  /** 选颜色（key + 实际颜色） */
  onChange: (key: string, color: string) => void;
  /** 用户自定义的颜色列表（key → 颜色） */
  customColors?: Record<string, string>;
  /** 保存自定义颜色 */
  onSaveCustom?: (key: string, color: string) => void;
  /**
   * **语言**（宿主侧的文案）。
   *
   * → 用户反馈："切换语言还是没变啊"
   * → 这个选择器是**宿主组件** → 它的文案也得跟着切 ✅
   */
  locale?: DemoLocale;
}

/**
 * 高亮颜色选择器。
 *
 * @param props 参数
 */
export function HighlightPicker({
  value,
  onChange,
  customColors = {},
  onSaveCustom,
  locale = 'zh',
}: HighlightPickerProps) {
  /** 取文案 */
  const t = (key: string, vars?: Record<string, string | number>) => demoText(locale, key, vars);
  const [draft, setDraft] = useState('#ffd54a');

  /** 预设 + 自定义，合成宿主要传给包的 palette */
  const allColors = useMemo(() => {
    const result: Record<string, string> = {};
    for (const item of PRESET_COLORS) {
      result[item.key] = item.color;
    }
    return { ...result, ...customColors };
  }, [customColors]);

  /** 自定义颜色的条目 */
  const customEntries = useMemo(() => Object.entries(customColors), [customColors]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      {PRESET_COLORS.map((item) => (
        <button
          key={item.key}
          type="button"
          title={`${t(COLOR_LABEL_KEYS[item.key] ?? item.key)}（${item.color}）`}
          aria-label={t('demo.colorOf', { name: t(COLOR_LABEL_KEYS[item.key] ?? item.key) })}
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key, item.color)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: item.color,
            cursor: 'pointer',
            border: value === item.key ? '2px solid var(--scpdf-color-primary)' : '1px solid #ccc',
          }}
        />
      ))}

      {customEntries.map(([key, color]) => (
        <button
          key={key}
          type="button"
          title={t('demo.customColor', { color })}
          aria-label={t('demo.customColorName', { color })}
          aria-pressed={value === key}
          onClick={() => onChange(key, color)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: color,
            cursor: 'pointer',
            border: value === key ? '2px solid var(--scpdf-color-primary)' : '1px solid #ccc',
          }}
        />
      ))}

      {/* 取色器：用户自己调颜色 */}
      <input
        type="color"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        title={t('demo.customColorTitle')}
        aria-label={t('demo.pickCustomColor')}
        style={{
          width: 26,
          height: 22,
          padding: 0,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: 'none',
          cursor: 'pointer',
        }}
      />

      <button
        type="button"
        className="scpdf-toolbar__btn scpdf-toolbar__btn--swatch"
        onClick={() => {
          const key = `custom-${draft.replace('#', '')}`;
          onSaveCustom?.(key, draft);
          onChange(key, draft);
        }}
        title={t('demo.saveColor')}
        aria-label={t('demo.saveCustomColor')}
        style={{ fontSize: 12, padding: '2px 6px' }}
      >
        {t('demo.useThisColor')}
      </button>

      {/* 供宿主读取：当前 palette */}
      <span style={{ display: 'none' }} data-palette={JSON.stringify(allColors)} />
    </div>
  );
}

export { PRESET_COLORS };
