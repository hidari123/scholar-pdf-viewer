/**
 * config —— **统一的配置对象**（"万物可配置"）。
 *
 * ## 用户需求
 *
 * > "需要万物可配置 比如说图标、高亮颜色等很多功能都要能支持宿主自主配置。"
 *
 * ## 之前的问题
 *
 * 包的可配置项**散落在十几个 props 上**：
 *
 * ```
 * <PdfViewer
 *   theme="paper"                          ← 主题
 *   appearance={{ density: 'compact' }}    ← 外观
 *   highlightPalette={{ yellow: '#ffd54a' }}← 高亮色板
 *   icons={{ upload: <Upload /> }}          ← 图标
 *   locale="ja" locales={{ ja }}            ← 语言
 *   selectionActions={[...]}                ← 选区动作
 *   toolbar={{ showSearch: false }}         ← 工具栏
 *   features={{ ... }}                      ← 功能开关
 *   messages={{ ... }}                      ← 文案覆盖
 * />
 * ```
 *
 * → **8 个 props** → 宿主配置起来很啰嗦 → 容易漏 → 也不利于"整体替换/预设" ❌
 *
 * ## 现在的方案
 *
 * ```tsx
 * <PdfViewer
 *   config={{
 *     theme: 'paper',
 *     appearance: { density: 'compact' },
 *     highlightPalette: { yellow: '#ffd54a' },
 *     icons: { upload: <Upload /> },
 *     locale: 'ja',
 *     locales: { ja },
 *     toolbar: { showSearch: false },
 *     messages: { 'search.placeholder': '搜索' },
 *   }}
 * />
 * ```
 *
 * **一个对象** → 宿主可以整体替换、合并、预设（比如"深色模式预设"）。
 *
 * ## ⚠️ **两种写法都支持**（不破坏已有代码）
 *
 * ```
 * ① config={{ ... }}    ← 新的（推荐）
 * ② theme="paper"      ← 旧的（仍然能用）
 * ```
 *
 * **优先级：单独的 prop > `config` 里的同名项**
 * → 已有代码**完全不受影响** ✅
 * → 宿主可以"先用 config 配一套默认，再单独覆盖某一项" ✅
 */

import type { ReactNode } from 'react';
import type { Locale, LocaleMessages, LocaleMessagesMap, LocaleTable } from '../../i18n/messages';
import type { RichTextPalette, RichTextToolbarItem } from '../editor/rich-text';
import type { HighlightPalette } from '../highlight/palette';
import type { IconName } from '../icons/icons';
import type { PAPER_SIZES, PaperSize, PrintMargin } from '../print';
import type { SelectionAction } from '../selection/actions';
import type { PdfViewerAppearance, PdfViewerTheme, ToolbarConfig } from '../theme';
import {
  BUILTIN_ANNOTATION_PALETTE,
  BUILTIN_ANNOTATION_TEXT_PALETTE,
  BUILTIN_HIGHLIGHT_PALETTE,
  detectDefaultLocale,
  mergeLocales,
} from './builtin-defaults';

/**
 * **统一配置对象**。
 *
 * ⚠️ **每一项都是可选的** → 宿主只写关心的 ✅
 */
export interface PdfViewerConfig {
  /* —— 外观 —— */

  /** 整体风格 */
  theme?: PdfViewerTheme;
  /** 结构开关（显示哪些按钮、密度…） */
  appearance?: PdfViewerAppearance;

  /* —— 图标 —— */

  /**
   * **图标覆盖**（宿主 → 包）。
   *
   * → 宿主有自己的图标体系（`lucide-react` 等）时逐个替换 ✅
   */
  icons?: Partial<Record<IconName, ReactNode>>;

  /* —— 高亮 —— */

  /**
   * **高亮色板**（语义 key → CSS 颜色）。
   *
   * → 高亮记录的 `color: 'my-1'` 会渲染成色板里的颜色 ✅
   */
  highlightPalette?: HighlightPalette;

