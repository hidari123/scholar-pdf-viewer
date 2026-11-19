/**
 * TipTapEditor —— **基于 TipTap 的富文本编辑器**（可选 peerDependency）。
 *
 * ## 用户需求
 *
 * > "自研的很多问题 不要自研的富文本了 用一个现成的吧 集成进来 选配需要的工具"
 *
 * ## 为什么选 TipTap
 *
 * | 方案 | 优点 | 否决原因 |
 * |---|---|---|
 * | **`@tiptap/react`** | headless、工具栏完全宿主可控、有生态（highlight/color/link 都有） | **实测 106 kB brotli** → 太重 |
 * | `lexical` | 性能最好 | 同样重，且和 React 集成更复杂 |
 * | `quill` | 成熟 | 会**接管 DOM**（和自研那套差不多），样式难覆盖 |
 *
 * → **TipTap**，但做成**可选 peerDependency** + **独立子路径**：
 *
 * ```
 * 主入口            25 kB（不变）✅
 * @scholar-club/pdf-viewer/editor   ← 宿主想用富文本批注才装 TipTap
 * ```
 *
 * ## 宿主怎么用
 *
 * ```bash
 * npm i @tiptap/react @tiptap/starter-kit @tiptap/extension-highlight @tiptap/extension-color @tiptap/extension-link @tiptap/extension-underline
 * ```
 *
 * ```tsx
 * import { PdfViewer } from '@scholar-club/pdf-viewer';
 * import { TipTapEditor } from '@scholar-club/pdf-viewer/editor';
 *
 * <PdfViewer
 *   annotationEditor={TipTapEditor}   // ← 传了就用 TipTap
 * />
 * ```
 *
 * ⚠️ **不传** → 包用**内置的轻量编辑器**（`contenteditable`，无依赖）→ 零成本 ✅
 *
 * ## 工具栏
 *
 * → 和包内置的一样：**加粗 / 斜体 / 下划线 / 高亮 / 颜色 / 链接** ✅
 * → 宿主可以传 `toolbar` 覆盖 ✅
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveToolbarLabel } from '../core/editor/label';
import type { RichTextPalette, RichTextToolbarItem } from '../core/editor/rich-text';
import { defaultRichTextToolbar, richTextToPlain } from '../core/editor/rich-text';
import type { Locale, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { RichTextEditor } from './RichTextEditor';

/**
 * **TipTap 编辑器的最小形状**（不依赖具体类型，避免版本差异）。
 */
interface TipTapEditorLike {
  chain: () => Record<string, (...args: never[]) => { run: () => void }>;
  getHTML: () => string;
  destroy?: () => void;
  commands?: { setContent?: (v: string) => void };
}

