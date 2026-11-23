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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationRecord } from '../core/annotation/sticky-note';
import type { RichTextPalette, RichTextToolbarItem } from '../core/editor/rich-text';
import { richTextToPlain, sanitizeRichText } from '../core/editor/rich-text';
import { computeDialogPosition } from '../core/selection/dialog-position';
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
  /**
   * **便签的视口矩形**（用来把面板贴在便签旁边）。
   *
   * ⚠️ **之前面板固定在"页面中间偏右"** ❌
   *    -> 便签在 \`x=571\`，面板在 \`x=918\` -> **离得很远** ❌
   *    -> 用户反馈："打开详细按钮目前是失效的 需要点击能打开一个稍微大一点的便利贴的样式" ✅
   *
   * -> 传了 -> **贴在便签旁边**（优先放右边，放不下就翻到左边）✅
   */
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
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
  /** 高亮色板（**浅色**，当"高亮底色"用） */
  palette?: RichTextPalette;
  /**
   * **"文字颜色"色板**（**深色**）。
   *
   * ⚠️ **和 `palette` 分开**（用户反馈：
   * "富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色"）。
   */
  textPalette?: RichTextPalette;
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
    /** **文字颜色**色板（**深色**） */
    textPalette?: RichTextPalette;
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
    anchorRect,
    onChange,
    onSubmit,
    onDelete,
    onClose,
    toolbar,
    palette,
    textPalette,
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

  /*
   * ⚠️ **是不是在"编辑模式"**（用户需求）。
   *
   * ### 用户反馈
   *
   * > "便签详情打开的时候也是要有按钮可以选编辑的 选择编辑的时候便签详情就消失隐藏"
   *
   * ### 现在的做法（用户选的 **B 方案**："先试试B的效果"）
   *
   * -> **默认只读**（显示排版好的富文本）✅
   * -> 点"编辑" -> **就地变成编辑器**（**不弹窗**）✅
   * -> 点"完成" -> 回到只读 ✅
   *
   * -> 之前是**直接进编辑器**（没这一步）❌
   *   -> 打开详情就看到一个工具栏 -> 不像"详情" ❌
   */
  const [editing, setEditing] = useState(false);

  // 切换批注 -> 退出编辑模式
  useEffect(() => {
    setEditing(false);
  }, []);

  /** 提交（**顺带清洗 HTML**，防 XSS） */
  const handleSubmit = useCallback(
    (html: string, plain: string) => {
      if (!annotation) {
        return;
      }
      const safe = sanitizeRichText(html);
      onSubmit?.(annotation.id, safe, plain);
      setEditing(false);
    },
    [annotation, onSubmit],
  );

  /*
   * ⚠️ **位置：贴着便签**（用户需求："打开一个稍微大一点的便利贴的样式"）。
   *
   * ### 之前
   *
   * -> 固定在**页面中间偏右** -> 便签在 `x=571`、面板在 `x=918` -> **离得很远** ❌
   *
   * ### 现在
   *
   * -> **复用 `computeDialogPosition`**（和编辑弹窗同一套定位规则）✅
   * -> 有锚点（便签）-> **贴在便签旁边** ✅
   * -> 放不下 -> **自动翻边** ✅
   * -> 没锚点 -> 退回"中间偏右" ✅
   */
  const position = useMemo(() => {
    if (!anchorRect) {
      return {
        left: Math.max(
          8,
          container.width * 0.5 + (container.width * 0.5 - ANNOTATION_PANEL_WIDTH) * 0.5,
        ),
        top: Math.max(8, container.height * 0.18),
      };
    }
    return computeDialogPosition({
      anchor: anchorRect,
      size: { width: ANNOTATION_PANEL_WIDTH, height: 320 },
      viewport: { width: container.width, height: container.height },
    });
  }, [anchorRect, container.width, container.height]);

  const left = position.left;
  const top = position.top;

  if (!annotation) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className="scpdf-annotation-panel"
      /*
       * ⚠️ **给容器的点击委托一个"我是浮层"的标记**。
       * -> 容器上挂了高亮的点击委托（按鼠标坐标命中）✅
       * -> 浮层里的点击**不能**触发它（否则下面的高亮会被误激活）✅
       */
      data-scpdf-floating="true"
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
          {/*
           * ⚠️ **"编辑"按钮**（用户需求：
           * "便签详情打开的时候也是要有按钮可以选编辑的"）。
           *
           * -> **默认只读**（详情）✅
           * -> 点"编辑" -> **就地变成编辑器**（B 方案：不弹窗）✅
           * -> 编辑中 -> 按钮变成"完成" ✅
           */}
          {!readOnly ? (
            <button
              type="button"
              className="scpdf-annotation-panel__btn"
              title={editing ? t('annotation.done') : t('annotation.edit')}
              aria-label={editing ? t('annotation.done') : t('annotation.edit')}
              onClick={() => setEditing((v) => !v)}
            >
              <Icon name={editing ? 'check' : 'edit'} size={14} overrides={icons} />
            </button>
          ) : null}
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
        {readOnly || !editing ? (
          <ReadOnlyContent html={draft} />
        ) : (
          (() => {
            const EditorComponent = editor ?? RichTextEditor;
            return (
              <EditorComponent
                value={draft}
                toolbar={toolbar}
                palette={palette}
                textPalette={textPalette}
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
