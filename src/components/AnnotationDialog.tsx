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
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
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
  /**
   * **锚点矩形**（视口坐标）—— 弹窗贴在它旁边。
   *
   * ## 为什么需要（用户反馈）
   *
   * > "这个富文本编辑框没有定位到批注旁边啊 你这个编辑框定位到文档最上面谁看得到啊"
   *
   * → 之前弹窗**居中**在视口上 → 选区在屏幕底部时，弹窗在中间 → **看不到** ❌
   * → 传了锚点 → 弹窗贴着**选区/批注**显示 ✅
   *
   * → 不传 → 退回"居中"（老行为）✅
   */
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
  /**
   * **锚点版本号**（锚点变了就重新定位）。
   *
   * → 选区变了 / 页面滚了 → 锚点位置变了 → 要重算 ✅
   */
  anchorVersion?: number;
  /** 富文本工具栏（宿主可配；不传 → 默认的） */
  toolbar?: RichTextToolbarItem[];
  /** 高亮色板 */
  palette?: RichTextPalette;
  /**
   * **有嵌套弹窗打开？**（比如链接弹窗）
   *
   * ⚠️ 用来决定 Esc 的行为：
   * -> 嵌套弹窗开着 -> Esc 关**嵌套弹窗**，不关本弹窗 ✅
   * -> 没开 -> Esc 关本弹窗 ✅
   */
  hasNestedOverlay?: boolean;
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
    onOverlayStateChange?: (hasOverlay: boolean) => void;
  }>;
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
    anchorRect = null,
    anchorVersion = 0,
    toolbar,
    palette,
    icons,
    locale = 'zh',
    locales,
    messages,
    editor,
    hasNestedOverlay = false,
  } = props;

  /*
   * **嵌套弹窗的状态**（比如链接弹窗）。
   *
   * ⚠️ Esc 的行为要靠它：
   * -> 链接弹窗开着 -> Esc **只关链接弹窗** ✅
   *   （实测踩过的坑：Esc 把整个批注弹窗也关掉了 ❌）
   */
  const [overlayOpen, setOverlayOpen] = useState(false);
  const handleOverlayState = useCallback((hasOverlay: boolean) => {
    setOverlayOpen(hasOverlay);
  }, []);

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  const [html, setHtml] = useState(initialContent);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  /**
   * **弹窗的位置**（视口坐标 → `position: fixed`）。
   *
   * ⚠️ **用 `position: fixed`**（和 `SelectionPopover` 一个套路）：
   * → 视口坐标**不需要**换算滚动量 → 天然不漂移 ✅
   * → 但祖先里有 `transform` 时会失效 → 所以不能放在 `transform` 的祖先里 ✅
   *
   * @param anchor 锚点矩形（视口坐标）
   * @param size 弹窗尺寸
   * @returns `left` / `top`（视口 px）
   */
  const computePosition = useCallback(
    (
      anchor: { left: number; top: number; right: number; bottom: number },
      size: { width: number; height: number },
    ) => {
      const gap = 8;
      const margin = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // 默认：贴在锚点**下方**
      let left = anchor.left;
      let top = anchor.bottom + gap;

      // 下面放不下 → 放**上面**
      if (top + size.height > vh - margin) {
        const above = anchor.top - gap - size.height;
        if (above >= margin) {
          top = above;
        } else {
          // 上下都放不下 → 贴着可视区中间
          top = Math.max(margin, Math.min((vh - size.height) / 2, vh - size.height - margin));
        }
      }

      /*
       * ⚠️⚠️ **水平：别贴着视口右边**（用户反馈：
       * "如果批注在这一行最右边 打开编辑批注的框过于靠右 已经贴着最右边了 需要往中间来点"）。
       *
       * → 之前只是"超出就夹回来" -> 贴边时**刚好卡在边上** ❌
       * -> 现在：**留出额外的安全边距**（`margin * 2`）✅
       *   -> 弹窗不会紧贴屏幕边缘 -> **往中间来一点** ✅
       */
      const safeMargin = margin * 2;
      if (left + size.width > vw - safeMargin) {
        left = vw - size.width - safeMargin;
      }
      if (left < safeMargin) {
        left = safeMargin;
      }

      /*
       * ⚠️⚠️ **垂直：也保证整个弹窗在视口内**（实测踩过的坑）。
       *
       * → 弹窗高度会**变**（编辑器加载完才变高）-> 位置要跟着重算 ✅
       * -> 但万一还是超出 -> **夹回视口内** ✅
       *   （不然「保存」按钮在屏幕外 -> 点都点不到 ❌）
       */
      if (top + size.height > vh - margin) {
        top = Math.max(margin, vh - size.height - margin);
      }
      if (top < margin) {
        top = margin;
      }

      return { left, top };
    },
    [],
  );

  /** 弹窗的位置（state） */
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  /*
   * **重新定位**（锚点变了 / 尺寸变了 / 滚动了）。
   *
   * → 用 `requestAnimationFrame` 等弹窗渲染出来再量尺寸 ✅
   * → 滚动时也要重算（`position: fixed` 不随滚动变，但**锚点**是视口坐标 → 会变）✅
   */
  useEffect(() => {
    if (!open || !anchorRect) {
      setPosition(null);
      return;
    }

    // 读一下 anchorVersion，让它成为真正的依赖（锚点变了就重算）
    void anchorVersion;

    const update = () => {
      const el = dialogRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      setPosition(computePosition(anchorRect, { width: rect.width, height: rect.height }));
    };

    const raf = requestAnimationFrame(update);
    // 锚点变了 → 重算
    // 滚动 → 锚点（视口坐标）变了 → 重算
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);

    /*
     * ⚠️⚠️ **尺寸变了要重算位置**（实测踩过的坑）。
     *
     * ### 问题
     *
     * → 打开时富文本编辑器**还没加载完** -> 第一次量到的高度**偏小**
     *   （实测：h 一路从 **122 -> 237 -> 281** 变）
     * -> 用偏小的高度算出来的位置 -> 弹窗**底部超出视口** ❌
     *   （实测：弹窗 y=680、bottom=962，视口只有 900 -> **「保存」按钮在屏幕外** ❌
     *    -> 连点都点不到 -> `locator.click` 超时 ❌）
     *
     * ### 修法
     *
     * -> 用 `ResizeObserver` **盯着尺寸** -> 变一次就重算一次位置 ✅
     * -> 这样不管编辑器什么时候加载完，弹窗都会**自动挪到正确位置** ✅
     */
    const observer =
      typeof ResizeObserver !== 'undefined' && dialogRef.current
        ? new ResizeObserver(() => {
            update();
          })
        : null;
    if (observer && dialogRef.current) {
      observer.observe(dialogRef.current);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [open, anchorRect, computePosition, anchorVersion]);

  // 打开时重置内容 + 聚焦
  useEffect(() => {
    if (!open) {
      return;
    }
    setHtml(initialContent);
    // 下一帧聚焦（等编辑器渲染出来）
    const timer = window.setTimeout(() => {
      const editor = dialogRef.current?.querySelector<HTMLElement>('.scpdf-rich-text__editor');
      // ⚠️ `preventScroll: true` → 聚焦**不要滚动页面**（用户反馈）
      editor?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, initialContent]);

  /*
   * ⚠️⚠️ **Esc 关闭**（但**嵌套弹窗打开时不算**）。
   *
   * → 这个监听挂在 `document` 上，且是 **`capture: true`** ⚠️
   *   -> **捕获阶段**比输入框的**冒泡阶段**先跑 ❌
   *   -> 结果：链接弹窗开着时按 Esc -> **整个批注弹窗被关掉** ❌
   *   （实测：Esc 之后 `.scpdf-annotation-dialog` 整个消失了）
   *
   * -> 修法：**有嵌套弹窗打开时，Esc 不关自己** ✅
   *   -> 让嵌套弹窗自己处理 Esc ✅
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 有嵌套弹窗（比如链接弹窗）-> 让它自己处理 ❌ 不关自己
        if (hasNestedOverlay || overlayOpen) {
          return;
        }
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose, hasNestedOverlay, overlayOpen]);

  const handleSubmit = useCallback(() => {
    const clean = sanitizeRichText(html);
    onSubmit(clean, richTextToPlain(clean));
  }, [html, onSubmit]);

  const dialogTitle = useMemo(() => title ?? t('annotation.new'), [title, t]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="scpdf-annotation-dialog__backdrop"
      /*
       * ⚠️ **有锚点时 → 不要遮罩**（用户需求：弹窗要贴着批注，不要挡住整页）。
       * -> 没锚点 → 保留遮罩（居中模式的老行为）✅
       */
      data-anchored={position ? 'true' : 'false'}
    >
      {position ? null : (
        <button
          type="button"
          className="scpdf-annotation-dialog__scrim"
          onClick={onClose}
          tabIndex={-1}
          aria-label={t('annotation.close')}
        />
      )}
      <div
        ref={dialogRef}
        className="scpdf-annotation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        /*
         * ⚠️ **有锚点 → `position: fixed` + 视口坐标**（贴着批注显示）。
         * -> 没有锚点 → 保持原来的居中样式 ✅
         */
        style={
          position
            ? {
                position: 'fixed',
                left: `${position.left}px`,
                top: `${position.top}px`,
              }
            : undefined
        }
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
          {(() => {
            const EditorComponent = editor ?? RichTextEditor;
            return (
              <EditorComponent
                value={html}
                onChange={(nextHtml: string) => {
                  setHtml(nextHtml);
                }}
                toolbar={toolbar}
                palette={palette}
                icons={icons}
                locale={locale}
                locales={locales}
                messages={messages}
                placeholder={t('annotation.placeholder')}
                onOverlayStateChange={handleOverlayState}
              />
            );
          })()}
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
