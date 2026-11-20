/**
 * config —— **包的内置默认值**。
 *
 * ## 用户需求
 *
 * > "语言和高亮色都是包需要内置的 但是有接口宿主可以配置
 * > 现在你都放宿主这里了"
 *
 * ### 之前
 *
 * → 高亮色板：宿主**必须**传 `highlightPalette` → 不传就没有颜色选择器 ❌
 * → 语言：包内置了 `zh` / `en`，但宿主想加 `ja` 要自己写一整套文案表
 *   （demo 的 `demo-i18n.ts` 就有 100+ 行）❌
 *
 * ### 现在
 *
 * → **高亮色板内置** → 不传也能用 ✅
 * → **语言表内置**（`ja` / `fr`）→ 宿主不用再写一整套 ✅
 * → 宿主传了 → **覆盖内置的**（优先级：prop > config > 内置默认）✅
 *
 * ## 边界（不变）
 *
 * → 内置的是**视觉/文案**，不是业务 → 不违反"包只做 PDF"的边界 ✅
 * → 宿主想换主题色/换语言 → 传配置覆盖 ✅
 */

import type { Locale, LocaleMessages, LocaleTable } from '../../i18n/messages';
import { MESSAGES } from '../../i18n/messages';
import type { RichTextPalette } from '../editor/rich-text';
import type { HighlightPalette } from '../highlight/palette';
import { DEFAULT_HIGHLIGHT_PALETTE } from '../highlight/palette';

/**
 * **内置的语言表**。
 *
 * ⚠️ **只包含"包自己的 UI 文案"** → 宿主自己的文案宿主自己管 ✅
 *
 * ### 内置哪些语言
 *
 * - **中文（`zh`）** —— 内置 ✅
 * - **英文（`en`）** —— 内置 ✅
 * - 日文（`ja`）/ 法文（`fr`）—— 也内置了（宿主不用再写一整套）✅
 * - 宿主想加 `ko` / `de` / `es` → 传 `locales` 注册 ✅
 *
 * ### 为什么把 `zh` / `en` 也放进这张表
 *
 * → 之前 `zh` / `en` 在 `MESSAGES` 里，`ja` / `fr` 在这里 → **两套地方** ❌
 * → 宿主想覆盖中文里的**某一句**时，得知道去改哪里 ❌
 * → 现在**统一成一张表** → 宿主传 `locales={{ zh: {...} }}` 就能覆盖 ✅
 *
 * ⚠️ `zh` / `en` 的**权威来源**仍然是 `MESSAGES`（`resolveMessage` 的最后兜底）✅
 * → 这里只是**再抄一份** → 让"内置语言"和"扩展语言"的处理方式**完全一致** ✅
 */