  /**
   * **默认高亮色**（语义 key）。
   *
   * → 用户**不选颜色**时用这个 ✅
   *    （用户需求："如果没有选择颜色 也按照默认颜色来展示高亮
   *    不必每次都选择颜色"✅）
   * → 不传 -> 用色板里的**第一个**颜色 ✅
   * → 传了但色板里没有这个 key -> 也用色板第一个 ✅
   */
  defaultHighlightColor?: string;

  /* —— 语言 —— */

  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表（可添加任意语言） */
  locales?: LocaleTable;
  /**
   * **文案覆盖（按语言绑定）**。
   *
   * ⚠️⚠️ **之前是"不绑语言"的**（审计发现的**真 bug**）：
   *
   * ```tsx
   * // ❌ 之前：这些句子在【任何语言】下都生效
   * <PdfViewer locale="en" messages={{ 'search.placeholder': '全文检索' }} />
   * //   -> 切到 en 还是"全文检索"（中文）❌
   * ```
   *
   * -> 实测（`resolveMessage` 的第 1 层 \`overrides?.[key]\` **不带 locale 判断**）：
   * ```
   * zh + overrides -> "全文检索"
   * en + overrides -> "全文检索"   ← ❌ 切语言也没用
   * ```
   * -> 宿主切语言 -> **被覆盖的 key 还是中文** -> **中英文混杂** ❌
   * -> 而且宿主每次切换重建 \`messages\` 对象 -> **新引用** -> 重新渲染
   *   -> **tooltip 在两次渲染之间取值不同** -> **"语言自己会动来动去"** ❌
   *
   * ⚠️ **现在改成按语言绑定**（和 \`locales\` 同一个概念）：
   *
   * ```tsx
   * <PdfViewer
   *   locale="en"
   *   messages={{ en: { 'search.placeholder': 'Full-text search' } }}
   * />
   * ```
   *
   * → **换语言只影响对应语言的那份** ✅
   * → **切换时引用稳定** -> 不会重新渲染 -> **tooltip 不再跳** ✅
   */
  messages?: LocaleMessagesMap;

  /* —— 交互 —— */

  /**
   * **选区动作**（浮层里的按钮）。
   *
   * → 宿主传什么就显示什么 → "没配就不显示" ✅
   */
  selectionActions?: SelectionAction[];
  /**
   * **高亮块的工具栏配置**。
   *
   * → 不传 → 用默认的（加粗 / 高亮 / 颜色 / 链接 …）
   */
  annotationToolbar?: RichTextToolbarItem[];
  /** 批注编辑器的高亮色板 */
  annotationPalette?: RichTextPalette;
  /**
   * **批注编辑器的"文字颜色"色板**（**深色**）。
   *
   * ⚠️⚠️ **和 `annotationPalette` 分开**（用户反馈：
   * "富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色"）。
   *
   * -> `annotationPalette` = **浅色**（\`#fff3a3\` 这种）-> 当**高亮底色** ✅
   * -> 拿来当**文字颜色** -> **浅得看不见** ❌
   * -> 所以**单独一份深色板** ✅
   */
  annotationTextPalette?: RichTextPalette;

  /* —— 结构 —— */

  /**
   * **工具栏配置**（显示哪些按钮）。
   *
   * ⚠️ **用的是和 `Toolbar` 组件**同一个类型**（审计发现的 bug）：
   * -> 之前这里是一份**匿名对象字面量** -> 和 `ToolbarConfig` **字段不一致** ❌
   *   -> 里面有 `showPrint`（`ToolbarConfig` 没有）-> **死配置** ❌
   * -> 现在直接用 `ToolbarConfig` -> **两边永远一致** ✅
   */
  toolbar?: ToolbarConfig;
  /** 功能开关（默认全开；只有显式写 `false` 才关） */
  features?: Partial<Features>;
  /**
   * **打印纸张**（默认 `'A4'`）。
   *
   * ⚠️ **之前写死 A4** -> 美洲市场的 Letter 用户**打印会超出页面** ❌
   * -> 现在：**宿主可配** ✅
   */
  printPaper?: keyof typeof PAPER_SIZES | PaperSize;
  /** 打印边距（mm，部分覆盖） */
  printMargin?: Partial<PrintMargin>;
}

