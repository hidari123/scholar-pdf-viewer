/**
 * PasswordDialog —— 加密文档的密码输入框。
 *
 * 为什么包内提供：加密 PDF 是**通用场景**（不是业务），
 * 包不提供的话每个宿主都要重写一遍。
 *
 * 但**包不知道该不该弹** → 由宿主通过 `onRequestPassword` 决定，
 * 包只提供"怎么问"的 UI。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** PasswordDialog 参数 */
export interface PasswordDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 提交密码（宿主拿去重试加载） */
  onSubmit: (password: string) => void;
  /** 取消 */
  onCancel: () => void;
  /** 上次是否密码错误（用于提示） */
  wrongPassword?: boolean;
  /** 语言 */
  locale?: Locale;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
}

/**
 * 密码框。
 *
 * @param props 参数
 */
export function PasswordDialog(props: PasswordDialogProps) {
  const { open, onSubmit, onCancel, wrongPassword = false, locale = 'zh', messages } = props;

  const [password, setPassword] = useState('');

  /** 输入框 ref（打开时自动聚焦） */
  const inputRef = useRef<HTMLInputElement | null>(null);

  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages),
    [locale, messages],
  );

  // 打开时聚焦 + 清空
  useEffect(() => {
    if (open) {
      setPassword('');
      // 等 DOM 渲染完再聚焦
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // 关闭时清空密码（不留敏感信息在内存里）
  useEffect(() => {
    if (!open) {
      setPassword('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="scpdf-dialog__mask" role="presentation">
      <div
        className="scpdf-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('password.title')}
      >
        <h2 className="scpdf-dialog__title">{t('password.title')}</h2>

        {wrongPassword ? (
          <p className="scpdf-dialog__error" role="alert">
            {t('password.wrong')}
          </p>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password.length > 0) {
              onSubmit(password);
            }
          }}
        >
          <input
            ref={inputRef}
            type="password"
            className="scpdf-dialog__input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('password.placeholder')}
            aria-label={t('password.placeholder')}
          />

          <div className="scpdf-dialog__actions">
            <button type="button" className="scpdf-btn" onClick={onCancel}>
              {t('password.cancel')}
            </button>
            <button type="submit" className="scpdf-btn scpdf-btn--primary">
              {t('password.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