export const BUILTIN_LOCALES: LocaleTable = {
  /** 中文（内置） */
  zh: { ...MESSAGES.zh },
  /** 英文（内置） */
  en: { ...MESSAGES.en },
  ja: {
    'load.loading': 'ドキュメントを読み込み中…',
    'load.retry': '再試行',
    'load.failed': '読み込みに失敗しました',
    'load.progress': '{percent}% を読み込みました',
    'empty.title': 'ドキュメントが指定されていません',
    'empty.hint': 'file プロパティで PDF のパスまたはファイルを渡してください',
    'error.generic': 'エラーが発生しました',
    'error.E_LOAD_HTTP': '読み込みに失敗しました（HTTP）',
    'error.E_LOAD_NETWORK': 'ネットワークエラー',
    'error.E_LOAD_TIMEOUT': '読み込みがタイムアウトしました',
    'error.E_PDF_INVALID': '有効なPDFファイルではありません',
    'error.E_EMPTY': 'ドキュメントが指定されていません',
    'error.E_PDF_ENCRYPTED': 'このドキュメントは暗号化されています',
    'error.E_PDF_PASSWORD_WRONG': 'パスワードが違います',
    'error.E_RENDER_PAGE': 'ページの描画に失敗しました',
    'error.E_FONT_MISSING': 'フォントがありません',
    'error.E_CACHE_QUOTA': 'キャッシュ容量が不足しています',
    'error.E_CACHE_UNAVAILABLE': 'キャッシュを利用できません',
    'error.E_LINK_INVALID': '無効なリンクです',
    'password.title': 'このドキュメントは暗号化されています',
    'password.placeholder': 'パスワードを入力',
    'password.submit': 'OK',
    'password.cancel': 'キャンセル',
    'password.wrong': 'パスワードが違います',
    'page.of': '{page} / {total} ページ',
    'zoom.in': '拡大',
    'zoom.out': '縮小',
    'zoom.fitWidth': '幅に合わせる',
    'zoom.fitPage': 'ページに合わせる',
    'zoom.reset': 'リセット',
    'search.placeholder': 'ドキュメントを検索',
    'search.none': '一致する結果がありません',
    'search.count': '{count} 件',
    'search.prev': '前へ',
    'search.next': '次へ',
    'search.close': '閉じる',
    'outline.title': '目次',
    'thumbnails.title': 'ページ',
    'print.title': '印刷',
    'a11y.canvas': 'PDF キャンバス',
    'a11y.page': 'ページ {page}',
    'page.prev': '前へ',
    'page.next': '次へ',
    'selection.actions': '操作',
    'selection.color': '色',
    'selection.expandColor': 'すべての色',
    'annotation.delete': '削除',
    'annotation.close': '閉じる',
    'annotation.content': '内容',
    'annotation.save': '保存',
    'annotation.cancel': 'キャンセル',
    'annotation.placeholder': 'メモを書く…',
    'annotation.pick': '色を選ぶ',
    'annotation.new': '新しいメモ',
    'annotation.edit': 'メモを編集',
    'selection.actionHighlight': 'ハイライト',
    'selection.actionCopy': 'コピー',
    'selection.actionTranslate': '翻訳',
    'selection.actionAsk': '質問',
    'selection.actionExplain': '説明',
    'annotation.title': 'メモ',
    'annotation.withContent': 'メモ：{content}',
    'annotation.selectGroup': 'メモを選択（{count}）',
    'annotation.expand': 'メモを展開',
    'annotation.empty': '（空のメモ）',
    'link.internal': '内部リンク',
    'selection.highlightColor': 'ハイライト色 {key}',
    'toast.region': '通知',
    'richtext.linkPrompt': 'リンク先',
    'highlight.fullyCovered': 'このテキストはすでにハイライトされています',
    'toast.close': '閉じる',
    'toast.copied': 'コピーしました',
    'toast.copyFailed': 'コピーに失敗しました',
    'toast.exportSuccess': 'エクスポートしました',
    'toast.exportFailed': 'エクスポートに失敗しました',
    'selection.addNote': 'メモを追加',
    'richtext.bold': '太字',
    'richtext.italic': '斜体',
    'richtext.underline': '下線',
    'richtext.linkHref': 'リンク',
    'richtext.linkText': '表示テキスト',
    'richtext.linkConfirm': '確認',
    'richtext.linkCancel': 'キャンセル',
    'richtext.linkHrefPlaceholder': 'リンクを貼り付けまたは入力',
    'richtext.linkTextPlaceholder': 'デフォルトはリンクのURL',
    'richtext.strikeThrough': '取り消し線',
    'richtext.highlight': 'ハイライト',
    'richtext.textColor': '文字色',
    'richtext.link': 'リンク',
    'richtext.orderedList': '番号付きリスト',
    'richtext.unorderedList': '箇条書き',
    'richtext.quote': '引用',
    'richtext.clearFormat': '書式クリア',
    'richtext.undo': '元に戻す',
    'richtext.redo': 'やり直す',
  },
  fr: {
    'load.loading': 'Chargement du document…',
    'load.retry': 'Réessayer',
    'load.failed': 'Échec du chargement',
    'load.progress': '{percent}% chargé',
    'empty.title': 'Aucun document spécifié',
    'empty.hint': 'Passez le chemin ou le fichier PDF via la prop file',
    'error.generic': 'Une erreur est survenue',
    'error.E_LOAD_HTTP': 'Échec du chargement (HTTP)',
    'error.E_LOAD_NETWORK': 'Erreur réseau',
    'error.E_LOAD_TIMEOUT': 'Délai de chargement dépassé',
    'error.E_PDF_INVALID': "Le fichier n'est pas un PDF valide",
    'error.E_EMPTY': 'Aucun document spécifié',
    'error.E_PDF_ENCRYPTED': 'Ce document est chiffré',
    'error.E_PDF_PASSWORD_WRONG': 'Mot de passe incorrect',
    'error.E_RENDER_PAGE': 'Échec du rendu de la page',
    'error.E_FONT_MISSING': 'Police manquante',
    'error.E_CACHE_QUOTA': 'Quota du cache dépassé',
    'error.E_CACHE_UNAVAILABLE': 'Cache indisponible',
    'error.E_LINK_INVALID': 'Lien invalide',
    'password.title': 'Ce document est chiffré',
    'password.placeholder': 'Saisissez le mot de passe',
    'password.submit': 'OK',
    'password.cancel': 'Annuler',
    'password.wrong': 'Mot de passe incorrect',
    'page.of': 'Page {page} / {total}',
    'zoom.in': 'Zoom avant',
    'zoom.out': 'Zoom arrière',
    'zoom.fitWidth': 'Ajuster à la largeur',
    'zoom.fitPage': 'Ajuster à la page',
    'zoom.reset': 'Réinitialiser',
    'search.placeholder': 'Rechercher dans le document',
    'search.none': 'Aucun résultat',
    'search.count': '{count} résultats',
    'search.prev': 'Précédent',
    'search.next': 'Suivant',
    'search.close': 'Fermer',
    'outline.title': 'Sommaire',
    'thumbnails.title': 'Pages',
    'print.title': 'Impression',
    'a11y.canvas': 'Canvas PDF',
    'a11y.page': 'Page {page}',
    'page.prev': 'Précédent',
    'page.next': 'Suivant',
    'selection.actions': 'Actions',
    'selection.color': 'Couleur',
    'selection.expandColor': 'Toutes les couleurs',
    'annotation.delete': 'Supprimer',
    'annotation.close': 'Fermer',
    'annotation.content': 'Contenu',
    'annotation.save': 'Enregistrer',
    'annotation.cancel': 'Annuler',
    'annotation.placeholder': 'Écrire une note…',
    'annotation.pick': 'Choisir une couleur',
    'annotation.new': 'Nouvelle note',
    'annotation.edit': 'Modifier la note',
    'selection.actionHighlight': 'Surligner',
    'selection.actionCopy': 'Copier',
    'selection.actionTranslate': 'Traduire',
    'selection.actionAsk': 'Demander',
    'selection.actionExplain': 'Expliquer',
    'annotation.title': 'Note',
    'annotation.withContent': 'Note : {content}',
    'annotation.selectGroup': 'Choisir une note ({count})',
    'annotation.expand': 'Développer la note',
    'annotation.empty': '(Note vide)',
    'link.internal': 'Lien interne',
    'selection.highlightColor': 'Couleur de surlignage {key}',
    'toast.region': 'Notifications',
    'richtext.linkPrompt': 'URL du lien',
    'highlight.fullyCovered': 'Ce texte est déjà surligné',
    'toast.close': 'Fermer',
    'toast.copied': 'Copié',
    'toast.copyFailed': 'Échec de la copie',
    'toast.exportSuccess': 'Exporté',
    'toast.exportFailed': "Échec de l'export",
    'selection.addNote': 'Ajouter une note',
    'richtext.bold': 'Gras',
    'richtext.italic': 'Italique',
    'richtext.underline': 'Souligné',
    'richtext.linkHref': 'Lien',
    'richtext.linkText': 'Texte affiché',
    'richtext.linkConfirm': 'Confirmer',
    'richtext.linkCancel': 'Annuler',
    'richtext.linkHrefPlaceholder': 'Collez ou saisissez un lien',
    'richtext.linkTextPlaceholder': "Par défaut, l'URL du lien",
    'richtext.strikeThrough': 'Barré',
    'richtext.highlight': 'Surlignage',
    'richtext.textColor': 'Couleur du texte',
    'richtext.link': 'Lien',
    'richtext.orderedList': 'Liste numérotée',
    'richtext.unorderedList': 'Liste à puces',
    'richtext.quote': 'Citation',
    'richtext.clearFormat': 'Effacer la mise en forme',
    'richtext.undo': 'Annuler',
    'richtext.redo': 'Rétablir',
  },
};

