/**
 * AnnotationPanel —— **便利贴面板**（批注的编辑 / 查看 UI）。
 *
 * ## 用户需求
 *
 * > "点击批注的时候展开的是一个便利贴一样的ui 在页面中间偏右的区域
 * >  目前都没展示完整 在最右边被挡住了 便利贴 稍微大一点的那种"
 *
 * ## 位置怎么算（实测踩过的坑）
 *
 * ⚠️ **不能贴在"便签图标"的旁边** —— 那是在页面的最右边 → **会被容器裁掉** ❌
 * → 用户原话："目前都没展示完整 在最右边被挡住了"
 *
 * ### 本实现：**页面中间偏右**
 *
 * ```
 * 容器宽度 W
 * 面板宽度 panelW
 * 面板左边 = W * 0.5 + (W * 0.5 - panelW) * 0.5   ← 中间偏右
 * ```
 *
 * → 落在**可视区中间偏右** → 完整可见 ✅
 * → 而且是"贴着页面"的（不是贴着屏幕边缘）
 *
 * ## 包的边界
 *
 * → 包只给**UI + 事件**
 * → 存什么、怎么存 → 宿主（`onChange` / `onSubmit`）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import type { RichTextPalette, RichTextToolbarItem } from '../core/editor/rich-text';
import { richTextToPlain, sanitizeRichText } from '../core/editor/rich-text';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { RichTextEditor } from './RichTextEditor';

/** 面板的默认宽度（px） */
export const ANNOTATION_PANEL_WIDTH = 320;

/** AnnotationPanel 参数 */
export interface AnnotationPanelProps {
  /** 当前批注（`null` = 关闭） */
  annotation: AnnotationRecord | null;
  /** 容器尺寸（用来算位置） */
  container: { width: number; height: number };
  /** 批注内容变化（HTML + 纯文本） */
  onChange?: (id: string, html: string, plain: string) => void;
  /** 保存 */
  onSubmit?: (id: string, html: string, plain: string) => void;
  /** 删除 */
  onDelete?: (id: string) => void;
  /** 关闭 */
  onClose?: () => void;
  /** 富文本工具栏（宿主可配；不传 → 默认的） */
  toolbar?: RichTextToolbarItem[];
  /** 高亮色板 */
  palette?: RichTextPalette;
  /** 只读模式（只看不改） */
  readOnly?: boolean;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
  /**
   * **富文本编辑器**（宿主可换，比如 TipTapEditor）。
   *
   * -> 不传 -> 用包内置的轻量编辑器
   */
  editor?: React.ComponentType<{
    value?: string;
    onChange?: (html: string, plain: string) => void;
    toolbar?: RichTextToolbarItem[];
    palette?: RichTextPalette;
    placeholder?: string;
    icons?: Partial<Record<IconName, ReactNode>>;
    locale?: Locale;
    locales?: LocaleTable;
    messages?: LocaleMessagesMap;
  }>;
}

/**
 * 便利贴面板。
 *
 * @param props 参数
 */
