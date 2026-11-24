/**
 * **缩放比例输入框**（工具栏里的 "100%"）。
 *
 * ## 为什么需要（用户反馈）
 *
 * > "放大缩小这个 是可以用户进行填写比例的
 * >  包默认最大是250%，最小是20%，这个上限下限宿主也可以配置，
 * >  包括是否用户可以填写 这个宿主也要可以进行配置"
 *
 * ## 行为
 *
 * -> **平时显示**当前比例（"100%"）✅
 * -> **点一下** -> 变成**输入框** ✅（像页码输入框那样）
 * -> 填数字 + **回车** -> 生效 ✅
 * -> **Esc** -> 放弃修改 ✅
 * -> **失焦** -> 生效 ✅（用户直接点别处）
 * -> 填的值会：
 *   - **夹到** [min, max] ✅
 *   - **量化到** 10% 一档 ✅（和 +/- 按钮一致）
 *
 * ## 上下限
 *
 * -> 由宿主通过 \`minScale\` / \`maxScale\` 配置 ✅
 * -> 不传 -> 20% ~ 250% ✅
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SCALE_QUANTUM } from '../hooks/useZoom';

/** ScaleInput 参数 */
export interface ScaleInputProps {
  /** 当前比例（1 = 100%） */
  scale: number;
  /** 应用新的比例 */
  onScaleChange: (scale: number) => void;
  /** 最小比例（默认 0.2） */
  min?: number;
  /** 最大比例（默认 2.5） */
  max?: number;
  /** 能不能填写（默认 true） */
  allowInput?: boolean;
  /** 文案（无障碍标签） */
  label?: string;
}

/**
 * 缩放比例输入框。
 *
 * @param props 参数
 */
export function ScaleInput(props: ScaleInputProps) {
  const { scale, onScaleChange, min = 0.2, max = 2.5, allowInput = true, label } = props;

  /** 是否处于"编辑中" */
  const [editing, setEditing] = useState(false);

  /** 草稿值（用户正在输入的内容） */
  const [draft, setDraft] = useState('');

  /** 输入框 ref */
  const inputRef = useRef<HTMLInputElement | null>(null);

  /*
   * ⚠️ **进入编辑模式时**把当前比例填进去。
   *
   * -> 显示的是百分比（"125"），不是小数（"1.25"）✅
   * -> 用户直接看到自己熟悉的单位 ✅
   */
  useEffect(() => {
    if (editing) {
      setDraft(String(Math.round(scale * 100)));
      // 聚焦 + 全选（用户可以直接覆盖）
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, scale]);

  /**
   * **提交草稿值**。
   *
   * ⚠️ **夹到上下限 + 量化到 10%** ✅
   * -> 和 +/- 按钮的行为**一致** ✅
   * -> 用户填 137% -> 实际 140% ✅
   */
  const commit = useCallback(() => {
    const percent = Number.parseFloat(draft);
    setEditing(false);

    if (!Number.isFinite(percent)) {
      return;
    }

    // 夹到 [min, max]
    const lo = min < max ? min : 0.2;
    const hi = min < max ? max : 2.5;
    const clamped = Math.min(hi, Math.max(lo, percent / 100));

    // 量化到 10% 一档（和 +/- 按钮一致）
    const quantized = Math.round(clamped / SCALE_QUANTUM) * SCALE_QUANTUM;

    if (Math.abs(quantized - scale) > 0.0001) {
      onScaleChange(quantized);
    }
  }, [draft, min, max, scale, onScaleChange]);

  /** 取消编辑 */
  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (!allowInput) {
    // 只读模式
    return (
      <span className="scpdf-toolbar__scale" aria-live="polite" title={label}>
        {Math.round(scale * 100)}%
      </span>
    );
  }

  if (editing) {
    return (
      <span className="scpdf-toolbar__scale scpdf-toolbar__scale--editing">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className="scpdf-toolbar__scale-input"
          value={draft}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
        />
        <span aria-hidden="true">%</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="scpdf-toolbar__scale scpdf-toolbar__scale--editable"
      title={label}
      onClick={() => setEditing(true)}
    >
      {Math.round(scale * 100)}%
    </button>
  );
}
