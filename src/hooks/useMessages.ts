/**
 * useMessages —— 统一的文案解析（i18n）。
 *
 * ## 为什么做成 hook
 *
 * → 各组件都要"取文案" → 逻辑要**一致**（回退链一样）
 * → 放在 hook 里 → 组件只管 `t('search.placeholder')`
 *
 * ## 回退链
 *
 * ```
 * ① messages[key]         —— 当前 locale 的覆盖
 * ② locales[locale][key]  —— 宿主注册的语言表
 * ③ 内置 MESSAGES[locale]  —— zh / en
 * ④ 内置 MESSAGES.en       —— 兜底（保持一种语言一致）
 * ```
 */

import { useCallback, useMemo } from 'react';
import type { Locale, LocaleMessages, LocaleTable, MessageKey } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** useMessages 参数 */
export interface UseMessagesOptions {
  /** 语言 */
  locale?: Locale;
  /** 当前 locale 的文案覆盖 */
  messages?: LocaleMessages;
  /** 宿主注册的语言表（可添加任意语言） */
  locales?: LocaleTable;
}

/** useMessages 返回值 */
export interface UseMessagesResult {
  /**
   * 取文案。
   *
   * @param key 文案 key
   * @param vars 占位符变量（如 `{ page }`）
   * @returns 文案
   */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

/**
 * 文案解析 hook。
 *
 * @param options 参数
 * @returns `t` 函数
 */
export function useMessages(options: UseMessagesOptions = {}): UseMessagesResult {
  const { locale = 'zh', messages, locales } = options;

  /*
   * ⚠️ **必须 `useMemo`**（React 规则）。
   *
   * → `t` 会被放进 `useEffect` / `useMemo` 的依赖数组
   * → 每次渲染都新建函数 → 依赖永远变 → **effect 每次都重跑**
   * → （实测踩过的坑：搜索面板反复重搜）
   */
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars, locales),
    [locale, messages, locales],
  );

  return useMemo(() => ({ t }), [t]);
}
