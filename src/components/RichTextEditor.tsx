/**
 * RichTextEditor —— 轻量富文本编辑器（零依赖）。
 *
 * ## 用户需求
 *
 * > "而且输入框不要用默认的 你设计一个好看点的富文本输入框
 * >  调研一个好用的富文本插件 可以自主控制展示哪些富文本内容
 * >  通过宿主接口配置 提供默认的一些 比如高亮 加粗 颜色 链接"
 *
 * ## 设计
 *
 * - **不是** `<textarea>`（默认样式很丑）→ 自研外观
 * - 编辑区 = `contenteditable`（浏览器原生）
 * - **工具栏完全由宿主配置**（`toolbar` prop）
 *   → 宿主传什么就显示什么 → "可以自主控制展示哪些富文本内容" ✅
 * - 不传 `toolbar` → 用默认的（高亮 / 加粗 / 颜色 / 链接 …）
 *
 * ## 包的边界
 *
 * → 包只给**编辑 UI + 工具栏**
 * → 存什么、存哪 → 宿主（`onChange` 回调给 HTML）
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveToolbarLabel } from '../core/editor/label';
import type { RichTextPalette, RichTextToolbarItem } from '../core/editor/rich-text';
import {
  defaultRichTextToolbar,
  execRichTextCommand,
  richTextToPlain,
} from '../core/editor/rich-text';
import type { Locale, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { LinkPopover } from './LinkPopover';

/** RichTextEditor 参数 */
export interface RichTextEditorProps {
  /** 当前内容（HTML，受控） */
  value?: string;
  /** 占位符 */
  placeholder?: string;
  /** 工具栏配置（**不传 → 用默认的**） */
  toolbar?: RichTextToolbarItem[];
  /** 高亮色板 */
  palette?: RichTextPalette;
  /** 内容变化（HTML） */
  onChange?: (html: string, plain: string) => void;
  /** 提交（Enter 或点按钮） */
  onSubmit?: (html: string, plain: string) => void;
  /** 取消 */
  onCancel?: () => void;
  /** 自动聚焦 */
  autoFocus?: boolean;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
  /** 嵌套弹窗的状态（透传给 TipTap 编辑器） */
  onOverlayStateChange?: (hasOverlay: boolean) => void;
}