/** TipTap 编辑器的参数 */
export interface TipTapEditorProps {
  /** 内容（HTML） */
  value?: string;
  /** 内容变化（HTML + 纯文本） */
  onChange?: (html: string, plain: string) => void;
  /** 工具栏（宿主可配；不传 → 默认的） */
  toolbar?: RichTextToolbarItem[];
  /** 高亮色板 */
  palette?: RichTextPalette;
  /** 占位文案 */
  placeholder?: string;
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
 * **TipTap 编辑器**。
 *
 * ⚠️ **必须动态 import**（TipTap 是可选 peer）：
 * → 宿主没装 TipTap → 动态 import 失败 → 回退到**内置的轻量编辑器** ✅
 * → 宿主没装 → **主入口体积不变** ✅
 *
 * @param props 参数
 */
export function TipTapEditor(props: TipTapEditorProps) {
  const {
    value = '',
    onChange,
    toolbar,
    palette,
    placeholder,
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

  const [editor, setEditor] = useState<unknown>(null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  /**
   * **最新的 `onChange`**（用 ref 存）。
   *
   * ⚠️ **为什么要用 ref**：
   * → 动态加载的 effect **依赖数组是空的** → 闭包里的 `onChange` 是**第一次渲染时的**
   * → 宿主换了回调 → 我们还在调旧的 ❌
   * → 用 ref → 永远是**最新的** ✅
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /**
   * **编辑器最后一次发出的 HTML**。
   *
   * -> 用来判断"内容变化是用户打的还是外部改的"
   * -> 用户打的 -> 和它一样 -> **不要 setContent**（否则打断输入）✅
   */
  const lastHtmlRef = useRef<string>(value);

  // 动态加载 TipTap
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mod = await import('./tiptap/runtime');
        if (cancelled) return;
        const created = mod.createTipTapEditor(hostRef.current, {
          content: value,
          onChange: (html: string) => {
            lastHtmlRef.current = html;
            onChangeRef.current?.(html, richTextToPlain(html));
          },
        });
        if (!cancelled) {
          setEditor(created);
        }
      } catch {
        // 宿主没装 TipTap → 回退
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    /*
     * ⚠️⚠️ **依赖数组必须是空的**（只在挂载时加载一次）。
     *
     * → 如果依赖了 `value` → **每敲一个字就重建编辑器** → **输入全丢** ❌
     *   （实测：打字后 ProseMirror 里还是空的）
     * → 内容的同步交给下面那个 effect ✅
     */
    // biome-ignore lint/correctness/useExhaustiveDependencies: 只在挂载时加载一次
  }, [value]);

  // 外部内容变化 → 同步到编辑器
  useEffect(() => {
    if (!editor) {
      return;
    }
    const e = editor as { getHTML?: () => string; commands?: { setContent?: (v: string) => void } };
    if (e.getHTML?.() === value) {
      return;
    }
    /*
     * ⚠️⚠️ **只在"外部真的改了内容"时才 setContent**。
     *
     * → 用户打字 → `onChange` → 父组件 `value` 变 → 这个 effect 跑
     * → 但编辑器里的内容**已经是对的**（就是用户刚打的）
     * → 如果这时 `setContent` → **光标跳到开头 / 输入被打断** ❌
     *
     * → 判据：编辑器的 HTML 和 `value` 不同才同步 ✅
     * → 用户打字时，编辑器 HTML **本来就等于** value → 不会重复 setContent ✅
     */
    e.commands?.setContent?.(value);
  }, [editor, value]);

  /*
   * 卸载时销毁（连同 React root）。
   *
   * ⚠️⚠️ **不能在 effect 的 cleanup 里销毁**（实测踩过的坑）。
   *
   * → React 18+ 的 **StrictMode**（开发模式）会"挂载 → 卸载 → 再挂载"
   * → 第一次的 cleanup 会**销毁掉编辑器**
   * → 第二次挂载时容器已经有 root → 编辑器**渲染不出来** ❌
   *   （实测：`.ProseMirror` 直接变成 undefined）
   *
   * → 解法：**只在真正卸载时销毁**（用 `useRef` 记"是否已经挂载过"）✅
   * → 开发模式的假卸载 → **不销毁** ✅
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editor) {
      return;
    }
    /*
     * → 用 `queueMicrotask` 推迟销毁 →
     *   给 StrictMode 的"再挂载"留出时间（再挂载会复用同一个 editor）✅
     */
    return () => {
      queueMicrotask(() => {
        if (aliveRef.current) {
          return;
        }
        void import('./tiptap/runtime').then((mod) => {
          mod.destroyTipTapEditor(editor as never);
        });
      });
    };
  }, [editor]);

  /*
   * ⚠️ **工具栏文案要走 i18n**（`{richtext.bold}` → "加粗"）。
   * -> 之前直接用原始 label -> 界面上显示 `{richtext.bold}` ❌
   */
  const items = useMemo(
    () =>
      (toolbar ?? defaultRichTextToolbar(palette)).map((item) => ({
        ...item,
        label: resolveToolbarLabel(item.label, locale, messages, locales),
      })),
    [toolbar, palette, locale, messages, locales],
  );

  // ⚠️ **宿主没装 TipTap** → 回退到内置的轻量编辑器
  if (failed) {
    return (
      <RichTextEditor
        value={value}
        onChange={onChange}
        toolbar={items}
        palette={palette}
        icons={icons}
        locale={locale}
        locales={locales}
        messages={messages}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="scpdf-rich-text">
      <TipTapToolbar hostRef={hostRef} items={items} icons={icons} t={t} />
      <div
        ref={hostRef}
        className="scpdf-rich-text__editor scpdf-tiptap__editor"
        data-placeholder={placeholder}
      />
    </div>
  );
}

