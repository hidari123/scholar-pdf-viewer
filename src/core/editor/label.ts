/**
 * editor —— **工具栏文案的 i18n 解析**。
 *
 * ## 为什么抽出来
 *
 * → 包内置的编辑器（`RichTextEditor`）和 TipTap 版（`TipTapEditor`）
 *   都要解析 `{richtext.bold}` 这种占位符
 * → 之前各写一份 → 容易不一致 ❌
 * → 抽出来 → 两边行为**完全一致** ✅
 */

import type { Locale, LocaleTable, Messages } from '../../i18n/messages';
import { resolveMessage } from '../../i18n/messages';

/**
 * **解析工具栏项的文案**。
 *
 * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
 * → 工具栏的 label 之前是**硬编码中文** → 现在走文案表 ✅
 *
 * @param label 原始 label（可能是 `{richtext.bold}`）
 * @param locale 语言
 * @param messages 文案覆盖
 * @param locales 宿主注册的语言表
 * @param vars 变量
 * @returns 最终文案
 */
export function resolveToolbarLabel(
  label: string,
  locale: Locale,
  messages?: Partial<Messages>,
  locales?: LocaleTable,
  vars?: Record<string, string | number>,
): string {
  const match = /^\{(.+)\}$/.exec(label);
  if (!match) {
    return label;
  }
  const key = match[1] as keyof Messages;
  return resolveMessage(locale, key, messages, vars, locales);
}
