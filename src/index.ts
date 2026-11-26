/*
 * @Author: hidari
 * @Date: 2026-10-29 16:49:56
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 14:38:03
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */
/**
 * @scholar-space/pdf-viewer —— 主入口
 *
 * 导出的东西分两类：
 * - 组件与 hooks（React 层）
 * - 公共类型（core 层，零 React）
 *
 * 零 React 的用法（Node / Worker / SSR）：
 *   import type { SelectionData } from '@scholar-space/pdf-viewer/core';
 */

export * from './components';
/* ---------- 批注（小便签 + 分组） ---------- */
export type {
  Annotation,
  AnnotationAnchor,
  AnnotationGroup,
} from './core/annotation/annotation-groups';
export {
  ANNOTATION_GROUP_TOLERANCE,
  groupAnnotations,
  horizontalGap,
  isSameRow,
  unionAnchor,
  verticalOverlap,
} from './core/annotation/annotation-groups';
export type { AnnotationRecord } from './core/annotation/sticky-note';
export {
  STICKY_NOTE_OFFSET,
  STICKY_NOTE_SIZE,
  stickyNotePosition,
} from './core/annotation/sticky-note';
/* ---------- 统一配置（"万物可配置"） ---------- */
export type { Features, PdfViewerConfig } from './core/config';
export { mergeConfig, resolveConfigValue } from './core/config';
export {
  /**
   * **包内置的高亮色板**（宿主不传也能用）。
   *
   * -> 用户需求："高亮色…是包需要内置的 但是有接口宿主可以配置"
   */
  BUILTIN_HIGHLIGHT_PALETTE,
  /**
   * **包内置的扩展语言表**（ja / fr）。
   *
   * -> 宿主不用再写一整套文案表
   */
  BUILTIN_LOCALES,
  /**
   * **按浏览器语言推断默认语言**。
   */
  detectDefaultLocale,
  /**
   * **合并语言表**（宿主覆盖内置）。
   */
  mergeLocales,
} from './core/config/builtin-defaults';
/* ---------- 下载（纯 DOM，无网络依赖） ---------- */
export { downloadFile } from './core/document/download';
/* ---------- 富文本（零依赖，工具栏宿主可配） ---------- */
export type {
  RichTextCommand,
  RichTextPalette,
  RichTextToolbarItem,
} from './core/editor/rich-text';
export {
  defaultRichTextToolbar,
  execRichTextCommand,
  richTextToPlain,
  sanitizeRichText,
} from './core/editor/rich-text';
export type { PdfViewerError, PdfViewerErrorCode } from './core/errors';
export { isRetryable, pdfViewerError } from './core/errors';
export type {
  ExportHighlightedPdfOptions,
  ExportHighlightLike,
  PageSizePt,
} from './core/export/export-pdf';
/*
 * ---------- 导出带高亮的 PDF ----------
 *
 * ⚠️ **pdf-lib 是"可选依赖"**（optional peerDependency）
 * → 不用导出的宿主：不用装（那段代码不会被打包进去）
 * → 用导出的宿主：`npm i pdf-lib`
 */
export { colorToRgb, exportHighlightedPdf } from './core/export/export-pdf';
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
/* ---------- 图标（内置图标集，宿主可覆盖） ---------- */
export type {
  IconCircle,
  IconLine,
  IconName,
  IconPolyline,
  IconRect,
  IconShape,
} from './core/icons/icons';
/*
 * ⚠️ **几何数据不在主入口导出**（实测踩过的坑：体积超预算）。
 *
 * → 45 个图标的几何数据约 5 kB（brotli 后）
 * → 静态导出 → 主入口 27 kB → 超了 25 kB 的预算 ❌
 * → 改成**独立入口**：import { getIconShape } from '@scholar-space/pdf-viewer/icons'
 * → 主入口只在**真正渲染内置图标时**动态加载
 */
export type { OutlineItemLike } from './core/outline/outline';
export type { PaperSize, PrintMargin } from './core/print';
/* ---------- 打印 ---------- */
export {
  computePrintPageSize,
  computePrintScale,
  computePrintScaleForRender,
  DEFAULT_PRINT_MARGIN,
  MM_TO_PX,
  PAPER_SIZES,
} from './core/print';
export type {
  SearchHit,
  SearchOptions,
  TextPageLike,
} from './core/search/search';
export { PdfSearch } from './core/search/search';
/* ---------- 选区动作（宿主可配置） ----------*/
export type {
  SelectionAction,
  SelectionActionContext,
  SelectionActionIcon,
} from './core/selection/actions';
export { BUILTIN_ACTION_KEYS, mergeSelectionActions } from './core/selection/actions';
export type {
  PdfViewerAppearance,
  PdfViewerChrome,
  PdfViewerDensity,
  PdfViewerSlots,
  PdfViewerTheme,
} from './core/theme';
/* ---------- 主题与外观 ---------- */
export {
  appearanceStyles,
  THEME_LABELS,
  THEME_LABELS_I18N,
  THEMES,
  themeClasses,
  themeLabel,
} from './core/theme';
export type * from './core/types';
export * from './hooks';
/* ---------- i18n（宿主可通过 JSON 添加语言） ---------- */
export type {
  BuiltinLocale,
  Locale,
  LocaleMessages,
  LocaleTable,
  MessageKey,
  Messages,
} from './i18n/messages';
export {
  buildLocaleTable,
  EN_MESSAGES,
  isLocaleSupported,
  MESSAGES,
  resolveMessage,
  ZH_MESSAGES,
} from './i18n/messages';

export const VERSION = '0.1.0';