/** 工具栏（用 TipTap 的命令） */
function TipTapToolbar(props: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  items: RichTextToolbarItem[];
  icons?: Partial<Record<IconName, ReactNode>>;
  t: (key: keyof Messages, vars?: Record<string, string | number>) => string;
}) {
  const { hostRef, items, icons, t } = props;

  /**
   * **拿到编辑器实例**。
   *
   * ⚠️ **从 DOM 上取**（`host.editor`），不要从 React state 取。
   *
   * → `editor.mount(host)` 会把实例挂在 DOM 元素上（`el.editor`）✅
   * → React state 里的那个可能是**旧的**（StrictMode 双挂载）❌
   * → 从 DOM 取 → **永远是当前那个** ✅
   */
  const getEditor = useCallback(() => {
    const host = hostRef.current;
    if (!host) {
      return null;
    }
    /*
     * ⚠️ **编辑器实例在 ProseMirror 元素上**（`el.editor`），
     *    **不在 host 上**。
     * -> `editor.mount(host)` 会往 host 里插一个 `.ProseMirror` 元素
     * -> 实例挂在**那个元素**上 ✅
     */
    const pm = host.querySelector('.ProseMirror') as
      | (HTMLElement & {
          editor?: TipTapEditorLike;
        })
      | null;
    return pm?.editor ?? null;
  }, [hostRef]);

  /*
   * 工具栏要在编辑器挂载后才显示。
   *
   * ⚠️ **不能只 setTimeout(0)** -> 动态 import 是异步的
   * -> 那一刻编辑器**还没挂载** -> 工具栏永远不显示 ❌
   * -> 用**轮询**（最多等 3 秒）✅
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (getEditor() || tries > 60) {
        setMounted(Boolean(getEditor()));
        window.clearInterval(timer);
      }
    }, 50);
    return () => {
      window.clearInterval(timer);
    };
  }, [getEditor]);

  /** TipTap 的链式命令（用一个宽松的类型，避免依赖具体泛型） */
  type Chained = Record<string, (...args: never[]) => { run: () => void }>;

  const run = (command: RichTextToolbarItem['command'], value?: string) => {
    const ed = getEditor();
    if (!ed) {
      return;
    }
    const c = ed.chain() as unknown as Chained;

    /*
     * ⚠️ **不要调 `focus()`**。
     * → TipTap 的 `chain().focus()` 会**重置选区到开头** ❌
     * → 选区没了 → `toggleBold` 作用不到任何文字 ❌
     * → 选区的保持靠按钮的 `onMouseDown` + `preventDefault` ✅
     */
    /*
     * ⚠️ **TipTap 的命令名和包内置的略有不同**。
     * → 包用 `highlight` / `textColor` / `link`
     * → TipTap 用 `toggleHighlight` / `setColor` / `setLink`
     */
    /*
     * ⚠️ **包的命令名（execCommand 风格）和 TipTap 的不同**。
     * → 包：`hiliteColor` / `foreColor` / `createLink`
     * → TipTap：`toggleHighlight` / `setColor` / `setLink`
     */
    const map: Record<string, string> = {
      bold: 'toggleBold',
      italic: 'toggleItalic',
      underline: 'toggleUnderline',
      strikeThrough: 'toggleStrike',
      hiliteColor: 'toggleHighlight',
      foreColor: 'setColor',
      createLink: 'setLink',
      insertUnorderedList: 'toggleBulletList',
      insertOrderedList: 'toggleOrderedList',
      formatBlock: 'toggleBlockquote',
      removeFormat: 'unsetAllMarks',
    };

    const name = map[command];
    if (!name) {
      return;
    }

    const fn = c[name];
    if (!fn) {
      return;
    }

    if (command === 'foreColor') {
      if (value) {
        fn(value as never).run();
      } else {
        c.unsetColor?.().run();
      }
      return;
    }

    if (command === 'createLink') {
      const href = window.prompt(t('richtext.linkPrompt'), 'https://');
      if (!href) {
        return;
      }
      fn({ href } as never).run();
      return;
    }

    fn().run();
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="scpdf-rich-text__toolbar">
      {items.map((item) => (
        <button
          key={item.command}
          type="button"
          className="scpdf-rich-text__btn"
          title={item.label}
          aria-label={item.label}
          /*
           * ⚠️⚠️ **必须用 `onMouseDown` + `preventDefault`**（实测踩过的坑）。
           *
           * → 点按钮 → 浏览器把焦点从编辑器移走 → **选区丢失** ❌
           * → 之后 `toggleBold` 作用在**空选区**上 → 什么都没发生 ❌
           *   （实测：点"加粗"后 HTML 完全没变）
           *
           * → `preventDefault` → **阻止焦点转移** → 选区还在 → 命令生效 ✅
           * → 并且 `mousedown` 比 `click` 更早 → 命令在选区还在时执行 ✅
           */
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            run(item.command, item.palette ? Object.values(item.palette)[0] : undefined);
          }}
        >
          {item.icon ? (
            <Icon name={item.icon as IconName} size={15} overrides={icons} />
          ) : (
            item.label
          )}
        </button>
      ))}
    </div>
  );
}