/**
 * 富文本编辑器。
 *
 * @param props 参数
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const {
    value = '',
    placeholder,
    toolbar,
    palette,
    onChange,
    onSubmit,
    onCancel,
    autoFocus = true,
    icons,
    locale = 'zh',
    locales,
    messages,
  } = props;

  /**
   * 文案解析。
   *
   * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
   * → 之前编辑器的 title / aria-label 是**硬编码中文** → 现在全走文案表 ✅
   */
  const t = useCallback(
    (key: keyof Messages) => resolveMessage(locale, key, messages, undefined, locales),
    [locale, messages, locales],
  );

  /** 编辑区 ref */
  const editorRef = useRef<HTMLDivElement | null>(null);

  /** 当前展开的颜色面板（命令名） */
  const [openPalette, setOpenPalette] = useState<string | null>(null);

  /*
   * **链接弹窗**（用户反馈："现在点击链接按钮 弹框不出现了"）。
   *
   * ⚠️⚠️ **之前内置编辑器根本没有链接弹窗** ❌
   * -> 它直接调 `document.execCommand('createLink', false, '')` -> **插了个空链接** ❌
   * -> 宿主**没装 TipTap** 时（或者用内置编辑器）-> 点"链接"**什么都不会发生** ❌
   * -> 现在：**和 TipTap 编辑器用同一个 `LinkPopover`** ✅
   */
  const [linkState, setLinkState] = useState<{
    open: boolean;
    anchor: { left: number; top: number; right: number; bottom: number } | null;
    from: number;
    to: number;
    text: string;
  }>({ open: false, anchor: null, from: 0, to: 0, text: '' });

  /** 链接按钮的 ref（用来算弹窗的锚点） */
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * **工具栏项的文案**（解析 `{key}` 形式的 i18n 占位符）。
   *
   * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
   * → 工具栏的 label 之前是**硬编码中文** → 现在走文案表 ✅
   *
   * @param label 原始 label（可能是 `{richtext.bold}`）
   * @param vars 变量
   * @returns 最终文案
   */
  const resolveLabel = useCallback(
    (label: string, vars?: Record<string, string | number>) =>
      resolveToolbarLabel(label, locale, messages, locales, vars),
    [locale, messages, locales],
  );

  /** 工具栏项（宿主没传 → 默认的） */
  const items = toolbar ?? defaultRichTextToolbar(palette);

  /** 是否为空（用来决定要不要显示占位符） */
  const [empty, setEmpty] = useState(value.length === 0);

  /**
   * ⚠️ **选区变化的计数器**（用来刷新工具栏的按下态）。
   *
   * → contenteditable 的选区变化**不会触发 React 重渲染** ❌
   * → 用户移动光标 / 选中一段文字 -> 工具栏的"按下态"要跟着变 ✅
   * → 用一个递增的计数器 -> 变了就重渲染 ✅
   */
  const [_selectionTick, setSelectionTick] = useState(0);

  /** 选区变化时刷新（`selectionchange` 是全局事件） */
  useEffect(() => {
    const onSelectionChange = () => {
      setSelectionTick((n) => n + 1);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, []);

  /**
   * **问浏览器"当前选区是不是这个格式"**。
   *
   * → `document.queryCommandState('bold')` -> 内置编辑器（execCommand）能问出结果 ✅
   * → 浏览器不支持 -> 返回 false（按钮不高亮，不影响使用）✅
   */
  const queryCommandActive = useCallback((command: string): boolean => {
    /*
     * ⚠️ **只有部分命令能问状态**。
     * → `queryCommandState` 只认：bold / italic / underline / strikeThrough /
     *   insertUnorderedList / insertOrderedList / formatBlock 等
     * → 问不出来的（颜色、高亮、链接）-> 直接 false ✅
     */
    const queryable = new Set([
      'bold',
      'italic',
      'underline',
      'strikeThrough',
      'insertUnorderedList',
      'insertOrderedList',
      'formatBlock',
    ]);
    if (!queryable.has(command)) {
      return false;
    }
    try {
      return document.queryCommandState(command) === true;
    } catch {
      return false;
    }
  }, []);

  /**
   * ⚠️ **只同步一次**（外部 value 变化时）。
   *
   * → contenteditable 是**非受控**的（React 不管它的内容）
   * → 每次渲染都设 innerHTML 会**打断光标**（用户正在打字就跳了）
   * → 所以：只在 `value` 真的变了（且不是当前内容）时才同步
   */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    if (el.innerHTML !== value) {
      el.innerHTML = value;
      setEmpty(richTextToPlain(value).length === 0);
    }
  }, [value]);

  // 自动聚焦
  useEffect(() => {
    if (autoFocus) {
      /*
       * ⚠️⚠️ **必须用 `focus({ preventScroll: true })`**（用户反馈：
       * "编辑批注的时候现在页面会自动滚到最上方 还定位在原来的地方不要动页面啊"）。
       *
       * → 普通的 `focus()` 会让浏览器**把元素滚动到可视区**
       * → 编辑器在"页面中间偏右" → 浏览器会滚动容器 → **页面跳走** ❌
       * → `preventScroll: true` → **只聚焦，不滚动** ✅
       */
      editorRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus]);

  /** 读当前内容并通知宿主 */
  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    const html = el.innerHTML;
    const plain = richTextToPlain(html);
    setEmpty(plain.length === 0);
    onChange?.(html, plain);
  }, [onChange]);

  /**
   * **打开链接弹窗**（记下选区和按钮位置）。
   *
   * ⚠️ **不能直接 `execCommand('createLink')`** -> 那会插一个**空链接** ❌
   */
  const openLinkPopover = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    // 记下选区（用 DOM 的 selection）
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';
    const rect = linkButtonRef.current?.getBoundingClientRect();
    setLinkState({
      open: true,
      anchor: rect
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        : null,
      from: 0,
      to: 0,
      text,
    });
  }, []);

  /** 应用链接 */
  const applyLink = useCallback(
    (href: string, text: string) => {
      const el = editorRef.current;
      if (!el) {
        return;
      }
      el.focus({ preventScroll: true });
      /*
       * ⚠️ **没选文字** -> 插入"展示文字"（带链接）。
       *
       * -> `execCommand('createLink', false, href)` 会把**光标处的字**变成链接 ❌
       * -> 正确做法：**插入一段 HTML**（`<a href="...">文字</a>`）✅
       */
      const selection = window.getSelection();
      const hasSelection = !!selection && !selection.isCollapsed && selection.toString().length > 0;
      if (hasSelection) {
        document.execCommand('createLink', false, href);
      } else {
        document.execCommand('insertHTML', false, `<a href="${href}">${text || href}</a>`);
      }
      emit();
      setLinkState((s) => ({ ...s, open: false }));
    },
    [emit],
  );

  /** 执行命令 */
  const run = useCallback(
    (command: RichTextToolbarItem['command'], commandValue?: string) => {
      const el = editorRef.current;
      if (!el) {
        return;
      }
      // ⚠️ **必须先聚焦编辑区** → 否则 execCommand 作用在错误的位置
      // ⚠️ `preventScroll: true` → 点了工具栏**不要滚动页面**（用户反馈）
      el.focus({ preventScroll: true });

      /*
       * ⚠️⚠️ **"链接"要弹自己的弹窗**（用户反馈："点击链接按钮 弹框不出现了"）。
       *
       * -> 之前直接 `execCommand('createLink', false, '')` -> **空链接** ❌
       * -> 没有 TipTap 的宿主**点链接什么都不会发生** ❌
       */
      if (command === 'createLink') {
        openLinkPopover();
        return;
      }

      execRichTextCommand(command, commandValue);
      emit();
    },
    [emit, openLinkPopover],
  );

  /** 点颜色 → 应用颜色 */
  const pickColor = useCallback(
    (command: RichTextToolbarItem['command'], color: string) => {
      run(command, color);
      setOpenPalette(null);
    },
    [run],
  );

  /** 提交 */
  const submit = useCallback(() => {
    const el = editorRef.current;
    if (!el) {
      return;
    }
    const html = el.innerHTML;
    const plain = richTextToPlain(html);
    if (plain.length === 0) {
      return;
    }
    onSubmit?.(html, plain);
  }, [onSubmit]);

  return (
    <div className="scpdf-rich-text">
      {/* 工具栏（宿主完全可配） */}
      <div className="scpdf-rich-text__toolbar" role="toolbar">
        {items.map((item) => {
          const hasPalette = item.command === 'hiliteColor' || item.command === 'foreColor';
          const paletteOpen = openPalette === item.command;
          /*
           * ⚠️ **按下态**（用户需求：
           * "点了加粗之后 加粗按钮没加深颜色 别的按钮也一样 看不出点击了"）。
           *
           * → 内置编辑器用的是 `document.execCommand` -> 用 `queryCommandState` 问浏览器 ✅
           * → 选区变化时 React 不一定重渲染 -> 用 `onFocus/onBlur` + 一个 tick 强制刷新 ✅
           */
          const active = queryCommandActive(item.command);

          return (
            <span key={item.command} className="scpdf-rich-text__tool">
              <button
                type="button"
                className="scpdf-rich-text__btn"
                /*
                 * ⚠️ **链接按钮要记位置** -> 弹窗贴在它下面 ✅
                 */
                ref={item.command === 'createLink' ? linkButtonRef : undefined}
                title={resolveLabel(item.label)}
                aria-label={resolveLabel(item.label)}
                aria-expanded={hasPalette ? paletteOpen : undefined}
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                onMouseDown={(event) => {
                  // ⚠️ **阻止默认行为** → 不然编辑区会失焦 → 光标丢失
                  event.preventDefault();
                }}
                onClick={() => {
                  if (hasPalette) {
                    setOpenPalette(paletteOpen ? null : item.command);
                    return;
                  }
                  run(item.command);
                  // 命令执行后选区格式变了 -> 刷新按下态
                  setSelectionTick((n) => n + 1);
                }}
              >
                {item.icon ? (
                  <Icon name={item.icon as IconName} size={15} overrides={icons} />
                ) : (
                  item.label
                )}
              </button>

              {/* 颜色面板 */}
              {hasPalette && paletteOpen ? (
                <span className="scpdf-rich-text__palette">
                  {Object.entries(item.palette ?? palette ?? {}).map(([key, color]) => (
                    <button
                      key={key}
                      type="button"
                      className="scpdf-rich-text__swatch"
                      style={{ background: color }}
                      title={key}
                      aria-label={key}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickColor(item.command, color)}
                    />
                  ))}
                </span>
              ) : null}
            </span>
          );
        })}

        {/*
         * **链接弹窗**（和 TipTap 编辑器共用同一个组件）✅
         *
         * ⚠️ 用户反馈："现在点击链接按钮 弹框不出现了"
         * -> 之前内置编辑器**根本没有弹窗** -> 直接插了个空链接 ❌
         */}
        <LinkPopover
          open={linkState.open}
          anchor={linkState.anchor}
          selectedText={linkState.text}
          onSubmit={applyLink}
          onCancel={() => {
            setLinkState((s) => ({ ...s, open: false }));
          }}
          labels={{
            href: t('richtext.linkHref'),
            text: t('richtext.linkText'),
            confirm: t('richtext.linkConfirm'),
            cancel: t('richtext.linkCancel'),
            placeholderHref: t('richtext.linkHrefPlaceholder'),
            placeholderText: t('richtext.linkTextPlaceholder'),
          }}
        />

        {/* 提交 / 取消（宿主也可以整个不要） */}
        {onSubmit ? (
          <button
            type="button"
            className="scpdf-rich-text__btn scpdf-rich-text__btn--primary"
            title={t('annotation.save')}
            aria-label={t('annotation.save')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={submit}
          >
            <Icon name="check" size={15} overrides={icons} />
          </button>
        ) : null}

        {onCancel ? (
          <button
            type="button"
            className="scpdf-rich-text__btn"
            title={t('annotation.cancel')}
            aria-label={t('annotation.cancel')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCancel}
          >
            <Icon name="close" size={15} overrides={icons} />
          </button>
        ) : null}
      </div>

      {/* 编辑区 */}
      {/*
        ⚠️ **用 `role="textbox"`**（a11y 规则 `noStaticElementInteractions`：
        带事件处理器的元素必须有合适的 role）。

        → `contentEditable` 的 div 挂 `onInput` → 必须声明 role
        → `role="textbox"` + `aria-multiline` + `aria-label` 是标准组合 ✅
        → 再配 `tabIndex={0}` → 键盘可达 ✅

        ⚠️ **biome 的 `useSemanticElements` 建议改成 `<textarea>`** → 但那是**错的**：
        → `<textarea>` **只能纯文本** → 富文本（加粗/高亮/链接）会全部丢掉 ❌
        → 富文本编辑器**必须**用 `contentEditable` 的 div
        → 所以这条规则在这里是误报 → 显式忽略
      */}
      {/* biome-ignore lint/a11y/useSemanticElements: 富文本必须用 contentEditable，不能用 textarea */}
      <div
        ref={editorRef}
        className="scpdf-rich-text__editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t('annotation.content')}
        tabIndex={0}
        data-empty={empty ? 'true' : 'false'}
        data-placeholder={placeholder ?? t('annotation.placeholder')}
        onInput={emit}
        onKeyDown={(event) => {
          // ⚠️ **Ctrl/Cmd + Enter 提交**（常见习惯）
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />
    </div>
  );
}
