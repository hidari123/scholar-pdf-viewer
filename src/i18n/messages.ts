/**
 * i18n —— 内置 zh/en 文案，宿主可**添加任意语言**。
 *
 * ## 用户的诉求
 *
 * "页面要支持多种语言，先配置中英文，这个可以宿主通过固定json进行添加 要给出接口"
 *
 * → **中英文内置**（开箱即用）
 * → **宿主能通过 JSON 添加语言**（比如日文、韩文、法文…）
 * → **要有明确的接口**（不是"你随便改源码"）
 *
 * ## 三层文案（优先级从高到低）
 *
 * ```
 * ① messages  prop   —— 单个 locale 的覆盖（最细粒度）
 * ② locales  prop    —— 宿主注册的语言表（JSON）
 * ③ 内置 MESSAGES     —— zh / en 的内置文案
 * ```
 *
 * → **缺哪条就回退到下一层** → 宿主只写自己关心的文案即可 ✅
 *
 * ## 宿主的用法
 *
 * ```tsx
 * // ① 注册一个语言（JSON）
 * const ja = {
 *   'load.loading': 'ドキュメントを読み込み中…',
 *   'page.of': '{page} / {total} ページ',
 *   // …不写全也行，缺的会回退到内置英文
 * };
 *
 * <PdfViewer locale="ja" locales={{ ja }} />
 * ```
 *
 * ⚠️ **只提供文案，不碰业务** → 包不知道"翻译"是干什么的（那是宿主的事）。
 */

/** 内置语言 */
export type BuiltinLocale = 'zh' | 'en';

/**
 * 语言标识（**可以是任意字符串**）。
 *
 * ⚠️ 之前是 `'zh' | 'en'` 的固定联合类型 → 宿主加语言要改源码 ❌
 * → 现在放宽成 `string` → 宿主传 `'ja'` / `'ko-FR'` 都行 ✅
 */
export type Locale = BuiltinLocale | (string & {});

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
  /*
   * —— 工具栏 / 浮层 ——
   *
   * ⚠️ **这些之前是硬编码的中文**（用户反馈："语言切换了 但是切换之后
   *    实际上 title 啊什么东西都没切换语言呢"）→ 全部收进文案表 ✅
   */
  'page.prev': string;
  'page.next': string;
  'selection.actions': string;
  'selection.color': string;
  'selection.expandColor': string;
  /* —— 批注面板 / 富文本 —— */
  'annotation.title': string;
  'annotation.delete': string;
  'annotation.close': string;
  'annotation.content': string;
  'annotation.save': string;
  'annotation.cancel': string;
  'annotation.placeholder': string;
  'annotation.pick': string;
  'annotation.new': string;
  'toast.region': string;
  'richtext.linkPrompt': string;
  'highlight.fullyCovered': string;
  'toast.close': string;
  'toast.copied': string;
  'toast.copyFailed': string;
  'toast.exportSuccess': string;
  'toast.exportFailed': string;
  'selection.addNote': string;
  /* —— 富文本工具栏 —— */
  'richtext.bold': string;
  'richtext.italic': string;
  'richtext.underline': string;
  'richtext.highlight': string;
  'richtext.textColor': string;
  'richtext.link': string;
  'richtext.orderedList': string;
  'richtext.unorderedList': string;
  'richtext.quote': string;
  'richtext.clearFormat': string;
  'richtext.undo': string;
  'richtext.redo': string;
}

/** 文案 key（字符串联合） */
export type MessageKey = keyof Messages;

/**
 * **宿主的语言表**（locale → 文案）。
 *
 * ⚠️ **必须是"部分"的** —— 宿主只想写自己关心的文案，
 *    缺的会自动回退到内置文案 ✅
 */
export type LocaleMessages = Partial<Messages>;

/**
 * **语言表**（宿主注册的所有语言）。
 *
 * ```ts
 * const locales = {
 *   ja: { 'load.loading': '…', 'page.of': '…' },
 *   ko: { 'load.loading': '…' },
 * };
 * ```
 */
