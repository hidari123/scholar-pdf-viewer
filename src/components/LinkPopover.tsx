/**
 * **链接弹窗**（自己写的，**不用 `window.prompt`**）。
 *
 * ## 用户需求
 *
 * > "链接弹窗是默认的弹窗 而且要先选中文字才行 应该按照飞书那种去添加
 * >  输入框有两行 第一行是链接 第二行是要展示的文字
 * >  如果选择了文字 就带到输入框里 这个输入框你自己写一个出来 不要用系统默认的框 很丑
 * >  如果用户没有选择文字 要展示的文字就默认是输入的网址
 * >  框内可以修改文字"
 *
 * ## 为什么不用 `window.prompt`
 *
 * - **阻塞**整个页面 -> 编辑器失焦 -> **选区丢失** ❌
 * - 样式**完全不可控**（系统样式）-> 用户反馈"很丑" ❌
 * - 只能输入**一个值** -> 没法同时填"链接"和"展示文字" ❌
 *
 * ## 交互（按需求）
 *
 * | 场景 | 第 1 行（链接） | 第 2 行（展示文字） |
 * |---|---|---|
 * | **选了文字** | 空（等你填） | **自动带上选中的文字** |
 * | **没选文字** | 空（等你填） | **默认等于第 1 行的网址**，可改 |
 *
 * → 第 2 行**跟着第 1 行实时联动** ✅
 * → 但**用户手动改过第 2 行**后 -> **不再跟随** ✅（不覆盖用户的编辑）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface LinkPopoverProps {
  /** 是否打开 */
  open: boolean;
  /** 锚点按钮的位置（视口坐标）-> 弹窗贴着它显示 */
  anchor?: { left: number; top: number; right: number; bottom: number } | null;
  /** 当前选中的文字（没选就是空串） */
  selectedText: string;
  /** 确定：回调（链接 + 展示文字） */
  onSubmit: (href: string, text: string) => void;
  /** 取消 */
  onCancel: () => void;
  /** 文案 */
  labels: {
    href: string;
    text: string;
    confirm: string;
    cancel: string;
    placeholderHref: string;
    placeholderText: string;
  };
  /** 宿主可覆盖图标 */
  icons?: { check?: ReactNode; close?: ReactNode };
}

/**
 * **链接弹窗**。
 */
export function LinkPopover(props: LinkPopoverProps) {
  const { open, anchor, selectedText, onSubmit, onCancel, labels } = props;

  const [href, setHref] = useState('');
  const [text, setText] = useState('');
  /** 用户**手动改过**第 2 行 -> 之后不再跟着第 1 行联动 */
  const [textTouched, setTextTouched] = useState(false);

  const hrefRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);

  /**
   * **打开时重置**（带上选中的文字）。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    setHref('');
    setText(selectedText);
    setTextTouched(false);
    // 聚焦第 1 行（链接）-> 用户直接就能输入
    window.setTimeout(() => {
      hrefRef.current?.focus();
    }, 0);
  }, [open, selectedText]);

  /**
   * **第 1 行 -> 第 2 行联动**（用户没手动改过第 2 行时）。
   *
   * → 用户填了链接 -> 第 2 行自动变成同一个网址 ✅
   * → 用户手动改过第 2 行 -> **不再跟随** ✅
   */
  useEffect(() => {
    if (textTouched) {
      return;
    }
    setText(href);
  }, [href, textTouched]);

  /**
   * **位置**：贴在锚点按钮**下方**（放不下就放上面）。
   */
  const position = useMemo(() => {
    if (!anchor) {
      return null;
    }
    const margin = 12;
    const gap = 6;
    const width = 340;
    const height = 168;

    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;

    // 水平：贴着锚点左边缘，但不能出视口
    let left = anchor.left;
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

    // 垂直：默认在下方；下方放不下就放上方；都放不下就贴视口中间
    let top = anchor.bottom + gap;
    if (top + height > viewportHeight - margin) {
      const above = anchor.top - gap - height;
      top = above >= margin ? above : Math.max(margin, (viewportHeight - height) / 2);
    }

    return { left, top, width };
  }, [anchor]);

  const handleSubmit = useCallback(() => {
    const trimmed = href.trim();
    if (!trimmed) {
      return;
    }
    // 没协议 -> 补上 https://
    const normalized = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    onSubmit(normalized, text.trim() || normalized);
  }, [href, text, onSubmit]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="scpdf-link-popover"
      style={
        position
          ? { position: 'fixed', left: position.left, top: position.top, width: position.width }
          : undefined
      }
      role="dialog"
      aria-label={labels.href}
      /*
       * ⚠️ **点弹窗内部不要关**（外面才关）。
       * → 靠 `onMouseDown` + `stopPropagation` ✅
       */
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
    >
      {/* 第 1 行：链接 */}
      <label className="scpdf-link-popover__field">
        <span className="scpdf-link-popover__label">{labels.href}</span>
        <input
          ref={hrefRef}
          type="text"
          className="scpdf-link-popover__input"
          value={href}
          placeholder={labels.placeholderHref}
          onChange={(event) => {
            setHref(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleSubmit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </label>

      {/* 第 2 行：展示文字 */}
      <label className="scpdf-link-popover__field">
        <span className="scpdf-link-popover__label">{labels.text}</span>
        <input
          ref={textRef}
          type="text"
          className="scpdf-link-popover__input"
          value={text}
          placeholder={labels.placeholderText}
          onChange={(event) => {
            setTextTouched(true);
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleSubmit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </label>

      {/* 底部按钮 */}
      <div className="scpdf-link-popover__foot">
        <button
          type="button"
          className="scpdf-link-popover__btn"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onCancel}
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          className="scpdf-link-popover__btn scpdf-link-popover__btn--primary"
          disabled={!href.trim()}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={handleSubmit}
        >
          {labels.confirm}
        </button>
      </div>
    </div>
  );
}