/**
 * **内置的高亮色板**。
 *
 * → 和 `DEFAULT_HIGHLIGHT_PALETTE` 一样（独立导出方便宿主引用）✅
 */
export const BUILTIN_HIGHLIGHT_PALETTE: HighlightPalette = DEFAULT_HIGHLIGHT_PALETTE;

/**
 * **内置的批注色板**（富文本编辑器里的"高亮底色"）。
 *
 * ⚠️⚠️ **之前没有内置** -> 宿主不传 `annotationPalette` 就**没有高亮按钮** ❌
 *   （实测：工具栏里只有 13 个按钮，**没有"高亮底色"** ❌
 *    -> 用户反馈"高亮效果也没出来" —— 其实是**按钮都没出来** ❌）
 *
 * -> 现在：**内置一份** -> 不传也有高亮按钮 ✅
 * -> 宿主传了 -> **覆盖内置的** ✅
 */
export const BUILTIN_ANNOTATION_PALETTE: RichTextPalette = {
  yellow: '#fff3a3',
  green: '#c8e6c9',
  blue: '#bbdefb',
  pink: '#f8bbd0',
  purple: '#e1bee7',
  orange: '#ffe0b2',
};

/**
 * **推断默认语言**。
 *
 * → 之前是硬编码 `zh` → 很多宿主其实是英文站点 ❌
 * → 现在用**浏览器语言**推断 → 落在支持的语言上 ✅
 * → 宿主可以显式传 `locale` 覆盖 ✅
 *
 * @param fallback 推断不出来时的兜底
 * @returns 语言代码
 */