/**
 * **功能开关**（哪些功能开 / 关）。
 *
 * ⚠️ **默认全开**（opt-out）——
 * -> 传 `{ search: false }` -> 关掉搜索 ✅
 * -> 传 `{}` -> **什么都不关** ✅
 * -> 只有显式写 `false` 才关 ✅
 *
 * ⚠️ **之前这里是 `Record<string, boolean>`**（审计发现的 bug）：
 * -> 任何 key 都能写 -> **拼错也编译通过**（比如 `serach`）❌
 * -> 拼错了**静默无效** -> 宿主以为关掉了搜索，其实没关 ❌
 * -> 现在**用具体的类型** -> 拼错**直接编译报错** ✅
 */
export interface Features {
  /** 搜索 */
  search?: boolean;
  /** 缩略图 */
  thumbnails?: boolean;
  /** 目录 */
  outline?: boolean;
  /** 键盘快捷键 */
  keyboard?: boolean;
  /** 打印 */
  print?: boolean;
}

/**
 * **合并"单独 prop"和"config 对象"**。
 *
 * ## 优先级
 *
 * ```
 * 单独的 prop（不是 undefined）  ← 最高
 * config[key]
 * undefined                      ← 用默认值
 * ```
 *
 * ⚠️ **为什么单独 prop 优先**：
 * → 已有代码（`<PdfViewer theme="paper" />`）**行为不变** ✅
 * → 宿主可以"config 配一套默认 + 单独覆盖一项" ✅
 *
 * @param propValue 单独 prop 的值
 * @param configValue config 里的值
 * @returns 合并后的值
 */
export function resolveConfigValue<T>(
  propValue: T | undefined,
  configValue: T | undefined,
): T | undefined {
  return propValue !== undefined ? propValue : configValue;
}

/**
 * **把统一配置应用到各个组件**（内部用）。
 *
 * @param config 统一配置
 * @param props 单独 props（优先级更高）
 * @returns 合并后的 props
 */
