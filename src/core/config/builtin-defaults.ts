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
    'annotation.title': 'メモ',
    'annotation.delete': '削除',
    'annotation.close': '閉じる',
    'annotation.content': '内容',
    'annotation.save': '保存',
    'annotation.cancel': 'キャンセル',
    'annotation.placeholder': 'メモを書く…',
    'annotation.pick': '色を選ぶ',
    'annotation.new': '新しいメモ',
    'annotation.edit': 'メモを編集',
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
    'annotation.title': 'Note',
    'annotation.delete': 'Supprimer',
    'annotation.close': 'Fermer',
    'annotation.content': 'Contenu',
    'annotation.save': 'Enregistrer',
    'annotation.cancel': 'Annuler',
    'annotation.placeholder': 'Écrire une note…',
    'annotation.pick': 'Choisir une couleur',
    'annotation.new': 'Nouvelle note',
    'annotation.edit': 'Modifier la note',
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