export function AnnotationPanel(props: AnnotationPanelProps) {
  const {
    annotation,
    container,
    onChange,
    onSubmit,
    onDelete,
    onClose,
    toolbar,
    palette,
    readOnly = false,
    icons,
    locale = 'zh',
    locales,
    messages,
    editor,
  } = props;

  /**
   * 文案解析。
   *
   * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
   * → 之前面板的 title 是**硬编码中文** → 现在全走文案表 ✅
   */
  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages, undefined, locales),
    [locale, messages, locales],
  );

  /** 面板 ref（用来点外面关闭） */
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** 当前批注的 HTML（本地草稿） */
  const [draft, setDraft] = useState('');

  // 切换批注 → 重置草稿
  useEffect(() => {
    if (!annotation) {
      setDraft('');
      return;
    }
    // ⚠️ **批注内容可能是纯文本**（老数据）→ 包成段落
    const content = annotation.content ?? '';
    setDraft(content.includes('<') ? content : `<p>${content}</p>`);
  }, [annotation]);

  // 点外面 → 关闭
  useEffect(() => {
    if (!annotation) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const el = panelRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) {
        return;
      }
      onClose?.();
    };
    // ⚠️ 用 `pointerdown`（比 mousedown 更早，能避免和按钮点击打架）
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [annotation, onClose]);

  /** 内容变化 */
  const handleChange = useCallback(
    (html: string, plain: string) => {
      setDraft(html);
      if (annotation) {
        onChange?.(annotation.id, html, plain);
      }
    },
    [annotation, onChange],
  );

  /** 提交（**顺带清洗 HTML**，防 XSS） */
  const handleSubmit = useCallback(
    (html: string, plain: string) => {
      if (!annotation) {
        return;
      }
      const safe = sanitizeRichText(html);
      onSubmit?.(annotation.id, safe, plain);
    },
    [annotation, onSubmit],
  );

  if (!annotation) {
    return null;
  }

  /*
   * ⚠️ **位置：页面中间偏右**（用户明确要求）。
   *
   * → 之前贴在便签图标旁边 → 在页面最右边 → **被容器裁掉**（用户反馈）
   * → 现在落在**可视区中间偏右** → 完整可见 ✅
   */
  const left = Math.max(
    8,
    container.width * 0.5 + (container.width * 0.5 - ANNOTATION_PANEL_WIDTH) * 0.5,
  );
  const top = Math.max(8, container.height * 0.18);

  return (
    <div
      ref={panelRef}
      className="scpdf-annotation-panel"
      style={{ left, top, width: ANNOTATION_PANEL_WIDTH }}
      role="dialog"
      aria-label={t('annotation.title')}
    >
      {/* 标题栏 */}
      <div className="scpdf-annotation-panel__head">
        <span className="scpdf-annotation-panel__title">
          <Icon name="stickyNote" size={15} overrides={icons} />
          {t('annotation.title')}
        </span>
        <span className="scpdf-annotation-panel__actions">
          {onDelete ? (
            <button
              type="button"
              className="scpdf-annotation-panel__btn"
              title={t('annotation.delete')}
              aria-label={t('annotation.delete')}
              onClick={() => onDelete(annotation.id)}
            >
              <Icon name="trash" size={14} overrides={icons} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="scpdf-annotation-panel__btn"
              title={t('annotation.close')}
              aria-label={t('annotation.close')}
              onClick={onClose}
            >
              <Icon name="close" size={14} overrides={icons} />
            </button>
          ) : null}
        </span>
      </div>

      {/* 内容（只读 → 显示 HTML；可编辑 → 富文本编辑器） */}
      <div className="scpdf-annotation-panel__body">
        {readOnly ? (
          <ReadOnlyContent html={draft} />
        ) : (
          (() => {
            const EditorComponent = editor ?? RichTextEditor;
            return (
              <EditorComponent
                value={draft}
                toolbar={toolbar}
                palette={palette}
                locale={locale}
                locales={locales}
                messages={messages}
                onChange={handleChange}
                onSubmit={onSubmit ? handleSubmit : undefined}
                icons={icons}
              />
            );
          })()
        )}
      </div>

      {/* 底部信息 */}
      {annotation.createdAt ? (
        <div className="scpdf-annotation-panel__foot">
          {new Date(annotation.createdAt).toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}

/**
 * **只读内容**（渲染富文本 HTML）。
 *
 * ⚠️ **这里用 `dangerouslySetInnerHTML`**（内容是富文本 HTML）。
 *
 * → 安全责任在**调用方**：宿主传进来的内容应当已经过
 *   `sanitizeRichText` 处理（包也导出了这个函数）
 * → 或者宿主用 `readOnly` 时自己保证数据可信
 *
 * biome 的 `noDangerouslySetInnerHtml` 在这里是**误报**
 * → 富文本内容**必须**用 innerHTML 渲染（否则标签会显示成文本）
 *
 * @param props 参数
 */
function ReadOnlyContent({ html }: { html: string }) {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: 富文本内容必须用 innerHTML 渲染
    <div className="scpdf-annotation-panel__content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/**
 * **取批注的纯文本**（列表用）。
 *
 * @param annotation 批注
 * @returns 纯文本
 */
export function annotationPlainText(annotation: AnnotationRecord): string {
  return richTextToPlain(annotation.content ?? '');
}
