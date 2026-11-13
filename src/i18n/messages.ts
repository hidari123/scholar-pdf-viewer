/**
 * i18n —— 内置 zh/en 文案，宿主可覆盖。
 *
 * 为什么包内自带文案：包是"开箱即用"的阅读器，空状态/加载中/密码框这些
 * 基础文案必须有（宿主可以覆盖，但不该被迫提供）。
 */

export type Locale = 'zh' | 'en';

/** 文案 key 清单 */
export interface Messages {
  'load.loading': string;
  'load.retry': string;
  'load.failed': string;
  'load.progress': string;
  'empty.title': string;
  'empty.hint': string;
  'error.generic': string;
  'password.title': string;
  'password.placeholder': string;
  'password.submit': string;
  'password.cancel': string;
  'password.wrong': string;
  'page.of': string;
  'zoom.in': string;
  'zoom.out': string;
  'zoom.fitWidth': string;
  'zoom.fitPage': string;
  'zoom.reset': string;
  'search.placeholder': string;
  'search.none': string;
  'search.count': string;
  'search.prev': string;
  'search.next': string;
  'search.close': string;
  'outline.title': string;
  'thumbnails.title': string;
  'print.title': string;
  'a11y.canvas': string;
  'a11y.page': string;
}

/** 中文文案（默认） */
export const ZH_MESSAGES: Messages = {
  'load.loading': '正在加载文档…',
  'load.retry': '重试',
  'load.failed': '加载失败',
  'load.progress': '已加载 {percent}%',
  'empty.title': '未指定文档',
  'empty.hint': '请通过 file 属性传入 PDF 地址或文件',
  'error.generic': '出错了',
  'password.title': '该文档已加密',
  'password.placeholder': '请输入密码',
  'password.submit': '确定',
  'password.cancel': '取消',
  'password.wrong': '密码错误，请重试',
  'page.of': '第 {page} / {total} 页',
  'zoom.in': '放大',
  'zoom.out': '缩小',
  'zoom.fitWidth': '适应宽度',
  'zoom.fitPage': '适合页面',
  'zoom.reset': '重置缩放',
  'search.placeholder': '搜索文档',
  'search.none': '未找到匹配内容',
  'search.count': '{count} 个结果',
  'search.prev': '上一个',
  'search.next': '下一个',
  'search.close': '关闭',
  'outline.title': '目录',
  'thumbnails.title': '缩略图',
  'print.title': '打印',
  'a11y.canvas': 'PDF 页面',
  'a11y.page': '第 {page} 页',
};

/** 英文文案 */
export const EN_MESSAGES: Messages = {
  'load.loading': 'Loading document…',
  'load.retry': 'Retry',
  'load.failed': 'Failed to load',
  'load.progress': 'Loaded {percent}%',
  'empty.title': 'No document',
  'empty.hint': 'Pass a PDF URL or file via the file prop',
  'error.generic': 'Something went wrong',
  'password.title': 'This document is encrypted',
  'password.placeholder': 'Enter password',
  'password.submit': 'OK',
  'password.cancel': 'Cancel',
  'password.wrong': 'Wrong password, try again',
  'page.of': 'Page {page} of {total}',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.fitWidth': 'Fit width',
  'zoom.fitPage': 'Fit page',
  'zoom.reset': 'Reset zoom',
  'search.placeholder': 'Search document',
  'search.none': 'No matches',
  'search.count': '{count} results',
  'search.prev': 'Previous',
  'search.next': 'Next',
  'search.close': 'Close',
  'outline.title': 'Outline',
  'thumbnails.title': 'Thumbnails',
  'print.title': 'Print',
  'a11y.canvas': 'PDF page',
  'a11y.page': 'Page {page}',
};

/** 内置文案表 */
export const MESSAGES: Record<Locale, Messages> = {
  zh: ZH_MESSAGES,
  en: EN_MESSAGES,
};

/** 解析文案（支持 {占位符} 替换） */
export function resolveMessage(
  locale: Locale,
  key: keyof Messages,
  overrides?: Partial<Messages>,
  vars?: Record<string, string | number>,
): string {
  const template = overrides?.[key] ?? MESSAGES[locale][key] ?? key;

  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
