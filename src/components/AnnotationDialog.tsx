/**
 * AnnotationDialog —— **写批注的富文本弹窗**。
 *
 * ## 用户需求
 *
 * > "需要在框选的时候工具栏弹窗就要有加批注这个，写了批注之后用默认高亮。"
 *
 * > "我的意思是写批注的时候不要用系统默认的alert，设计一个富文本弹窗来写批注，
 * > 而且在展示的时候要展示出来富文本，现在我看都是富文本直接写出来<br>这种"
 *
 * ## 为什么不用 `window.prompt` / `window.alert`
 *
 * → `prompt` **只能写纯文本** → 写不了加粗 / 高亮 / 链接 ❌
 * → `prompt` / `alert` 的外观**由操作系统决定** → 浏览器里很丑、和包的 UI 不搭 ❌
 * → `prompt` 是**阻塞**的 → 会卡住整个页面（React 里尤其糟糕）❌
 *
 * ## 本组件
 *
 * → **自研的富文本弹窗**（`contenteditable` + `document.execCommand`）
 * → 工具栏：**加粗 / 斜体 / 下划线 / 高亮 / 颜色 / 链接**
 * → `Ctrl/Cmd + Enter` 提交，`Esc` 关闭
 * → 保存时 `sanitizeRichText`（防 XSS）
 *
 * ## 包的边界
 *
 * → 包只给**UI + 事件**（`onSubmit(html, plain)`）
 * → 存什么、怎么存 → 宿主
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RichTextPalette, RichTextToolbarItem } from '../core/editor/rich-text';
import { richTextToPlain, sanitizeRichText } from '../core/editor/rich-text';
import type { Locale, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { RichTextEditor } from './RichTextEditor';

/** AnnotationDialog 参数 */
export interface AnnotationDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 初始内容（HTML） */
  initialContent?: string;
  /** 标题（不传 → 用默认文案） */
  title?: string;
  /** 提交（HTML + 纯文本） */
  onSubmit: (html: string, plain: string) => void;
  /** 关闭 */
  onClose: () => void;
  /** 富文本工具栏（宿主可配；不传 → 默认的） */
  toolbar?: RichTextToolbarItem[];
  /** 高亮色板 */
  palette?: RichTextPalette;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
}

/**
 * 写批注的富文本弹窗。
 *
 * @param props 参数
 */
export function AnnotationDialog(props: AnnotationDialogProps) {
  const {
    open,
    initialContent = '',
    title,
    onSubmit,
    onClose,
    toolbar,
    palette,
    icons,
    locale = 'zh',
    locales,
    messages,
  } = props;

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  const [html, setHtml] = useState(initialContent);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // 打开时重置内容 + 聚焦
  useEffect(() => {
    if (!open) {
      return;
    }
    setHtml(initialContent);
    // 下一帧聚焦（等编辑器渲染出来）
    const timer = window.setTimeout(() => {
      const editor = dialogRef.current?.querySelector<HTMLElement>('.scpdf-rich-text__editor');
      editor?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, initialContent]);

  // Esc 关闭
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);

  const handleSubmit = useCallback(() => {
    const clean = sanitizeRichText(html);
    onSubmit(clean, richTextToPlain(clean));
  }, [html, onSubmit]);

  const dialogTitle = useMemo(() => title ?? t('annotation.new'), [title, t]);

  if (!open) {
    return null;
  }

  return (
    <div className="scpdf-annotation-dialog__backdrop">
      <button
        type="button"
        className="scpdf-annotation-dialog__scrim"
        onClick={onClose}
        tabIndex={-1}
        aria-label={t('annotation.close')}
      />
      <div
        ref={dialogRef}
        className="scpdf-annotation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
      >
        <div className="scpdf-annotation-dialog__head">
          <span className="scpdf-annotation-dialog__title">
            <Icon name="stickyNote" size={16} />
            {dialogTitle}
          </span>
          <button
            type="button"
            className="scpdf-annotation-dialog__btn"
            onClick={onClose}
            title={t('annotation.close')}
            aria-label={t('annotation.close')}
          >
            <Icon name="close" size={16} overrides={icons} />
          </button>
        </div>

        <div className="scpdf-annotation-dialog__body">
          <RichTextEditor
            value={html}
            onChange={(nextHtml) => {
              setHtml(nextHtml);
            }}
            toolbar={toolbar}
            palette={palette}
            icons={icons}
            locale={locale}
            locales={locales}
            messages={messages}
            placeholder={t('annotation.placeholder')}
          />
        </div>

        <div className="scpdf-annotation-dialog__foot">
          <button
            type="button"
            className="scpdf-annotation-dialog__btn scpdf-annotation-dialog__btn--ghost"
            onClick={onClose}
          >
            {t('annotation.cancel')}
          </button>
          <button
            type="button"
            className="scpdf-annotation-dialog__btn scpdf-annotation-dialog__btn--primary"
            onClick={handleSubmit}
          >
            {t('annotation.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