export function detectDefaultLocale(fallback: Locale = 'zh'): Locale {
  if (typeof navigator === 'undefined') {
    return fallback;
  }
  const lang = navigator.language ?? '';
  const lower = lang.toLowerCase();

  if (lower.startsWith('zh')) {
    return 'zh';
  }
  if (lower.startsWith('en')) {
    return 'en';
  }
  // 内置的扩展语言
  for (const key of Object.keys(BUILTIN_LOCALES)) {
    if (lower.startsWith(key.toLowerCase())) {
      return key;
    }
  }
  return fallback;
}

/**
 * **合并语言表**（宿主的 + 内置的）。
 *
 * → 宿主的**优先级更高**（能覆盖内置的某一句）✅
 *
 * @param hostLocales 宿主注册的语言表
 * @returns 合并后的语言表
 */
export function mergeLocales(hostLocales?: LocaleTable): LocaleTable {
  const result: LocaleTable = {};
  for (const [locale, messages] of Object.entries(BUILTIN_LOCALES)) {
    result[locale] = { ...messages } as LocaleMessages;
  }
  if (hostLocales) {
    for (const [locale, messages] of Object.entries(hostLocales)) {
      result[locale] = { ...(result[locale] ?? {}), ...messages } as LocaleMessages;
    }
  }
  return result;
}