export type LocaleTable = Record<string, LocaleMessages>;

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
  'page.prev': '上一页',
  'page.next': '下一页',
  'selection.actions': '选区操作',
  'selection.color': '选择颜色',
  'selection.expandColor': '展开颜色下拉',
  'annotation.title': '批注',
  'annotation.delete': '删除',
  'annotation.close': '关闭',
  'annotation.content': '批注内容',
  'annotation.save': '保存',
  'annotation.cancel': '取消',
  'annotation.placeholder': '写点什么…',
  'annotation.pick': '选择批注（{count}）',
  'annotation.new': '新建批注',
  'toast.region': '通知',
  'richtext.linkPrompt': '链接地址',
  'highlight.fullyCovered': '这段已经被高亮了',
  'toast.close': '关闭',
  'toast.copied': '已复制到剪贴板',
  'toast.copyFailed': '复制失败，请手动复制',
  'toast.exportSuccess': '导出成功',
  'toast.exportFailed': '导出失败',
  'selection.addNote': '加批注',
  'richtext.bold': '加粗',
  'richtext.italic': '斜体',
  'richtext.underline': '下划线',
  'richtext.highlight': '高亮',
  'richtext.textColor': '文字颜色',
  'richtext.link': '链接',
  'richtext.orderedList': '有序列表',
  'richtext.unorderedList': '无序列表',
  'richtext.quote': '引用',
  'richtext.clearFormat': '清除格式',
  'richtext.undo': '撤销',
  'richtext.redo': '重做',
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
  'page.prev': 'Previous page',
  'page.next': 'Next page',
  'selection.actions': 'Selection actions',
  'selection.color': 'Select color',
  'selection.expandColor': 'Expand color dropdown',
  'annotation.title': 'Annotation',
  'annotation.delete': 'Delete',
  'annotation.close': 'Close',
  'annotation.content': 'Annotation content',
  'annotation.save': 'Save',
  'annotation.cancel': 'Cancel',
  'annotation.placeholder': 'Write something…',
  'annotation.pick': 'Select annotation ({count})',
  'annotation.new': 'New annotation',
  'toast.region': 'Notifications',
  'richtext.linkPrompt': 'Link URL',
  'highlight.fullyCovered': 'This text is already highlighted',
  'toast.close': 'Close',
  'toast.copied': 'Copied to clipboard',
  'toast.copyFailed': 'Copy failed, please copy manually',
  'toast.exportSuccess': 'Exported successfully',
  'toast.exportFailed': 'Export failed',
  'selection.addNote': 'Add note',
  'richtext.bold': 'Bold',
  'richtext.italic': 'Italic',
  'richtext.underline': 'Underline',
  'richtext.highlight': 'Highlight',
  'richtext.textColor': 'Text color',
  'richtext.link': 'Link',
  'richtext.orderedList': 'Ordered list',
  'richtext.unorderedList': 'Unordered list',
  'richtext.quote': 'Quote',
  'richtext.clearFormat': 'Clear formatting',
  'richtext.undo': 'Undo',
  'richtext.redo': 'Redo',
};

/** 内置文案表 */
export const MESSAGES: Record<BuiltinLocale, Messages> = {
  zh: ZH_MESSAGES,
  en: EN_MESSAGES,
};

/**
 * 解析文案（支持 {占位符} 替换）。
 *
 * ## 回退链
 *
 * ```
 * ① overrides[key]                     —— 当前 locale 的覆盖（messages prop）
 * ② locales[locale][key]              —— 宿主注册的语言表
 * ③ MESSAGES[locale][key]              —— 内置（zh / en）
 * ④ MESSAGES.en[key]                   —— 内置英文（宿主语言没写全时的兜底）
 * ⑤ key 本身                            —— 最后兜底（不会返回 undefined）
 * ```
 *
 * ⚠️ **为什么最后兜底到英文而不是中文**：
 * → 一个没配置全的语言，用中文兜底会"中英混杂"，更糟
 * → 用英文兜底至少是**一致的一种语言** ✅
 *
 * @param locale 语言（可以是宿主的任意语言）
 * @param key 文案 key
 * @param overrides 当前 locale 的覆盖
 * @param vars 占位符变量
 * @param locales 宿主注册的语言表
 * @returns 文案
 */
export function resolveMessage(
  locale: Locale,
  key: MessageKey,
  overrides?: LocaleMessages,
  vars?: Record<string, string | number>,
  locales?: LocaleTable,
): string {
  const template =
    overrides?.[key] ??
    locales?.[locale]?.[key] ??
    MESSAGES[locale as BuiltinLocale]?.[key] ??
    MESSAGES.en[key] ??
    key;

  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * **注册语言表**（把宿主的 JSON 和内置语言合并）。
 *
 * ⚠️ **这是一个纯函数** → 宿主可以在运行时动态切换语言表。
 *
 * @param locales 宿主注册的语言表
 * @returns 合并后的语言表（内置 + 宿主）
 */
export function buildLocaleTable(locales?: LocaleTable): LocaleTable {
  return { ...MESSAGES, ...(locales ?? {}) };
}

/**
 * **判断某个语言是否可用**。
 *
 * @param locale 语言
 * @param locales 宿主注册的语言表
 * @returns 可用则 true
 */
export function isLocaleSupported(locale: Locale, locales?: LocaleTable): boolean {
  if (locale in MESSAGES) {
    return true;
  }
  return !!locales && locale in locales;
}