export function mergeConfig(
  config: PdfViewerConfig | undefined,
  props: {
    theme?: PdfViewerTheme;
    appearance?: PdfViewerAppearance;
    icons?: Partial<Record<IconName, ReactNode>>;
    highlightPalette?: HighlightPalette;
    defaultHighlightColor?: string;
    locale?: Locale;
    locales?: LocaleTable;
    messages?: LocaleMessagesMap;
    selectionActions?: SelectionAction[];
    annotationToolbar?: RichTextToolbarItem[];
    annotationPalette?: RichTextPalette;
    annotationTextPalette?: RichTextPalette;
    toolbar?: PdfViewerConfig['toolbar'];
    features?: Record<string, boolean>;
    printPaper?: PdfViewerConfig['printPaper'];
    printMargin?: PdfViewerConfig['printMargin'];
  },
) {
  const c = config ?? {};
  return {
    theme: resolveConfigValue(props.theme, c.theme),
    appearance: resolveConfigValue(props.appearance, c.appearance),
    icons: resolveConfigValue(props.icons, c.icons),
    /*
     * ⚠️⚠️ **内置默认值**（用户需求：
     * "语言和高亮色都是包需要内置的 但是有接口宿主可以配置 现在你都放宿主这里了"）。
     *
     * -> 高亮色板：**不传也有**（内置 6 色）✅
     * -> 语言表：**内置了 ja / fr** → 宿主不用再写一整套 ✅
     * -> 宿主的值**优先级更高**（prop > config > 内置）✅
     */
    highlightPalette:
      resolveConfigValue(props.highlightPalette, c.highlightPalette) ?? BUILTIN_HIGHLIGHT_PALETTE,
    /*
     * ⚠️ **默认高亮色**（用户需求："如果没有选择颜色
     * 也按照默认颜色来展示高亮 不必每次都选择颜色"✅）。
     *
     * -> 宿主可以指定（语义 key）✅
     * -> 没指定 / 色板里没这个 key -> 用色板的**第一个** ✅
     *    -> 保证"点高亮按钮一定有颜色" ✅
     */
    defaultHighlightColor:
      resolveConfigValue(props.defaultHighlightColor, c.defaultHighlightColor) ??
      Object.keys(
        resolveConfigValue(props.highlightPalette, c.highlightPalette) ?? BUILTIN_HIGHLIGHT_PALETTE,
      )[0],
    /*
     * ⚠️ **没指定语言时按浏览器语言推断**（而不是硬编码 'zh'）。
     * -> 很多宿主是英文站点 -> 默认中文 -> 用户看到"怎么是中文" ❌
     * -> 推断成浏览器语言 -> **开箱即用** ✅
     */
    locale: resolveConfigValue(props.locale, c.locale) ?? detectDefaultLocale(),
    // 宿主的语言表 + 内置的语言表（宿主覆盖内置）
    locales: mergeLocales(resolveConfigValue(props.locales, c.locales)),
    messages: resolveConfigValue(props.messages, c.messages),
    selectionActions: resolveConfigValue(props.selectionActions, c.selectionActions),
    annotationToolbar: resolveConfigValue(props.annotationToolbar, c.annotationToolbar),
    /*
     * ⚠️⚠️ **必须有内置兜底**（用户反馈："高亮效果也没出来"）。
     *
     * -> 之前不传就没有色板 -> **工具栏里没有"高亮底色"按钮** ❌
     * -> 用户以为高亮坏了 -> 其实是**按钮根本没渲染** ❌
     * -> 现在：**内置一份** -> 不传也有 ✅
     */
    annotationPalette:
      resolveConfigValue(props.annotationPalette, c.annotationPalette) ??
      BUILTIN_ANNOTATION_PALETTE,
    /*
     * ⚠️⚠️ **文字颜色色板（深色）**（用户反馈：
     * "富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色"）。
     *
     * -> `annotationPalette` 是**浅色**（当高亮底色用）✅
     * -> **文字颜色必须用深色** -> **单独一份** ✅
     */
    annotationTextPalette:
      resolveConfigValue(props.annotationTextPalette, c.annotationTextPalette) ??
      BUILTIN_ANNOTATION_TEXT_PALETTE,
    toolbar: resolveConfigValue(props.toolbar, c.toolbar),
    features: resolveConfigValue(props.features, c.features),
    /*
     * ⚠️ **打印纸张 / 边距**（审计发现的：之前**写死 A4**）。
     * -> 美洲市场的 Letter 用户打印会**超出页面** ❌
     * -> 现在：**宿主可配**（prop > config > 默认 A4）✅
     */
    printPaper: resolveConfigValue(props.printPaper, c.printPaper),
    printMargin: resolveConfigValue(props.printMargin, c.printMargin),
  };
}

/*
 * ⚠️⚠️ **必须重新导出内置默认值**（实测踩过的坑）。
 *
 * → `src/core/config/index.ts` 是 `core` 子路径的出口
 * → 不重新导出 -> 宿主 `import { BUILTIN_LOCALES } from '@scholar-club/pdf-viewer/core'`
 *   -> **undefined** ❌（实测：core 子路径里查不到）
 * -> 重新导出 -> 宿主从哪个子路径都能拿到 ✅
 */
export {
  /** 内置的批注色板（富文本"高亮底色"，6 色） */
  BUILTIN_ANNOTATION_PALETTE,
  /** 内置的"文字颜色"色板（深色，7 色） */
  BUILTIN_ANNOTATION_TEXT_PALETTE,
  /** 内置的高亮色板（8 色） */
  BUILTIN_HIGHLIGHT_PALETTE,
  /** 内置的语言表（中文 / 英文 / 日文 / 法文） */
  BUILTIN_LOCALES,
  /** 按浏览器语言推断默认语言 */
  detectDefaultLocale,
  /** 合并语言表（宿主覆盖内置） */
  mergeLocales,
} from './builtin-defaults';
/** 重新导出类型（宿主只 import 一个地方） */
export type { LocaleMessages, LocaleTable };
