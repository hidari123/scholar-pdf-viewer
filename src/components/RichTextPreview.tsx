/**
 * RichTextPreview —— **富文本的只读展示**（把 HTML 渲染成排版好的样子）。
 *
 * ## 用户需求
 *
 * > "展示的时候要展示富文本形式的 不要带上标签 翻译成html展示出来"
 *
 * → 之前：直接渲染 `annotation.content`（HTML 字符串）→ 用户看到 **`<p>...</p>`** ❌
 * → 现在：`<RichTextPreview html={...} />` → **排版好的富文本** ✅
 *
 * ⚠️ **安全**：渲染前用 `sanitizeRichTextHtml` 消毒（白名单）✅
 */

import { useMemo } from 'react';
import { richTextToPlainText, sanitizeRichTextHtml } from '../core/editor/render-rich-text';

/** RichTextPreview 参数 */
export interface RichTextPreviewProps {
  /** 富文本 HTML */
  html: string;
  /** 额外的 class */
  className?: string;
  /**
   * **是否显示为纯文本**（不解析标签）。
   *
   * → 用于 `aria-label` / `title` 这类纯文本场景 ✅
   */
  plain?: boolean;
}

/**
 * 富文本只读展示。
 *
 * @param props 参数
 */
export function RichTextPreview(props: RichTextPreviewProps) {
  const { html, className, plain = false } = props;

  /** 消毒后的 HTML */
  const safe = useMemo(() => sanitizeRichTextHtml(html ?? ''), [html]);

  /** 纯文本（给读屏 / title 用） */
  const text = useMemo(() => richTextToPlainText(html ?? ''), [html]);

  if (plain) {
    return <span className={className}>{text}</span>;
  }

  /*
   * ⚠️ **用 `dangerouslySetInnerHTML`**。
   *
   * → 只有这样才能"把 HTML 翻译成排版"（用户需求）✅
   * → 但内容**已经消毒过**（白名单 + 去掉事件属性 + 检查链接协议）✅
   *
   * biome 的 `noDangerouslySetInnerHtml` 规则一刀切地禁用 → 这里**有意**使用：
   * → 内容来自**宿主自己的批注数据**（不是任意的外部输入）
   * → 且**渲染前必过 `sanitizeRichTextHtml`**（白名单）
   */
  return (
    <span
      className={className}
      data-scpdf-rich-text="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 内容已消毒（白名单）
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
