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
 * → **缺哪条就回退到下一层** → 宿主只写自己关心的文案即可
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
 * → 现在放宽成 `string` → 宿主传 `'ja'` / `'ko-FR'` 都行
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
  'error.E_LOAD_HTTP': string;
  'error.E_LOAD_NETWORK': string;
  'error.E_LOAD_TIMEOUT': string;
  'error.E_PDF_INVALID': string;
  'error.E_EMPTY': string;
  'error.E_PDF_ENCRYPTED': string;
  'error.E_PDF_PASSWORD_WRONG': string;
  'error.E_RENDER_PAGE': string;
  'error.E_FONT_MISSING': string;
  'error.E_CACHE_QUOTA': string;
  'error.E_CACHE_UNAVAILABLE': string;
  'error.E_LINK_INVALID': string;
  'password.title': string;
  'password.placeholder': string;
  'password.submit': string;
  'password.cancel': string;
  'password.wrong': string;
  'page.of': string;
  'zoom.in': string;
  'zoom.out': string;
  /** 缩放比例（可填写） */
  'zoom.scale': string;
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
  /** 下载原 PDF*/
  'export.downloadPdf': string;
  /** 导出带高亮的 PDF*/
  'export.annotatedPdf': string;
  /** 导出高亮 JSON*/
  'export.highlightsJson': string;
  /** 清除全部高亮 */
  'export.clearHighlights': string;
  /** 导入高亮 */
  'export.importHighlights': string;
  /* —— 主题 —— */
  /** 主题选择按钮 */
  'theme.picker': string;
  /** 当前主题（勾选标记） */
  'theme.current': string;
  'a11y.canvas': string;
  'a11y.page': string;
  /*
   * —— 工具栏 / 浮层 ——
   *
   * ⚠️ **这些之前是硬编码的中文**（用户反馈："语言切换了 但是切换之后
   *    实际上 title 啊什么东西都没切换语言呢"）→ 全部收进文案表
   */
  'page.prev': string;
  'page.next': string;
  'selection.actions': string;
  'selection.color': string;
  'selection.expandColor': string;
  /* —— 批注面板 / 富文本 —— */
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
  'richtext.linkHref': string;
  'richtext.linkText': string;
  'richtext.linkConfirm': string;
  'richtext.linkCancel': string;
  'richtext.linkHrefPlaceholder': string;
  'richtext.linkTextPlaceholder': string;
  'highlight.fullyCovered': string;
  /*
   * ⚠️ **高亮浮层的 5 个按钮**（审计发现的：之前**硬编码中文**）。
   *
   * -> 之前在 \`core/selection/highlight-actions.ts\` 里写死 ❌
   *   -> 高亮浮层（点高亮块）**永远是中文** ❌
   *   -> 选区浮层（选中文字）走 i18n -> 英文
   *   -> **两个浮层并排 -> "中英文混杂"**
   */
  /*
   * ⚠️ **内部链接跳转**（审计修复：之前解析不出来时**什么都不做** -> 点了没反应）。
   */
  'link.unresolved': string;
  /**
   * ⚠️ **目录页码解析不出来时的提示**（之前是**静默无反应**）。
   */
  'outline.unresolvedHint': string;
  'link.jumped': string;
  'highlight.actionComment': string;
  'highlight.actionColor': string;
  'highlight.actionCopy': string;
  'highlight.actionRemove': string;
  'highlight.actionMore': string;
  'toast.close': string;
  'toast.copied': string;
  'toast.copyFailed': string;
  'toast.exportSuccess': string;
  'toast.exportFailed': string;
  'selection.addNote': string;
  'selection.actionHighlight': string;
  /** 没有选区时的提示（点工具栏的高亮按钮） */
  'selection.selectFirst': string;
  'selection.actionCopy': string;
  'selection.actionTranslate': string;
  'selection.actionAsk': string;
  'selection.actionExplain': string;
  'annotation.title': string;
  'annotation.withContent': string;
  'annotation.selectGroup': string;
  'annotation.edit': string;
  /** 完成编辑（便签详情的"编辑"按钮切换后） */
  'annotation.done': string;
  'annotation.expand': string;
  'annotation.empty': string;
  'link.internal': string;
  'selection.highlightColor': string;
  /**
   * **高亮色的本地化名字**（色块的 tooltip / aria-label）。
   *
   * ⚠️ **为什么不能直接用色值**（实测踩到的坑，用户反馈：
   * "选区的工具栏里面的中英文title还是会变来变去的
   *  有时候hover上去 title显示中文 有时候英文"）：
   *
   * -> 之前色块的 `title` 直接写**原始色值**（`#ffd54a`）❌
   * -> 界面是中文也显示 `#ffd54a`，英文还是 `#ffd54a` ❌
   * -> -> **和界面语言完全脱节** ❌
   * -> -> 用户的体感就是"title 变来变去"
   *
   * -> 现在按 key 查本地化名字  （`yellow` -> 黄色 / Yellow / イエロー）
   * -> 宿主自定义的 key 查不到 -> **退回 key 本身**  （不用猜）
   */
  'selection.highlightColorName': string;
  /* —— 富文本工具栏 —— */
  'richtext.bold': string;
  'richtext.italic': string;
  'richtext.underline': string;
  'richtext.strikeThrough': string;
  'richtext.highlight': string;
  /** 文字高亮（背景色，字色不变） */
  'richtext.textHighlight': string;
  /** "无背景色"（色板第一个斜杠色块） */
  'richtext.noColor': string;
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
 *    缺的会自动回退到内置文案
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

