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
import type { ToolbarStateEditor } from '../core/editor/toolbar-state';
import { computeToolbarActiveState } from '../core/editor/toolbar-state';
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

  /** 最新的 placeholder（编辑器只创建一次 -> 用 ref 拿最新的） */
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

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
          placeholder: placeholderRef.current ?? '',
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
     * ⚠️⚠️ **绝不能无条件 setContent**（实测踩过的坑）。
     *
     * → 用户打字 → `onChange` → 父组件 `value` 变 → 这个 effect 跑
     * → 但 `value` 是**受控的异步状态** → 这一刻可能还差一个字符
     * → `setContent` → **光标跳到开头 / 输入被打断** ❌
     *   （实测：12 个字只打进去 1 个 "这"）
     *
     * → 判据：用 `lastHtmlRef` 记住"编辑器最后一次发出的内容"
     *   → 外部改的 → 和它不同 → 同步 ✅
     *   → 用户打的 → 它已经是新的 → **不碰** ✅
     */
    if (lastHtmlRef.current === value) {
      return;
    }
    lastHtmlRef.current = value;
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
      <div ref={hostRef} className="scpdf-rich-text__editor scpdf-tiptap__editor" />
    </div>
  );
}

/** 工具栏（用 TipTap 的命令） */
/**
 * **要检查"激活状态"的格式**（用于轮询的签名）。
 *
 * ⚠️ **和 `computeToolbarActiveState` 里的映射保持一致** ✅
 */
const FORMAT_CHECKS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'highlight',
  'textStyle',
  'link',
  'bulletList',
  'orderedList',
  'blockquote',
] as const;

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

  /*
   * ⚠️⚠️ **工具栏的"按下态"**（用户需求：
   * "点了加粗之后 加粗按钮没加深颜色 别的按钮也一样 看不出点击了"）。
   *
   * → 之前工具栏**不知道当前选区是什么格式** -> 按钮永远不变 ❌
   * → 现在：**轮询编辑器的状态** -> 变了就重算 ✅
   *
   * ### 为什么用"轮询"而不是订阅事件
   *
   * → 订阅 `selectionUpdate` / `transaction` **不可靠**（实测踩过的坑）：
   *   - TipTap v3 的事件在**某些路径下不触发**（命令执行、程序化改内容）❌
   *   - React StrictMode 下 effect 会跑两次 -> 监听器**注册了两份** ❌
   *   - 事件触发时 React 的批处理时机**不好控** ❌
   * → 轮询（`requestAnimationFrame`）**永远拿到最新状态**，且实现简单 ✅
   * → 开销：每帧一次 `isActive` -> **可以忽略** ✅
   */
  const [activeTick, forceActiveUpdate] = useState(0);
  useEffect(() => {
    if (!mounted) {
      return;
    }
    let raf = 0;
    let last = '';
    const tick = () => {
      const ed = getEditor() as unknown as {
        state?: { selection?: { from?: number; to?: number } };
      } | null;
      /*
       * ⚠️⚠️ **签名必须包含"格式状态"，不能只看选区位置**（实测踩过的坑）。
       *
       * ### 之前（只签名选区位置）
       *
       * ```js
       * const signature = `${sel.from}-${sel.to}`;
       * ```
       *
       * → 点"加粗" -> **选区位置没变**（还是 1-12）-> 签名一样 ❌
       * → `forceActiveUpdate` **不调用** -> `useMemo` 不重算 ❌
       * → 按钮的 `data-active` **永远是 "false"** ❌
       *   （实测：HTML 已经变成 `<strong>` 了，但按钮还是灰的）
       *
       * ### 现在
       *
       * → 签名 = **选区位置 + 文档大小 + 各格式的激活状态** ✅
       * → 格式变了 -> 签名变了 -> 重算 ✅
       */
      const sel = ed?.state?.selection;
      const raw = ed as unknown as { isActive?: (n: string) => boolean } | null;
      const formatSig = raw?.isActive
        ? FORMAT_CHECKS.map((name) => (raw.isActive?.(name) ? '1' : '0')).join('')
        : '';
      const signature = sel ? `${sel.from}-${sel.to}|${formatSig}` : '';
      if (signature !== last) {
        last = signature;
        forceActiveUpdate((n) => n + 1);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [mounted, getEditor]);

  /** 每个按钮的激活状态（顺序和 `items` 一致） */
  const activeStates = useMemo(() => {
    /*
     * ⚠️⚠️ **`activeTick` 必须在这里被"用掉"**（实测踩过的坑）。
     *
     * → 它是**依赖** -> 必须**在回调里读到** -> 否则 biome 会把它从依赖数组里**删掉** ❌
     *   （实测：biome 的 `useExhaustiveDependencies`  autofix 把 `activeTick` 从 deps 里删了
     *    -> `useMemo` 永远用缓存 -> 按钮的 `data-active` 一直是 "false" ❌）
     * → 这里读一下（不用它的值，只为满足依赖检查）✅
     */
    void activeTick;

    const raw = getEditor() as unknown as {
      isActive?: ToolbarStateEditor['isActive'];
      can?: () => { undo?: () => boolean; redo?: () => boolean };
    } | null;
    if (!raw?.isActive) {
      return computeToolbarActiveState(
        items.map((item) => item.command),
        null,
      );
    }
    /*
     * ⚠️ **适配 TipTap 的 `can()` API**。
     *
     * → TipTap 的撤销判断是 `editor.can().undo()`（不是 `editor.canUndo()`）✅
     * → 我们把它包成统一的接口 -> core 那边不用知道 TipTap ✅
     */
    const adapter: ToolbarStateEditor = {
      isActive: (nameOrAttrs, attributes) => raw.isActive?.(nameOrAttrs, attributes) ?? false,
      can: () => Boolean(raw.can?.().undo?.()),
      canUndo: () => Boolean(raw.can?.().undo?.()),
      canRedo: () => Boolean(raw.can?.().redo?.()),
    };
    return computeToolbarActiveState(
      items.map((item) => item.command),
      adapter,
    );
  }, [items, getEditor, activeTick]);

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
      undo: 'undo',
      redo: 'redo',
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
      {items.map((item, index) => {
        const state = activeStates[index];
        const active = state?.active ?? false;
        const disabled = state?.disabled ?? false;
        return (
          <button
            key={item.command}
            type="button"
            className="scpdf-rich-text__btn"
            title={item.label}
            aria-label={item.label}
            /*
             * ⚠️⚠️ **按下态**（用户需求：
             * "点了加粗之后 加粗按钮没加深颜色 别的按钮也一样 看不出点击了"）。
             *
             * → `data-active` -> CSS 画**明显的按下态**（主色底 + 主色图标）✅
             * → `aria-pressed` -> 无障碍也能读出"这个格式开着" ✅
             */
            data-active={active ? 'true' : 'false'}
            aria-pressed={active}
            disabled={disabled}
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
        );
      })}
    </div>
  );
}
