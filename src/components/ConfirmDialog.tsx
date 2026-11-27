/**
 * ConfirmDialog —— 通用确认框。
 *
 * ## 为什么自研（不用浏览器的 `window.confirm`）
 *
 * -> `window.confirm` **没法定制** ❌
 *    -> 按钮文字跟随浏览器语言 ❌ -> 没法走 i18n ❌
 *    -> 样式**跟随系统** ❌ -> 深色模式下可能看不清 ❌
 *    -> **没法截图** ❌ -> E2E 测不了 ❌
 *    -> 阻塞整个页面 ❌ -> 渲染线程**卡住** ❌
 * -> 包**自研**一个 ✅ -> 样式可控 ✅ -> 文案走 i18n ✅ -> E2E 可测 ✅
 *
 * ## 用途
 *
 * -> "清除全部高亮"这种**不可撤销**的操作 ✅
 * -> 宿主也可以直接用这个组件做自己的确认框 ✅
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** ConfirmDialog 参数 */
export interface ConfirmDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 标题 */
  title: string;
  /** 正文（可为空） */
  message?: string;
  /** 确定按钮的文字 */
  confirmText?: string;
  /** 取消按钮的文字 */
  cancelText?: string;
  /** 确定按钮是不是"危险"操作（红色） */
  danger?: boolean;
  /** 点确定 */
  onConfirm: () => void;
  /** 点取消 / 按 Esc / 点遮罩 */
  onCancel: () => void;
  /** 语言 */
  locale?: Locale;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
}

/**
 * 确认框。
 *
 * @param props 参数
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open,
    title,
    message,
    confirmText,
    cancelText,
    danger = false,
    onConfirm,
    onCancel,
    locale = 'zh',
    messages,
    locales,
  } = props;

  /** 确定按钮 ref（打开时聚焦，键盘用户能直接回车确认） */
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages, undefined, locales),
    [locale, messages, locales],
  );

  /**
   * 打开时聚焦"确定"按钮。
   *
   * ⚠️ 用 `setTimeout` ✅ -> 等 DOM 真的渲染出来再聚焦 ✅
   */
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const timer = setTimeout(() => confirmRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  /**
   * ⚠️ **Esc 关闭**（用户预期 ✅）。
   *
   * -> 监听在 `window` 上 ✅ -> 焦点在框里也能触发 ✅
   */
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className="scpdf-dialog__mask">
      {/*
       * ⚠️ **遮罩是一个真正的 `<button>`**（点了等于取消 ✅）。
       *
       * -> 不用 `<div onClick>` ✅ -> 那样**键盘不可达** ✅
       *    -> biome 的 `useSemanticElements` / `useKeyWithClickEvents` 会报错 ✅
       * -> 用 `<button>` ✅ -> 语义对 ✅ -> 键盘也能用 ✅
       * -> `aria-hidden` ✅ -> 屏幕阅读器**不用读**它 ✅
       *    -> 它只是个"点空白取消"的快捷方式 ✅
       */}
      <button
        type="button"
        className="scpdf-dialog__backdrop"
        aria-label={cancelText ?? t('common.cancel')}
        onClick={onCancel}
      />
      <div
        className="scpdf-dialog scpdf-dialog--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="scpdf-dialog__title">{title}</h2>

        {message ? <p className="scpdf-dialog__message">{message}</p> : null}

        <div className="scpdf-dialog__actions">
          <button type="button" className="scpdf-btn" onClick={onCancel}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`scpdf-btn ${danger ? 'scpdf-btn--danger' : 'scpdf-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