/**
 * **按语言绑定的文案覆盖表**（`messages` prop 的形状）。
 *
 * ⚠️⚠️ **之前 `messages` 是"不绑语言"的**（审计发现的**真 bug**）：
 *
 * ```tsx
 * // ❌ 之前：这些句子在【任何语言】下都生效
 * <PdfViewer locale="en" messages={{ 'search.placeholder': '全文检索' }} />
 * //   -> 切到 en 还是"全文检索"（中文）❌
 * ```
 *
 * -> 宿主切语言 -> **被覆盖的 key 还是中文** -> **中英文混杂** ❌
 *
 * ⚠️ **现在按语言绑定**（和 `LocaleTable` 同一个形状）：
 *
 * ```tsx
 * <PdfViewer
 *   locale="en"
 *   messages={{ en: { 'search.placeholder': 'Full-text search' } }}
 * />
 * ```
 */
export type LocaleMessagesMap = Record<string, LocaleMessages>;

/** 中文文案（默认） */
export const ZH_MESSAGES: Messages = {
  'load.loading': '正在加载文档…',
  'load.retry': '重试',
  'load.failed': '加载失败',
  'load.progress': '已加载 {percent}%',
  'empty.title': '未指定文档',
  'empty.hint': '请通过 file 属性传入 PDF 地址或文件',
  'error.generic': '出错了',
  'error.E_LOAD_HTTP': '加载失败（HTTP {status}）',
  'error.E_LOAD_NETWORK': '网络错误，加载失败',
  'error.E_LOAD_TIMEOUT': '加载超时',
  'error.E_PDF_INVALID': '文件不是有效的 PDF',
  'error.E_EMPTY': '没有指定文档',
  'error.E_PDF_ENCRYPTED': '文档已加密',
  'error.E_PDF_PASSWORD_WRONG': '密码不正确',
  'error.E_RENDER_PAGE': '页面渲染失败',
  'error.E_FONT_MISSING': '缺少字体',
  'error.E_CACHE_QUOTA': '缓存空间不足',
  'error.E_CACHE_UNAVAILABLE': '缓存不可用',
  'error.E_LINK_INVALID': '链接无效',
  'password.title': '该文档已加密',
  'password.placeholder': '请输入密码',
  'password.submit': '确定',
  'password.cancel': '取消',
  'password.wrong': '密码错误，请重试',
  'page.of': '第 {page} / {total} 页',
  'zoom.in': '放大',
  'zoom.out': '缩小',
  'zoom.scale': '缩放比例',
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
  'export.downloadPdf': '下载 PDF',
  'export.annotatedPdf': '导出带高亮的 PDF',
  'export.highlightsJson': '导出高亮',
  'export.clearHighlights': '清除全部高亮',
  'export.importHighlights': '导入高亮',
  'theme.picker': '主题',
  'theme.current': '当前主题',
  'a11y.canvas': 'PDF 页面',
  'a11y.page': '第 {page} 页',
  'page.prev': '上一页',
  'page.next': '下一页',
  'selection.actions': '选区操作',
  'selection.color': '选择颜色',
  'selection.expandColor': '展开颜色下拉',
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
  'richtext.linkHref': '链接',
  'richtext.linkText': '显示文字',
  'richtext.linkConfirm': '确定',
  'richtext.linkCancel': '取消',
  'richtext.linkHrefPlaceholder': '粘贴或输入链接',
  'richtext.linkTextPlaceholder': '默认显示链接地址',
  'highlight.fullyCovered': '这段已经被高亮了',
  'link.unresolved': '这个链接无法跳转（文档缺少页码映射）',
  'outline.unresolvedHint': '无法定位页码：请提供 resolvePageRef 或 pageRefToNumber',
  'link.jumped': '已跳转到第 {page} 页',
  'highlight.actionComment': '批注',
  'highlight.actionColor': '颜色',
  'highlight.actionCopy': '复制',
  'highlight.actionRemove': '删除',
  'highlight.actionMore': '更多',
  'toast.close': '关闭',
  'toast.copied': '已复制到剪贴板',
  'toast.copyFailed': '复制失败，请手动复制',
  'toast.exportSuccess': '导出成功',
  'toast.exportFailed': '导出失败',
  'selection.addNote': '加批注',
  'selection.actionHighlight': '高亮',
  'selection.selectFirst': '请先选中文字',
  'selection.actionCopy': '复制',
  'selection.actionTranslate': '翻译',
  'selection.actionAsk': '提问',
  'selection.actionExplain': '解释',
  'annotation.title': '批注',
  'annotation.withContent': '批注：{content}',
  'annotation.selectGroup': '选择批注（{count}）',
  'annotation.edit': '编辑批注',
  'annotation.done': '完成',
  'annotation.expand': '展开批注',
  'annotation.empty': '（空批注）',
  'link.internal': '内部链接',
  'selection.highlightColor': '高亮色 {name}',
  'selection.highlightColorName': '高亮色 {name}',
  'richtext.bold': '加粗',
  'richtext.italic': '斜体',
  'richtext.underline': '下划线',
  'richtext.strikeThrough': '删除线',
  'richtext.highlight': '高亮',
  'richtext.textHighlight': '文字高亮',
  'richtext.noColor': '无背景色',
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
  'error.E_LOAD_HTTP': 'Failed to load (HTTP {status})',
  'error.E_LOAD_NETWORK': 'Network error while loading',
  'error.E_LOAD_TIMEOUT': 'Loading timed out',
  'error.E_PDF_INVALID': 'The file is not a valid PDF',
  'error.E_EMPTY': 'No document specified',
  'error.E_PDF_ENCRYPTED': 'This document is encrypted',
  'error.E_PDF_PASSWORD_WRONG': 'Incorrect password',
  'error.E_RENDER_PAGE': 'Failed to render the page',
  'error.E_FONT_MISSING': 'Missing font',
  'error.E_CACHE_QUOTA': 'Cache quota exceeded',
  'error.E_CACHE_UNAVAILABLE': 'Cache unavailable',
  'error.E_LINK_INVALID': 'Invalid link',
  'password.title': 'This document is encrypted',
  'password.placeholder': 'Enter password',
  'password.submit': 'OK',
  'password.cancel': 'Cancel',
  'password.wrong': 'Wrong password, try again',
  'page.of': 'Page {page} of {total}',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.scale': 'Zoom',
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
  'export.downloadPdf': 'Download PDF',
  'export.annotatedPdf': 'Export annotated PDF',
  'export.highlightsJson': 'Export highlights',
  'export.clearHighlights': 'Clear all highlights',
  'export.importHighlights': 'Import highlights',
  'theme.picker': 'Theme',
  'theme.current': 'Current theme',
  'a11y.canvas': 'PDF page',
  'a11y.page': 'Page {page}',
  'page.prev': 'Previous page',
  'page.next': 'Next page',
  'selection.actions': 'Selection actions',
  'selection.color': 'Select color',
  'selection.expandColor': 'Expand color dropdown',
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
  'richtext.linkHref': 'Link',
  'richtext.linkText': 'Display text',
  'richtext.linkConfirm': 'Confirm',
  'richtext.linkCancel': 'Cancel',
  'richtext.linkHrefPlaceholder': 'Paste or type a link',
  'richtext.linkTextPlaceholder': 'Defaults to the link URL',
  'highlight.fullyCovered': 'This text is already highlighted',
  'link.unresolved': 'This link cannot be resolved (the document has no page mapping)',
  'outline.unresolvedHint': 'Cannot locate pages: provide resolvePageRef or pageRefToNumber',
  'link.jumped': 'Jumped to page {page}',
  'highlight.actionComment': 'Comment',
  'highlight.actionColor': 'Color',
  'highlight.actionCopy': 'Copy',
  'highlight.actionRemove': 'Delete',
  'highlight.actionMore': 'More',
  'toast.close': 'Close',
  'toast.copied': 'Copied to clipboard',
  'toast.copyFailed': 'Copy failed, please copy manually',
  'toast.exportSuccess': 'Exported successfully',
  'toast.exportFailed': 'Export failed',
  'selection.addNote': 'Add note',
  'selection.actionHighlight': 'Highlight',
  'selection.selectFirst': 'Select text first',
  'selection.actionCopy': 'Copy',
  'selection.actionTranslate': 'Translate',
  'selection.actionAsk': 'Ask',
  'selection.actionExplain': 'Explain',
  'annotation.title': 'Annotation',
  'annotation.withContent': 'Annotation: {content}',
  'annotation.selectGroup': 'Select annotation ({count})',
  'annotation.edit': 'Edit annotation',
  'annotation.done': 'Done',
  'annotation.expand': 'Expand annotation',
  'annotation.empty': '(Empty annotation)',
  'link.internal': 'Internal link',
  'selection.highlightColor': 'Highlight color {name}',
  'selection.highlightColorName': 'Highlight color {name}',
  'richtext.bold': 'Bold',
  'richtext.italic': 'Italic',
  'richtext.underline': 'Underline',
  'richtext.strikeThrough': 'Strikethrough',
  'richtext.highlight': 'Highlight',
  'richtext.textHighlight': 'Text highlight',
  'richtext.noColor': 'No color',
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
 * ① overrides[locale][key]              —— 宿主按语言绑定的覆盖（messages prop）
 * ② locales[locale][key]               —— 宿主注册的语言表
 * ③ MESSAGES[locale][key]               —— 内置（zh / en / ja / fr）
 * ④ MESSAGES.en[key]                    —— 内置英文（宿主语言没写全时的兜底）
 * ⑤ key 本身                             —— 最后兜底（不会返回 undefined）
 * ```
 *
 * ⚠️ **为什么最后兜底到英文而不是中文**：
 * → 一个没配置全的语言，用中文兜底会"中英混杂"，更糟
 * → 用英文兜底至少是**一致的一种语言**
 *
 * ⚠️⚠️ **① 现在是"按语言"的**（审计发现的**真 bug**）：
 * -> 之前是 \`overrides?.[key]\`（**不带 locale 判断**）❌
 *   -> 实测：\`en + overrides\` 依然返回**中文** ❌
 *   -> 宿主切语言 -> **被覆盖的 key 还是中文** -> **中英文混杂** ❌
 * -> 现在：\`overrides?.[locale]?.[key]\`
 *
 * @param locale 语言（可以是宿主的任意语言）
 * @param key 文案 key
 * @param overrides 按语言绑定的覆盖
 * @param vars 占位符变量
 * @param locales 宿主注册的语言表
 * @returns 文案
 */
export function resolveMessage(
  locale: Locale,
  key: MessageKey,
  overrides?: LocaleMessagesMap,
  vars?: Record<string, string | number>,
  locales?: LocaleTable,
): string {
  /*
   * ⚠️ **`overrides` 和 `locales` 现在是同一个形状**（都是"按语言"）。
   *
   * -> `overrides`（messages prop）：宿主的**覆盖**
   * -> `locales`（locales prop）：宿主的**语言表**
   * -> 两个都是 `Record<locale, Partial<Messages>>`
   *
   * ⚠️ **为什么 `overrides` 优先**：
   * -> `messages` 是"更细粒度的覆盖" -> 优先级更高
   * -> （和之前的语义一致：覆盖 > 语言表 > 内置）
   *
   * ⚠️ **为什么 `locale` 在最前面查**：
   * -> 之前 `overrides?.[key]` **不绑语言**（审计发现的真 bug）❌
   * -> 现在 `overrides?.[locale]?.[key]`
   */
  const template =
    overrides?.[locale]?.[key] ??
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
