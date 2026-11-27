/**
 * demo 的 i18n —— **宿主侧的文案表**（演示"宿主怎么多语言"）。
 *
 * ## 为什么在 demo 里
 *
 * 用户反馈："切换语言还是没变啊 下拉框选择语言之后 发现页面上语言还是没换啊"
 *
 * → 排查发现：**包内的文案切换正常**（Toolbar / 目录 / 缩略图 / 翻页 / 缩放 … 都跟着变了）
 * → 但**demo 自己的按钮**（添加高亮 / 导出高亮 / 导入高亮 / 下载 PDF / 主题 / 语言 / 密度 …）
 *   是**硬编码中文** → 切语言时它们不变 → 用户看到"页面语言还是没换" ❌
 *
 * → **demo 是宿主** → 宿主自己的文案当然也要自己管 → 这正是这个文件存在的意义
 *
 * ## 和包的关系
 *
 * - **包**：只管自己的 UI 文案（`locale` / `locales` / `messages`）
 * - **宿主**：管自己的 UI 文案（本文件）
 *
 * → 两者**互不干扰**，各自完整 → 切语言时**整页**都跟着变
 */

/** demo 支持的语言 */
export type DemoLocale = 'zh' | 'en' | 'ja';

/** demo 的文案表 */
const DEMO_MESSAGES: Record<DemoLocale, Record<string, string>> = {
  zh: {
    'demo.theme': '主题：',
    'demo.locale': '语言：',
    'demo.density': '密度：',
    'demo.loadSample': '载入内置样张',
    'demo.loadLocal': '载入本地真实文档',
    'demo.clearHighlights': '清除高亮',
    'demo.printMode': '打印模式',
    'demo.printMode.original': '原 PDF（每页完整）',
    'demo.printMode.withHighlights': '带高亮（打印 DOM）',
    'demo.current': '当前：',
    'demo.page': '页',
    'demo.zoom': '缩放：',
    'demo.addHighlight': '添加高亮',
    'demo.exportJson': '导出高亮',
    'demo.exportPdf': '导出带高亮的 PDF',
    'demo.importJson': '导入高亮',
    'demo.downloadPdf': '下载 PDF',
    'demo.savedHighlight': '已添加高亮（宿主自存，包不碰后端）',
    'demo.savedNotes': '已加两条同一行的批注（看右上角是不是只有一个图标 + 角标）',
    'demo.savedNote': '已保存批注',
    'demo.deletedNote': '已删除批注',
    'demo.noDoc': '没有可导出的文档',
    'demo.exporting': '正在导出带高亮的 PDF…',
    'demo.exported': '已导出带高亮的 PDF（{count} 条高亮）',
    'demo.imported': '已导入 {count} 条高亮',
    'demo.importFailed': '导入失败：{reason}',
    'demo.needHighlight': '先添加一条高亮，再试这个',
    'demo.density.compact': '紧凑',
    'demo.density.cozy': '适中',
    'demo.density.comfortable': '宽松',
    'demo.color.yellow': '黄',
    'demo.color.green': '绿',
    'demo.color.blue': '蓝',
    'demo.color.pink': '粉',
    'demo.color.purple': '紫',
    'demo.color.orange': '橙',
    'demo.colorOf': '高亮色 {name}',
    'demo.customColor': '自定义 {color}',
    'demo.customColorName': '自定义高亮色 {color}',
    'demo.customColorTitle': '自定义颜色',
    'demo.pickCustomColor': '选择自定义高亮颜色',
    'demo.saveColor': '保存当前颜色',
    'demo.saveCustomColor': '保存自定义高亮颜色',
    'demo.useThisColor': '用此色',
    'demo.sidebar': '宿主侧栏（插槽）',
    'demo.loading': '加载中…',
    'demo.localeName.zh': '中文',
    'demo.localeName.en': 'English',
    'demo.localeName.ja': '日本語',
    'demo.rtl.ltr': 'LTR（从左往右）',
    'demo.rtl.rtl': 'RTL（从右往左）',
    'demo.aria.theme': '主题',
    'demo.aria.locale': '语言',
    'demo.aria.density': '密度',
    'demo.aria.dir': '文字方向',
  },
  en: {
    'demo.theme': 'Theme:',
    'demo.locale': 'Language:',
    'demo.density': 'Density:',
    'demo.loadSample': 'Load sample',
    'demo.loadLocal': 'Load local doc',
    'demo.clearHighlights': 'Clear highlights',
    'demo.printMode': 'Print mode',
    'demo.printMode.original': 'Original PDF (complete)',
    'demo.printMode.withHighlights': 'With highlights (DOM)',
    'demo.current': 'Current:',
    'demo.page': 'Page',
    'demo.zoom': 'Zoom:',
    'demo.addHighlight': 'Add highlight',
    'demo.exportJson': 'Export highlights',
    'demo.exportPdf': 'Export highlighted PDF',
    'demo.importJson': 'Import highlights',
    'demo.downloadPdf': 'Download PDF',
    'demo.savedHighlight': 'Highlight added (stored by host, package stays backend-agnostic)',
    'demo.savedNotes': 'Two same-line notes added (look for one icon + badge)',
    'demo.savedNote': 'Note saved',
    'demo.deletedNote': 'Note deleted',
    'demo.noDoc': 'Nothing to export',
    'demo.exporting': 'Exporting highlighted PDF…',
    'demo.exported': 'Exported highlighted PDF ({count} highlights)',
    'demo.imported': 'Imported {count} highlights',
    'demo.importFailed': 'Import failed: {reason}',
    'demo.needHighlight': 'Add a highlight first',
    'demo.density.compact': 'Compact',
    'demo.density.cozy': 'Cozy',
    'demo.density.comfortable': 'Comfortable',
    'demo.color.yellow': 'Yellow',
    'demo.color.green': 'Green',
    'demo.color.blue': 'Blue',
    'demo.color.pink': 'Pink',
    'demo.color.purple': 'Purple',
    'demo.color.orange': 'Orange',
    'demo.colorOf': 'Highlight {name}',
    'demo.customColor': 'Custom {color}',
    'demo.customColorName': 'Custom highlight {color}',
    'demo.customColorTitle': 'Custom color',
    'demo.pickCustomColor': 'Pick custom highlight color',
    'demo.saveColor': 'Save current color',
    'demo.saveCustomColor': 'Save custom highlight color',
    'demo.useThisColor': 'Use this color',
    'demo.sidebar': 'Host sidebar (slot)',
    'demo.loading': 'Loading…',
    'demo.localeName.zh': 'Chinese',
    'demo.localeName.en': 'English',
    'demo.localeName.ja': 'Japanese',
    'demo.rtl.ltr': 'LTR (left to right)',
    'demo.rtl.rtl': 'RTL (right to left)',
    'demo.aria.theme': 'Theme',
    'demo.aria.locale': 'Language',
    'demo.aria.density': 'Density',
    'demo.aria.dir': 'Text direction',
  },
  ja: {
    'demo.theme': 'テーマ：',
    'demo.locale': '言語：',
    'demo.density': '密度：',
    'demo.loadSample': 'サンプルを読み込む',
    'demo.loadLocal': 'ローカル文書を読む',
    'demo.current': '現在：',
    'demo.page': 'ページ',
    'demo.zoom': 'ズーム：',
    'demo.addHighlight': 'ハイライトを追加',
    'demo.exportJson': 'ハイライトを出力',
    'demo.exportPdf': 'ハイライト付きPDFを出力',
    'demo.importJson': 'ハイライトを読み込む',
    'demo.downloadPdf': 'PDFをダウンロード',
    'demo.savedHighlight': 'ハイライトを追加しました（保存はホスト側）',
    'demo.savedNotes': '同じ行に2つの注釈を追加しました（アイコン1つ + バッジ）',
    'demo.savedNote': '注釈を保存しました',
    'demo.deletedNote': '注釈を削除しました',
    'demo.noDoc': '出力するものがありません',
    'demo.exporting': 'ハイライト付きPDFを出力中…',
    'demo.exported': 'ハイライト付きPDFを出力しました（{count}件）',
    'demo.imported': '{count}件のハイライトを読み込みました',
    'demo.importFailed': '読み込みに失敗：{reason}',
    'demo.needHighlight': '先にハイライトを追加してください',
    'demo.density.compact': 'コンパクト',
    'demo.density.cozy': '標準',
    'demo.density.comfortable': 'ゆったり',
    'demo.color.yellow': '黄',
    'demo.color.green': '緑',
    'demo.color.blue': '青',
    'demo.color.pink': 'ピンク',
    'demo.color.purple': '紫',
    'demo.color.orange': 'オレンジ',
    'demo.colorOf': 'ハイライト {name}',
    'demo.customColor': 'カスタム {color}',
    'demo.customColorName': 'カスタムハイライト {color}',
    'demo.customColorTitle': 'カスタム色',
    'demo.pickCustomColor': 'カスタムハイライト色を選択',
    'demo.saveColor': '現在の色を保存',
    'demo.saveCustomColor': 'カスタムハイライト色を保存',
    'demo.useThisColor': 'この色を使う',
    'demo.sidebar': 'ホストサイドバー（スロット）',
    'demo.loading': '読み込み中…',
    'demo.localeName.zh': '中国語',
    'demo.localeName.en': '英語',
    'demo.localeName.ja': '日本語',
    'demo.rtl.ltr': 'LTR（左から右）',
    'demo.rtl.rtl': 'RTL（右から左）',
    'demo.aria.theme': 'テーマ',
    'demo.aria.locale': '言語',
    'demo.aria.density': '密度',
    'demo.aria.dir': '文字方向',
  },
};

/**
 * 取 demo 的文案。
 *
 * @param locale 语言
 * @param key 文案 key
 * @param vars 变量（`{name}` 占位）
 * @returns 文案（找不到就返回 key）
 */
export function demoText(locale: DemoLocale, key: string, vars?: Record<string, string | number>) {
  const template = DEMO_MESSAGES[locale]?.[key] ?? DEMO_MESSAGES.zh[key] ?? key;
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
