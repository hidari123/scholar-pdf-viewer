/*
 * @Author: hidari
 * @Date: 2026-10-29 16:49:56
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 14:38:03
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
/**
 * @scholar-club/pdf-viewer —— 主入口
 *
 * 导出的东西分两类：
 * - 组件与 hooks（React 层）
 * - 公共类型（core 层，零 React）
 *
 * 零 React 的用法（Node / Worker / SSR）：
 *   import type { SelectionData } from '@scholar-club/pdf-viewer/core';
 */

export * from './components';
export type { PdfViewerError, PdfViewerErrorCode } from './core/errors';
export { isRetryable, pdfViewerError } from './core/errors';
export type { OutlineItemLike } from './core/outline/outline';
export type {
  SearchHit,
  SearchOptions,
  TextPageLike,
} from './core/search/search';
export { PdfSearch } from './core/search/search';
export type * from './core/types';
export * from './hooks';
export type { Locale, Messages } from './i18n/messages';
export { EN_MESSAGES, MESSAGES, ZH_MESSAGES } from './i18n/messages';

export const VERSION = '0.1.0';
