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
/* ---------- 下载（纯 DOM，无网络依赖） ---------- */
export { downloadFile } from './core/document/download';
export type { PdfViewerError, PdfViewerErrorCode } from './core/errors';
export { isRetryable, pdfViewerError } from './core/errors';
export type { PdfAnnot, PdfBbox } from './core/highlight/annotations';
export {
  highlightsToPdfAnnots,
  highlightToPdfAnnots,
} from './core/highlight/annotations';
export type { HighlightDoc } from './core/highlight/serialize';
/*
 * ---------- 高亮的序列化 / PDF 批注（宿主侧的高层工具） ----------
 *
 * ⚠️ **包只给"格式 + 纯函数"，不碰存储** →
 *    宿主自己决定存哪（localStorage / IndexedDB / 接口）→ **换后端不用改包**。
 */
export {
  exportHighlights,
  HIGHLIGHT_DOC_VERSION,
  importHighlights,
  parseHighlightDoc,
  stringifyHighlightDoc,
} from './core/highlight/serialize';
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
