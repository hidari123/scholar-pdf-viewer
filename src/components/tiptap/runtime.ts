/**
 * tiptap —— **TipTap 的实际加载点**（动态 import）。
 *
 * ## 为什么单独一个文件
 *
 * → `TipTapEditor` 用 `import('./tiptap/runtime')` **动态**加载
 * → 只有真正要用富文本批注时才加载 → **主入口体积不变** ✅
 * → 宿主没装 TipTap → 动态 import 抛错 → 上层**回退到内置编辑器** ✅
 *
 * ## 为什么 TipTap 是"可选 peerDependency"
 *
 * → 实测 TipTap（starter-kit + highlight/color/link/underline）**106 kB brotli**
 * → 打进主入口 → 首屏加载会明显变慢 ❌
 * → 做成可选 peer → **宿主按需装** ✅
 * → 和 `pdf-lib` 一个思路（可选 peer + 动态 import）
 *
 * ## ⚠️⚠️ **为什么不用 `EditorContent`（React 组件）**
 *
 * → `EditorContent` 需要一个 **React root** → 要 `createRoot(container)`
 * → 但我们的容器是 **React 自己管理的 DOM**（`TipTapEditor` 渲染的 `<div ref>`）
 * → 在 React 管理的容器里再 `createRoot` → **和 React 抢同一个 DOM** ❌
 *   - React StrictMode 会挂载两次 → 第二次 `createRoot` 直接报错 ❌
 *   - 报错后 ProseMirror 只打进去一个字母 ❌
 *
 * → **解法：用 TipTap 的 `editor.mount()`（纯 DOM，不碰 React）** ✅
 * → TipTap 3 里 `EditorContent` 只是 `editor.mount(el)` 的薄封装 ✅
 * → **不碰 React 的 DOM 树** → 挂载/卸载都干净 ✅
 */

import type { Editor } from '@tiptap/core';
import { Editor as TiptapEditorCore } from '@tiptap/core';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

/** 创建编辑器的选项 */
export interface CreateTipTapOptions {
  /** 初始内容（HTML） */
  content: string;
  /** 内容变化 */
  onChange: (html: string) => void;
  /**
   * **占位符**（空的时候显示）。
   *
   * ⚠️ **用 TipTap 的 `Placeholder` 扩展**（官方做法）✅
   * → 占位符挂在**真正可编辑的那个元素**（`.ProseMirror`）上 ✅
   * → 不会和外层容器分离 → 不会看起来像"两个输入框" ✅
   */
  placeholder?: string;
}

/**
 * 创建一个 TipTap 编辑器（挂到 `host` 元素上）。
 *
 * @param host 宿主元素
 * @param options 选项
 * @returns 编辑器实例
 */
