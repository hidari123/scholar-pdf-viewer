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
import {
  defaultRichTextToolbar,
  isNoColor,
  NO_COLOR,
  richTextToPlain,
} from '../core/editor/rich-text';
import type { ToolbarStateEditor } from '../core/editor/toolbar-state';
import { computeToolbarActiveState, FORMAT_COMMANDS } from '../core/editor/toolbar-state';
import { resolveHighlightColorName } from '../core/highlight/palette';
import type { Locale, LocaleMessagesMap, LocaleTable, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { LinkPopover } from './LinkPopover';
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
  /** 高亮色板（**浅色**，当"高亮底色"用） */
  palette?: RichTextPalette;
  /**
   * **"文字颜色"色板**（**深色**）。
   *
   * ⚠️ **和 `palette` 分开**（用户反馈：
   * "富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色"）。
   */
  textPalette?: RichTextPalette;
  /** 占位文案 */
  placeholder?: string;
  /** 图标覆盖 */
  icons?: Partial<Record<IconName, ReactNode>>;
  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表 */
  locales?: LocaleTable;
  /** 文案覆盖 */
  messages?: LocaleMessagesMap;
  /**
   * **嵌套弹窗的状态**（比如链接弹窗开没开）。
   *
   * ⚠️ 外层弹窗用它决定 Esc 的行为：
   * -> 链接弹窗开着 -> Esc 关**链接弹窗**，不关外层 ✅
   *   （实测踩过的坑：Esc 把整个批注弹窗也关掉了 ❌）
   */
  onOverlayStateChange?: (hasOverlay: boolean) => void;
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
    textPalette,
    placeholder,
    icons,
    locale = 'zh',
    locales,
    messages,
    onOverlayStateChange,
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
      (toolbar ?? defaultRichTextToolbar(palette, textPalette)).map((item) => ({
        ...item,
        label: resolveToolbarLabel(item.label, locale, messages, locales),
      })),
    [toolbar, palette, textPalette, locale, messages, locales],
  );

  // ⚠️ **宿主没装 TipTap** → 回退到内置的轻量编辑器
  if (failed) {
    return (
      <RichTextEditor
        value={value}
        onChange={onChange}
        toolbar={items}
        palette={palette}
        textPalette={textPalette}
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
      <TipTapToolbar
        hostRef={hostRef}
        items={items}
        icons={icons}
        palette={palette}
        t={t}
        locale={locale}
        onOverlayStateChange={onOverlayStateChange}
      />
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
  /** 颜色面板（高亮底色 / 文字高亮共用，**浅色**） */
  palette?: RichTextPalette;
  /** **文字颜色**色板（**深色**） */
  textPalette?: RichTextPalette;
  t: (key: keyof Messages, vars?: Record<string, string | number>) => string;
  /**
   * **当前语言**（色块的 tooltip 要本地化）✅
   *
   * ⚠️ 之前色块的 `title={key}` -> 显示英文 key ❌ -> 和界面语言不一致 ❌
   */
  locale: Locale;
  /** 嵌套弹窗的状态（通知外层） */
  onOverlayStateChange?: (hasOverlay: boolean) => void;
}) {
  const { hostRef, items, icons, palette, textPalette, t, locale, onOverlayStateChange } = props;

  /**
   * **当前展开的颜色面板**（命令名）。
   *
   * ⚠️⚠️ **TipTap 这边之前【完全没有】颜色面板**（审计发现的**真 bug**）。
   *
   * -> 之前点"文字颜色"-> **直接应用第一个颜色** ❌
   *   -> 用户反馈："点击会打开一个空的窄的框" ❌
   * -> 内置编辑器（`RichTextEditor`）**有**面板 ✅ -> 两边行为不一致 ❌
   * -> 现在：**两边一致** ✅
   */
  const [openPalette, setOpenPalette] = useState<string | null>(null);

  /*
   * ⚠️ **工具栏【外层容器】的 ref**（点外面关闭面板时判断"点在哪儿"）。
   *
   * -> ⚠️ **必须是 `.scpdf-rich-text__toolbar-wrap`**（不是 `.scpdf-rich-text__toolbar`）❌
   *    -> **颜色面板是 toolbar 的【兄弟节点】**（都在 wrap 里）✅
   *    -> 用 toolbar 判断 -> `contains(panel)` = false ❌ -> 点面板里也会关 ❌
   */
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  /*
   * ⚠️⚠️ **点面板外面要关闭颜色面板**（用户反馈：
   * "富文本编辑框里的文字颜色和高亮这两个按钮选择完颜色之后
   *  如果点击非选择颜色框的区域 是需要关闭这个选择框的 目前没有关闭"）。
   *
   * -> 和内置编辑器（`RichTextEditor`）**行为一致** ✅
   * -> 点**面板外面** -> 关闭 ✅
   * -> 点**面板里面** -> **不关** ✅
   * -> **Esc** -> 也关闭 ✅
   */
  useEffect(() => {
    if (!openPalette) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      // 点在工具栏里（含面板）-> 不关 ✅
      if (target && toolbarRef.current?.contains(target)) {
        return;
      }
      setOpenPalette(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPalette(null);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openPalette]);

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
      /*
       * ⚠️⚠️ **"当前有没有选中文字"**（用户需求：
       * "清除格式按钮如果没有选择文字 应该置灰"✅）。
       *
       * -> TipTap 的 `editor.state.selection.empty` ✅
       *    -> `empty = true` 表示**没有选区**（光标在那儿）✅
       *    -> `empty = false` 表示**选中了文字** ✅
       * -> 没选文字 -> 格式按钮**置灰** ✅
       */
      hasSelection: () => {
        const state = (raw as unknown as { state?: { selection?: { empty?: boolean } } }).state;
        const empty = state?.selection?.empty;
        // ⚠️ **拿不到就当成"有选区"**（不误伤）✅
        return empty === undefined ? true : !empty;
      },
    };
    return computeToolbarActiveState(
      items.map((item) => item.command),
      adapter,
    );
  }, [items, getEditor, activeTick]);

  /** TipTap 的链式命令（用一个宽松的类型，避免依赖具体泛型） */
  type Chained = Record<string, (...args: never[]) => { run: () => void }>;

  /*
   * ⚠️⚠️ **链接弹窗的状态**。
   *
   * → `open` —— 是否打开 ✅
   * → `anchor` —— 链接按钮的位置（视口坐标）-> 弹窗贴着它显示 ✅
   * → `selection` —— **打开那一刻的选区**（位置 + 文字）✅
   *   → 确定链接时用它来打标记 ✅
   *   → 用户在弹窗里操作时，编辑器的选区可能变了 -> 必须记住打开时的 ✅
   */
  const [linkState, setLinkState] = useState<{
    open: boolean;
    anchor: { left: number; top: number; right: number; bottom: number } | null;
    from: number;
    to: number;
    text: string;
  }>({ open: false, anchor: null, from: 0, to: 0, text: '' });

  /*
   * **嵌套弹窗的状态** -> 通知外层（外层据此决定 Esc 的行为）。
   *
   * ⚠️ 用户体验：链接弹窗开着时按 Esc -> **只关链接弹窗**，
   *   别把整个批注弹窗也关了 ❌（实测踩过的坑）
   */
  const linkOverlayOpen = linkState.open;
  /*
   * ⚠️⚠️ **"有嵌套浮层"= 链接弹窗【或】颜色面板**（Esc 的行为要靠它）。
   *
   * -> 外层（`AnnotationDialog`）有自己的 **Esc -> 关自己** ❌
   * -> 嵌套浮层开着时按 Esc -> **整个弹窗被关掉** ❌
   *    （实测：Esc 之后 `.scpdf-annotation-dialog` 整个消失了）
   * -> 通知外层 -> 外层在 Esc 时**让出** Esc ✅
   *
   * ⚠️ **必须合并成一个 effect** ❌
   * -> 两个 effect 都调 `onOverlayStateChange` -> **后写的覆盖先写的** ❌
   *    -> 颜色面板开着 -> 链接弹窗的 effect 把它设成 false -> Esc 还是会关弹窗 ❌
   */
  const anyOverlayOpen = linkOverlayOpen || openPalette !== null;
  useEffect(() => {
    onOverlayStateChange?.(anyOverlayOpen);
    return () => {
      onOverlayStateChange?.(false);
    };
  }, [anyOverlayOpen, onOverlayStateChange]);

  /**
   * **打开链接弹窗**（记下当前的选区和按钮位置）。
   */
  const openLinkPopover = useCallback(() => {
    const ed = getEditor() as unknown as {
      state?: { selection?: { from: number; to: number } };
    } | null;
    const sel = ed?.state?.selection;
    if (!ed || !sel) {
      return;
    }

    /*
     * ⚠️ **记下选中的文字**（第 2 行的默认值）。
     * → 用 `state.doc.textBetween(from, to)` ✅
     * → 不要用 `window.getSelection()`（弹窗打开后会变）❌
     */
    const doc = (
      ed as unknown as { state: { doc: { textBetween: (a: number, b: number) => string } } }
    ).state.doc;
    const text = sel.from === sel.to ? '' : doc.textBetween(sel.from, sel.to);

    /*
     * ⚠️ **按钮的位置**（弹窗的锚点）。
     * → 用链接按钮的 `getBoundingClientRect()` ✅
     */
    const rect = linkButtonRef.current?.getBoundingClientRect();

    setLinkState({
      open: true,
      anchor: rect
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        : null,
      from: sel.from,
      to: sel.to,
      text,
    });
  }, [getEditor]);

  /** 链接按钮的位置（用 ref 拿，避免用全局选择器） */
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);

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
      textHighlight: 'toggleHighlight',
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

    /*
     * ⚠️⚠️ **颜色命令要带颜色值**（审计修复）。
     *
     * -> `foreColor` -> `setColor(value)` ✅
     * -> `hiliteColor` -> `toggleHighlight({ color: value })` ✅
     *   （之前没传 value -> **高亮用的是默认色** -> 选哪个都一样 ❌）
     * -> 没传值 -> `unsetColor` / `unsetHighlight`（清除）✅
     */
    /*
     * ⚠️⚠️ **"无背景色"（`NO_COLOR`）-> 当成"清除"** ✅
     *
     * -> 用户需求："高亮这个按钮需要加上一个无背景颜色的选项，如飞书样式"✅
     * -> `unsetHighlight()` / `unsetColor()` **比 `transparent` 干净** ✅
     *    -> `transparent` 会留一个 `background-color: transparent` 在 HTML 里 ❌
     */
    const isNone = isNoColor(value);

    if (command === 'foreColor') {
      if (value && !isNone) {
        fn(value as never).run();
      } else {
        c.unsetColor?.().run();
      }
      return;
    }

    if (command === 'hiliteColor' || command === 'textHighlight') {
      if (value && !isNone) {
        fn({ color: value } as never).run();
      } else {
        c.unsetHighlight?.().run();
      }
      return;
    }

    if (command === 'createLink') {
      /*
       * ⚠️⚠️ **不再用 `window.prompt`**（用户需求：
       * "链接弹窗是默认的弹窗 ... 这个输入框你自己写一个出来 不要用系统默认的框 很丑"）。
       *
       * → `window.prompt` **阻塞**整个页面 -> 编辑器失焦 -> **选区丢失** ❌
       *   （实测：点"链接"后弹系统框，填完再选文字就没了）
       * → 样式**完全不可控** ❌
       * → 只能填一个值 -> 没法同时填"链接"和"展示文字" ❌
       *
       * → 现在：**打开自己的 `LinkPopover`** ✅
       * → 打开时**先记下当前选区**（位置 + 文字）-> 确定时用 ✅
       */
      openLinkPopover();
      return;
    }

    fn().run();
  };

  /**
   * **确定链接**（把链接 + 展示文字应用到编辑器的选区上）。
   *
   * ⚠️⚠️ **三个场景**（用户需求）：
   *
   * | 场景 | 做法 |
   * |---|---|
   * | **选了文字** | 给选区打链接标记 ✅ |
   * | **没选文字 + 展示文字 = 网址** | **插入**一个带链接的文本 ✅ |
   * | **没选文字 + 展示文字 ≠ 网址** | **插入**"展示文字"并给它打链接 ✅ |
   *
   * ⚠️ **插入后光标要放到链接之后**，且**清掉 storedMarks** ❌
   * → 否则继续打字会**继承链接样式**（用户反馈："输入了链接之后再往后加文字
   *   还是链接的样式 这逻辑就没有一个是对的"）✅
   */
  const applyLink = useCallback(
    (href: string, text: string) => {
      /*
       * ⚠️ **用一个宽松的链式类型**（避免依赖 TipTap 的具体泛型）。
       *
       * → 每个命令返回**链本身**（可以继续 `.xxx()`）✅
       * → 最后用 `.run()` 执行 ✅
       */
      type LinkChain = {
        setLink: (attrs: { href: string }) => LinkChain;
        insertContent: (content: string) => LinkChain;
        insertContentAt: (range: { from: number; to: number }, content: string) => LinkChain;
        setTextSelection: (pos: number | { from: number; to: number }) => LinkChain;
        unsetMark: (name: string) => LinkChain;
        run: () => void;
      };
      const ed = getEditor() as unknown as {
        chain: () => LinkChain;
        focus?: () => void;
        state: { doc: { content: { size: number } } };
      } | null;
      if (!ed) {
        return;
      }
      const { from, to } = linkState;

      if (from !== to) {
        /*
         * ⚠️ **选了文字** -> 打链接标记。
         *
         * → 如果用户改了"显示文字" -> **要把选中的文字替换成它** ✅
         *   （用户需求："框内可以修改文字"）
         * → 没改 -> 保持原样 ✅
         */
        const selected = linkState.text;
        if (text && text !== selected) {
          // 先替换文字，再打链接
          ed.chain().insertContentAt({ from, to }, escapeHtml(text)).run();
          // 替换后选区会变 -> 重新算范围
          const newTo = from + text.length;
          ed.chain().setTextSelection({ from, to: newTo }).run();
          ed.chain().setLink({ href }).run();
        } else {
          ed.chain().setLink({ href }).run();
        }
      } else {
        // 没选文字 -> 插入"展示文字"（带链接）
        ed.chain()
          .insertContent(`<a href="${href}">${escapeHtml(text)}</a>`)
          .run();
      }

      /*
       * ⚠️⚠️ **光标放到链接之后 + 清掉 storedMarks + 聚焦编辑器**（实测踩过的坑）。
       *
       * → TipTap 的 link mark 默认 `inclusive: true` -> 继续打字会**继承链接** ❌
       *   （实测："click here" + " MORE" -> "click her MOREe" 全是链接）
       * -> 解法：
       *   1. `inclusive: () => false`（在 runtime 里改）-> 新文字不自动继承 ✅
       *   2. 光标放到**段落末尾**（链接之后）✅
       *   3. `unsetMark('link')` -> 清掉光标处的 storedMarks ✅
       *   4. **聚焦编辑器** -> 用户能接着打字 ✅
       *      （实测：不聚焦的话弹窗一关，键盘输入**完全没反应** ❌）
       *
       * ⚠️⚠️ **每一步都要用"新的 chain"**（实测踩过的坑）。
       *
       * → `ed.chain()` 会**捕获当时的 state**（一个 transaction 的快照）
       * → 用同一个 chain 连着跑 -> 后面的命令作用在**旧的 state** 上 ❌
       *   （实测：选区设了还是 1-12，不是末尾）
       * -> 每步**重新 `ed.chain()`** -> 拿到最新的 state ✅
       */
      const end = ed.state.doc.content.size - 1;

      /*
       * ⚠️⚠️ **顺序 + 方法都很重要**（实测踩过的坑）。
       *
       * ### 踩过的三个坑
       *
       * 1. `chain()` 捕获**当时的 state** -> 用同一个 chain 连着跑，
       *    后面的命令作用在**旧 state** 上 ❌
       *    -> 每步**重新 `ed.chain()`** ✅
       *
       * 2. `unsetMark('link')` 在**链接文本上** -> **把链接本身删掉了** ❌
       *    （实测：`<a href=...>hello world</a>` -> `<p>hello world</p>`，链接没了）
       *    -> `unsetMark` 是"去掉**范围内**的 mark"，不是"清光标的 storedMarks" ❌
       *
       * 3. `setTextSelection` -> `unsetMark` -> **选区被 unsetMark 重置回原处** ❌
       *    （实测：设完之后选区还是 1-12，不是末尾）
       *
       * ### 正确的做法
       *
       * -> **先移开选区**（到链接之后）✅
       * -> **再直接改 transaction 的 storedMarks**（不是用命令）✅
       */
      ed.chain().setTextSelection(end).run();

      /*
       * ⚠️ **直接清 storedMarks**（不用 `unsetMark` 命令）。
       *
       * → 我们要的只是"光标处不要再自动带上链接" ✅
       * -> `tr.setStoredMarks(...)` 只影响**光标处的"待用格式"** ✅
       */
      const view = (ed as unknown as { view?: { dispatch?: (tr: unknown) => void } }).view;
      const tr = (ed as unknown as { state?: { tr?: unknown } }).state?.tr;
      if (view?.dispatch && tr) {
        try {
          const typed = tr as unknown as {
            storedMarks?: { type: { name: string } }[];
            setStoredMarks: (marks: unknown) => void;
          };
          typed.setStoredMarks(typed.storedMarks?.filter((m) => m.type.name !== 'link') ?? null);
          view.dispatch(tr);
        } catch {
          /* 清不掉就算了（不影响主要功能） */
        }
      }

      /*
       * ⚠️ **聚焦要单独调**（不能放进 chain 里）。
       *
       * → `chain().focus()` 会**重置选区到开头** ❌
       * → 所以：先 `setTextSelection`（设好选区），再单独 `focus()` ✅
       */
      ed.focus?.();

      /*
       * ⚠️⚠️ **`ed.focus()` 不够**（实测踩过的坑）。
       *
       * -> 点"确定"按钮 -> 焦点在**按钮**上 -> 弹窗关闭 -> 按钮被卸载
       * -> 焦点**掉到 body** 上了 ❌ -> 键盘输入**完全没反应** ❌
       * -> 所以要**直接聚焦 DOM 元素**（`.ProseMirror`）✅
       */
      const pmEl = (getEditor() as unknown as { view?: { dom?: HTMLElement } } | null)?.view?.dom;
      if (pmEl) {
        pmEl.focus({ preventScroll: true });
      }

      setLinkState((s) => ({ ...s, open: false }));
    },
    [getEditor, linkState],
  );

  if (!mounted) {
    return null;
  }

  return (
    <div className="scpdf-rich-text__toolbar-wrap" ref={toolbarRef}>
      <div className="scpdf-rich-text__toolbar">
        {items.map((item, index) => {
          const state = activeStates[index];
          const active = state?.active ?? false;
          /*
           * ⚠️⚠️ **"没选文字 -> 格式按钮置灰**（用户需求：
           * "清除格式按钮如果没有选择文字 应该置灰"✅）。
           *
           * -> `state.disabled` 是 TipTap 自己的判断（撤销/重做）✅
           * -> **再合并**"格式类命令 + 没选文字" ✅
           * -> ⚠️ **撤销/重做不受影响**（它们不是格式类）✅
           */
          const tipTapDisabled = state?.disabled ?? false;
          const disabled =
            tipTapDisabled || (state?.hasSelection === false && FORMAT_COMMANDS.has(item.command));
          const isLink = item.command === 'createLink';
          /*
           * ⚠️ **颜色命令**（文字颜色 / 高亮底色）-> 要弹**颜色面板**。
           *
           * -> 和内置编辑器（`RichTextEditor`）**保持一致** ✅
           */
          /*
           * ⚠️ **三个颜色命令都会弹面板**（用户需求）。
           *
           * -> `hiliteColor`    = 高亮底色 ✅
           * -> `textHighlight` = 文字高亮（背景色，字色不变）✅
           * -> `foreColor`     = 文字颜色（深色）✅
           * -> `removeFormat`（清除格式）**不弹面板** -> 直接执行 ✅
           */
          const hasPalette =
            item.command === 'hiliteColor' ||
            item.command === 'textHighlight' ||
            item.command === 'foreColor';
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
               * ⚠️ **链接按钮要记位置**（弹窗的锚点）✅
               */
              ref={isLink ? linkButtonRef : undefined}
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
              /*
               * ⚠️⚠️ **颜色命令要"开面板"**，不是直接应用（审计修复）。
               *
               * -> 之前直接应用 `Object.values(item.palette)[0]` ❌
               *   -> 用户只能用一个颜色 -> **没法选** ❌
               *   -> 用户反馈："点击会打开一个空的窄的框" ❌
               * -> 现在：**和内置编辑器一致** -> 弹出**颜色面板** ✅
               */
              onClick={() => {
                if (hasPalette) {
                  setOpenPalette(openPalette === item.command ? null : item.command);
                  return;
                }
                run(item.command);
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

      {/* 颜色面板（和内置编辑器用同一套 CSS） */}
      {openPalette ? (
        <span className="scpdf-rich-text__palette">
          {/*
           * ⚠️⚠️ **"无背景色"色块**（第一个，斜杠）——
           * 用户需求："高亮这个按钮需要加上一个无背景颜色的选项，如飞书样式"✅
           *
           * -> 点它 -> **清除**这个颜色/高亮 ✅
           * -> TipTap 用 `unsetHighlight()` / `unsetColor()` ✅（比 transparent 干净）
           */}
          <button
            type="button"
            className="scpdf-rich-text__swatch scpdf-rich-text__swatch--none"
            title={t('richtext.noColor')}
            aria-label={t('richtext.noColor')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const cmd = openPalette as RichTextToolbarItem['command'];
              if (cmd === 'foreColor') {
                run(cmd, NO_COLOR);
              } else {
                run(cmd, NO_COLOR);
              }
              setOpenPalette(null);
            }}
          />
          {Object.entries(
            items.find((i) => i.command === openPalette)?.palette ??
              (openPalette === 'foreColor' ? textPalette : palette) ??
              {},
          ).map(([key, color]) => (
            <button
              key={key}
              type="button"
              className="scpdf-rich-text__swatch"
              style={{ background: color }}
              /*
               * ⚠️⚠️ **tooltip 要本地化**（实测踩到的坑，用户反馈：
               * "选区的工具栏里面的中英文title还是会变来变去的
               *  有时候hover上去 title显示中文 有时候英文"）。
               *
               * -> 之前 `title={key}` -> 显示英文 key ❌ -> 和界面语言不一致 ❌
               * -> -> 现在按 key 查**本地化名字** ✅
               */
              title={resolveHighlightColorName(key, locale)}
              aria-label={resolveHighlightColorName(key, locale)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                /*
                 * ⚠️ **类型安全**：`openPalette` 是 `string`，要转成命令类型。
                 */
                run(openPalette as RichTextToolbarItem['command'], color);
                setOpenPalette(null);
              }}
            />
          ))}
        </span>
      ) : null}

      {/*
       **链接弹窗**（自己写的，不用 `window.prompt`）✅
       */}
      <LinkPopover
        open={linkState.open}
        anchor={linkState.anchor}
        selectedText={linkState.text}
        labels={{
          href: t('richtext.linkHref'),
          text: t('richtext.linkText'),
          confirm: t('richtext.linkConfirm'),
          cancel: t('richtext.linkCancel'),
          placeholderHref: t('richtext.linkHrefPlaceholder'),
          placeholderText: t('richtext.linkTextPlaceholder'),
        }}
        onSubmit={applyLink}
        onCancel={() => {
          setLinkState((s) => ({ ...s, open: false }));
        }}
      />
    </div>
  );
}

/**
 * **HTML 转义**（插入链接文字时用）。
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
