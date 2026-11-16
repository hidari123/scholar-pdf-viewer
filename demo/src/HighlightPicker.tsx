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

/** 内置预设色（宿主的业务选择，包不内置） */
const PRESET_COLORS = [
  { key: 'yellow', label: '黄', color: '#ffd54a' },
  { key: 'green', label: '绿', color: '#a5d6a7' },
  { key: 'blue', label: '蓝', color: '#90caf9' },
  { key: 'pink', label: '粉', color: '#f48fb1' },
  { key: 'purple', label: '紫', color: '#ce93d8' },
  { key: 'orange', label: '橙', color: '#ffcc80' },
] as const;

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
}: HighlightPickerProps) {
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
          title={`${item.label}（${item.color}）`}
          aria-label={`高亮色 ${item.label}`}
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
          title={`自定义 ${color}`}
          aria-label={`自定义高亮色 ${color}`}
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
        title="自定义颜色"
        aria-label="选择自定义高亮颜色"
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
        className="scpdf-toolbar__btn"
        onClick={() => {
          const key = `custom-${draft.replace('#', '')}`;
          onSaveCustom?.(key, draft);
          onChange(key, draft);
        }}
        title="保存当前颜色"
        aria-label="保存自定义高亮颜色"
        style={{ fontSize: 12, padding: '2px 6px' }}
      >
        用此色
      </button>

      {/* 供宿主读取：当前 palette */}
      <span style={{ display: 'none' }} data-palette={JSON.stringify(allColors)} />
    </div>
  );
}

export { PRESET_COLORS };