export function createTipTapEditor(host: HTMLElement | null, options: CreateTipTapOptions): Editor {
  if (!host) {
    throw new Error('TipTap: 宿主元素还没准备好');
  }

  const h = host as HTMLElement & { __scpdfEditor?: Editor };

  /*
   * ⚠️⚠️ **同一个 host 复用已有的编辑器**（实测踩过的坑）。
   *
   * → `createTipTapEditor` 会对同一个 host 调用**多次**
   *   （React StrictMode 双挂载 + 动态 import resolve 后重渲染）
   * → 每次都新建 → **多个编辑器抢同一个 DOM** → 输入只进第一个 ❌
   *   （实测：12 个字只打进去 1 个）
   *
   * → 解法：**把编辑器缓存到 host 上** → 复用 ✅
   * → 复用时：更新 `onUpdate`（宿主的回调可能变了）+ 同步内容 ✅
   */
  if (h.__scpdfEditor) {
    const existing = h.__scpdfEditor;
    /*
     * ⚠️⚠️ **复用时必须能换掉"内容变化"的回调**。
     *
     * → 之前改 `existing.options.onUpdate` -> **完全无效**（TipTap v3 构造时就绑好了）
     * → 复用时宿主可能换了回调 -> 我们还在调旧的 ❌
     *
     * → 解法：把回调**存在编辑器实例上** -> 事件处理函数读它 ✅
     *   （事件处理函数是构造时注册的，但它每次都读**最新的**那个 ref-like 字段）
     */
    (existing as Editor & { __scpdfOnChange?: (html: string) => void }).__scpdfOnChange =
      options.onChange;
    if (existing.getHTML() !== options.content) {
      existing.commands.setContent(options.content);
    }
    return existing;
  }

  const editor = new TiptapEditorCore({
    extensions: [
      StarterKit.configure({
        // 只保留我们要的 → 减小体积
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        code: false,
        dropcursor: false,
        gapcursor: false,
        /*
         * ⚠️⚠️ **StarterKit v3 自带 link 和 underline** →
         *   再单独加一遍 → **"Duplicate extension names found"** 警告 ❌
         * → 必须**关掉 StarterKit 里的**，再用独立扩展 ✅
         */
        link: false,
        underline: false,
        // 保留（用 {} 表示"启用且用默认配置"）
        blockquote: {},
        orderedList: {},
        bulletList: {},
        strike: {},
      }),
      Underline,
      /*
       * ⚠️⚠️ **必须注册 `TextStyle`**（审计发现的**真 bug**）。
       *
       * -> TipTap 的 `Color` 扩展是**基于 `textStyle` 实现的** ✅
       *   -> `setColor` 内部会 `setMark('textStyle', { color })` ✅
       * -> 但 **StarterKit v3 不包含 `TextStyle`** ❌（实测它的 dist 里只有 18 个扩展，没有 textStyle）
       * -> 只注册 `Color` 不注册 `TextStyle` -> **调用 setColor 直接抛错** ❌
       *   -> 浏览器控制台："There is no mark type named 'textStyle'" ❌
       *   -> -> **文字颜色功能完全失效** ❌
       *   ->   -> 用户反馈："富文本修改文字颜色的功能还是没有实现 点击会打开一个空的窄的框" ✅
       *
       * -> 现在：**显式注册 `TextStyle`** ✅ -> `setColor` 正常工作 ✅
       */
      TextStyle,
      Highlight.configure({ multicolor: true }),
      Color,
      /*
       * ⚠️⚠️ **Link 的 `inclusive` 必须改成 false**（用户反馈：
       * "输入了链接之后再往后加文字 还是链接的样式 这逻辑就没有一个是对的"）。
       *
       * → TipTap 的 Link 扩展里：`inclusive() { return this.options.autolink; }`
       * -> autolink 开着 -> **inclusive 也是 true** ❌
       * -> 在链接末尾继续打字 -> **新文字继承链接标记** ❌
       *   （实测："click here" + " MORE" -> "click her MOREe" 全是链接）
       *
       * -> 覆盖 `inclusive()` -> 永远 false ✅
       * -> **autolink 仍然开着**（输入网址仍然自动变链接）✅
       *   （实测："see https://example.com now" -> 只有网址是链接）
       */
      Link.extend({ inclusive: () => false }).configure({
        openOnClick: false,
        autolink: true,
      }),
      /*
       * ⚠️ **占位符用 TipTap 官方扩展**。
       *
       * → 占位符挂在 `.ProseMirror` 上（真正可编辑的元素）✅
       * → 之前挂在外层容器 → 占位符和编辑区**分离** → 看着像"两个输入框" ❌
       *   （用户反馈："上面输入文字之后第一带黑框 很丑"）
       */
      Placeholder.configure({ placeholder: options.placeholder ?? '' }),
    ],
    content: options.content,
  });

  /*
   * ⚠️⚠️ **用 `editor.on('update')`，不要用构造参数里的 `onUpdate`**（实测踩过的坑）。
   *
   * → TipTap v3 在**构造时**就把 `options.onUpdate` 绑进事件总线
   * → 之后**改 `editor.options.onUpdate` 不生效** ❌
   *   （实测：打字后 `onUpdate` **一次都没触发** → 宿主的 `value` 永远是空的
   *    → 工具栏能改文档，但宿主不知道内容变了 → "各种功能都没有"的直接原因）
   * → `editor.on('update', fn)` 是**正规方式** ✅（实测能正常触发）
   */
  editor.on('update', ({ editor: e }) => {
    /*
     * ⚠️ **读实例上的最新回调**（不是闭包里的那个）-> 复用时能换掉 ✅
     */
    const handler = (editor as Editor & { __scpdfOnChange?: (html: string) => void })
      .__scpdfOnChange;
    (handler ?? options.onChange)(e.getHTML());
  });
  (editor as Editor & { __scpdfOnChange?: (html: string) => void }).__scpdfOnChange =
    options.onChange;

  /*
   * ⚠️⚠️ **同一个 host 上只挂一个编辑器**（实测踩过的坑）。
   *
   * → `editor.mount(host)` 会往 host 里**插一个 `.ProseMirror`**
   * → 如果对同一个 host 调了多次 → **插了好几个** ❌
   *   （实测：`.ProseMirror` 有 **9 个** → 用户看到"下面又冒出来一条输入框"
   *    → 用户反馈："每写一个东西下面就会展示出来一条" ❌）
   *
   * → 为什么会对同一个 host 调多次：
   *   - React StrictMode（开发模式）双挂载
   *   - 动态 import resolve 之后组件可能已经重渲染过
   *
   * → 修法：**挂之前先清掉旧的** ✅
   */
  const existing = host.querySelectorAll('.ProseMirror');
  for (const el of existing) {
    el.remove();
  }

  /*
   * ⚠️ **用 `editor.mount()` 而不是 `<EditorContent />`**。
   * → `EditorContent` 是 React 组件 → 需要在容器上 `createRoot`
   * → 而容器**已经是 React 管理的** → 抢 DOM → 各种诡异问题（实测）❌
   * → `editor.mount(host)` 是**纯 DOM** → 不碰 React ✅
   */
  (editor as Editor & { __scpdfHost?: HTMLElement }).__scpdfHost = host;
  editor.mount(host);
  h.__scpdfEditor = editor;

  return editor;
}

/**
 * **销毁编辑器**。
 *
 * @param editor 编辑器实例
 */
export function destroyTipTapEditor(editor: Editor): void {
  editor.destroy?.();
  const host = (editor as Editor & { __scpdfHost?: HTMLElement }).__scpdfHost;
  if (host) {
    (host as HTMLElement & { __scpdfEditor?: Editor }).__scpdfEditor = undefined;
  }
}
