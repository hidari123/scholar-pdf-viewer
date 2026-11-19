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
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

/** 创建编辑器的选项 */
export interface CreateTipTapOptions {
  /** 初始内容（HTML） */
  content: string;
  /** 内容变化 */
  onChange: (html: string) => void;
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
      Highlight.configure({ multicolor: true }),
      Color,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: options.content,
    onUpdate: ({ editor: e }) => {
      options.onChange(e.getHTML());
    },
  });

  /*
   * ⚠️ **用 `editor.mount()` 而不是 `<EditorContent />`**。
   * → `EditorContent` 是 React 组件 → 需要在容器上 `createRoot`
   * → 而容器**已经是 React 管理的** → 抢 DOM → 各种诡异问题（实测）❌
   * → `editor.mount(host)` 是**纯 DOM** → 不碰 React ✅
   */
  editor.mount(host);

  return editor;
}

/**
 * **销毁编辑器**。
 *
 * @param editor 编辑器实例
 */
export function destroyTipTapEditor(editor: Editor): void {
  editor.destroy?.();
}
