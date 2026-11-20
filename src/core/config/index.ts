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
import type { Locale, LocaleMessages, LocaleTable, Messages } from '../../i18n/messages';
import type { RichTextPalette, RichTextToolbarItem } from '../editor/rich-text';
import type { HighlightPalette } from '../highlight/palette';
import type { IconName } from '../icons/icons';
import type { SelectionAction } from '../selection/actions';
import type { PdfViewerAppearance, PdfViewerTheme } from '../theme';
import {
  BUILTIN_ANNOTATION_PALETTE,
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
  /** 高亮块的默认颜色（key） */
  defaultHighlightColor?: string;

  /* —— 语言 —— */

  /** 语言 */
  locale?: Locale;
  /** 宿主注册的语言表（可添加任意语言） */
  locales?: LocaleTable;
  /** 文案覆盖（当前 locale） */
  messages?: Partial<Messages>;

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

  /* —— 结构 —— */

  /** 工具栏配置（显示哪些按钮） */
  toolbar?: {
    showPageNav?: boolean;
    showZoom?: boolean;
    showSearch?: boolean;
    showThumbnails?: boolean;
    showOutline?: boolean;
    showPrint?: boolean;
    leftSlot?: ReactNode;
    rightSlot?: ReactNode;
  };
  /** 功能开关 */
  features?: Record<string, boolean>;
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
    locale?: Locale;
    locales?: LocaleTable;
    messages?: Partial<Messages>;
    selectionActions?: SelectionAction[];
    annotationToolbar?: RichTextToolbarItem[];
    annotationPalette?: RichTextPalette;
    toolbar?: PdfViewerConfig['toolbar'];
    features?: Record<string, boolean>;
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
    toolbar: resolveConfigValue(props.toolbar, c.toolbar),
    features: resolveConfigValue(props.features, c.features),
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
