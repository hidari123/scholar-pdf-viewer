/**
 * 主题与外观配置（**纯类型 + 纯函数**，零 DOM）。
 *
 * ## 分层
 *
 * | 层 | 控制什么 | 手段 |
 * |---|---|---|
 * | 1 | 整体风格 | `theme="paper"` |
 * | 2 | 结构开关 | `appearance={{ density: 'compact' }}` |
 * | 3 | 像素微调 | 宿主覆盖 CSS 变量 |
 *
 * 三层**不冲突** —— 2 和 3 都能覆盖 1。
 */

/**
 * 内置主题。
 *
 * - `light` 亮色（默认）
 * - `dark` 暗色
 * - `auto` 跟随系统
 * - `paper` 纸张（米黄护眼）
 * - `sepia` 深色护眼（棕褐）
 * - `contrast` 高对比度（无障碍）
 * - `minimal` 极简黑白（打印友好）
 */
import type { ReactNode } from 'react';

export type PdfViewerTheme = 'light' | 'dark' | 'auto' | 'paper' | 'sepia' | 'contrast' | 'minimal';

/** 全部内置主题（宿主做切换 UI 时用） */
export const THEMES: readonly PdfViewerTheme[] = [
  'light',
  'dark',
  'auto',
  'paper',
  'sepia',
  'contrast',
  'minimal',
] as const;

/** 主题的中文名（宿主做切换 UI 时用） */
export const THEME_LABELS: Record<PdfViewerTheme, string> = {
  light: '亮色',
  dark: '暗色',
  auto: '跟随系统',
  paper: '纸张',
  sepia: '护眼',
  contrast: '高对比度',
  minimal: '极简',
};

/**
 * **主题名的多语言表**（宿主做切换 UI 时用）。
 *
 * ⚠️ 用户反馈："切换语言还是没变啊 下拉框选择语言之后
 *    发现页面上语言还是没换啊"
 * → 主题切换器下拉框里的名字是 `THEME_LABELS` → **永远是中文** ❌
 *
 * → 这里给出**内置的多语言名字** → 宿主直接用 ✅
 * → 宿主想用自己的叫法 → 传 `themeLabels` 覆盖 ✅
 */
export const THEME_LABELS_I18N: Record<string, Record<PdfViewerTheme, string>> = {
  zh: THEME_LABELS,
  en: {
    light: 'Light',
    dark: 'Dark',
    auto: 'System',
    paper: 'Paper',
    sepia: 'Sepia',
    contrast: 'High contrast',
    minimal: 'Minimal',
  },
  ja: {
    light: 'ライト',
    dark: 'ダーク',
    auto: 'システム',
    paper: 'ペーパー',
    sepia: 'セピア',
    contrast: 'ハイコントラスト',
    minimal: 'ミニマル',
  },
};

/**
 * 取主题的名字（按语言）。
 *
 * @param theme 主题
 * @param locale 语言（默认中文）
 * @param overrides 宿主的覆盖表
 * @returns 主题名
 */
export function themeLabel(
  theme: PdfViewerTheme,
  locale = 'zh',
  overrides?: Partial<Record<PdfViewerTheme, string>>,
): string {
  return overrides?.[theme] ?? THEME_LABELS_I18N[locale]?.[theme] ?? THEME_LABELS[theme];
}

/** 密度 */
export type PdfViewerDensity = 'compact' | 'cozy' | 'comfortable';

/** 外壳的显示程度 */
export type PdfViewerChrome = 'full' | 'minimal' | 'hidden';

/**
 * 外观配置（**结构**，不是颜色）。
 *
 * ⚠️ **这些是"结构开关"，用 JS 配**（CSS 变量做不到）：
 * - 显示哪些按钮
 * - 工具栏 / 面板的密度
 * - 页阴影 / 圆角
 */
export interface PdfViewerAppearance {
  /** 密度（工具栏 / 面板） */
  density?: PdfViewerDensity;
  /** 外壳的显示程度 */
  chrome?: PdfViewerChrome;
  /** 页阴影 */
  pageShadow?: boolean;
  /** 页圆角（px）；不传 = 跟随主题 */
  pageRadius?: number;
  /** 显示页码 */
  showPageNumber?: boolean;
  /** 显示目录按钮 */
  showOutline?: boolean;
  /** 显示缩略图按钮 */
  showThumbnails?: boolean;
  /** 显示搜索按钮 */
  showSearch?: boolean;
  /**
   * 强调色（主色）。
   *
   * ⚠️ **覆盖主题的 `--scpdf-color-primary`** → 主题是"底色"，这个是"点缀"。
   */
  accentColor?: string;
  /** 字体族（覆盖 `--scpdf-font-family`） */
  fontFamily?: string;
  /** 字号（px，覆盖 `--scpdf-font-size`） */
  fontSize?: number;
}

/**
 * **插槽**（方案 D：完全自定义）。
 *
 * 每个槽给了就**替换**内置的那块；不给就用内置的。
 *
 * ⚠️ **替换掉的部分，包不再负责它的功能**。
 *
 * ⚠️ 类型用 `unknown` 而不是 `ReactNode` → **core 层保持零 React 依赖**
 *    （core 的铁律：不 import react）。
 *    → React 层（`PdfViewer`）会把它当 `ReactNode` 渲染。
 */
/**
 * **工具栏配置**（显示哪些按钮 + 两端的插槽）。
 *
 * ⚠️ **为什么住在 core**（审计发现的 bug）：
 * -> 之前它在 `components/Toolbar.tsx` -> `core/config` 想引用它就得
 *    **从 core 反向依赖 components** ❌（违反分层：core 不依赖 components）
 * -> 而且 `PdfViewerConfig.toolbar` 是**另一份匿名字面量** -> 两边字段不一致 ❌
 *    -> 里面有 `showPrint`（`ToolbarConfig` 没有）-> **死配置** ❌
 * -> 现在：**只有一份** -> 两边永远一致 ✅
 */
export interface ToolbarConfig {
  /** 显示翻页 */
  showPageNav?: boolean;
  /** 显示缩放 */
  showZoom?: boolean;
  /** 显示搜索 */
  showSearch?: boolean;
  /** 显示缩略图 */
  showThumbnails?: boolean;
  /** 显示目录 */
  showOutline?: boolean;
  /** 左侧插槽（宿主任意内容） */
  leftSlot?: ReactNode;
  /** 右侧插槽（宿主任意内容） */
  rightSlot?: ReactNode;
}

export interface PdfViewerSlots {
  /** 替换整个工具栏 */
  toolbar?: unknown;
  /** 替换侧栏（缩略图 / 目录） */
  panel?: unknown;
  /**
   * 页内叠加层（盖在页上的任意内容）。
   *
   * ⚠️ 可以传**函数** → 按页号调用（能拿到"当前是第几页"）。
   */
  pageOverlay?: unknown;
}

/**
 * 把主题 + 外观配置翻译成**根节点的 class 名**。
 *
 * @param theme 主题
 * @param appearance 外观配置
 * @returns class 名列表（不含 `scpdf-root`）
 *
 * @example
 * ```ts
 * themeClasses('paper', { density: 'compact', pageShadow: false });
 * // → ['scpdf-root--paper', 'scpdf-root--density-compact', 'scpdf-root--no-page-shadow']
 * ```
 */
export function themeClasses(
  theme: PdfViewerTheme | undefined,
  appearance?: PdfViewerAppearance,
): string[] {
  const classes: string[] = [];

  if (theme) {
    classes.push(`scpdf-root--${theme}`);
  }

  if (appearance?.density) {
    classes.push(`scpdf-root--density-${appearance.density}`);
  }
  if (appearance?.chrome) {
    classes.push(`scpdf-root--chrome-${appearance.chrome}`);
  }
  if (appearance?.pageShadow === false) {
    classes.push('scpdf-root--no-page-shadow');
  }
  if (appearance?.pageRadius === 0) {
    classes.push('scpdf-root--page-radius-0');
  }
  /*
   * ⚠️ **`showPageNumber` 必须产出 class**（实测踩过的坑）。
   *
   * 之前它只在类型里声明 → **死 prop** → 宿主传了完全没效果。
   * → 现在：`false` → 隐藏页码；`true` → 强制显示（覆盖主题的默认）。
   */
  if (appearance?.showPageNumber === false) {
    classes.push('scpdf-root--no-page-number');
  } else if (appearance?.showPageNumber === true) {
    classes.push('scpdf-root--show-page-number');
  }

  return classes;
}

/**
 * 把外观配置翻译成**根节点的内联样式**。
 *
 * ⚠️ **为什么有些走内联样式而不是 class**：
 * - `pageRadius` 是**任意数值** → class 表达不了（只能特判 `0`）
 * - `accentColor` / `fontFamily` / `fontSize` 是**任意值** → 同理
 *
 * → 这些走 **CSS 变量**（内联）→ 覆盖主题，不影响其他层。
 *
 * @param appearance 外观配置
 * @returns React 的 style 对象（空对象 = 不覆盖）
 */
export function appearanceStyles(appearance?: PdfViewerAppearance): Record<string, string> {
  const style: Record<string, string> = {};
  if (!appearance) {
    return style;
  }

  if (typeof appearance.pageRadius === 'number' && appearance.pageRadius > 0) {
    style['--scpdf-radius-page'] = `${appearance.pageRadius}px`;
  }
  if (appearance.accentColor) {
    style['--scpdf-color-primary'] = appearance.accentColor;
  }
  /*
   * ⚠️⚠️ **字体必须写到 CSS 真正用的那个变量上**（审计发现的**死配置**）。
   *
   * -> 之前写的是 \`--scpdf-font-family\` ❌
   *   -> 但 \`.scpdf-root\` 用的是 \`--scpdf-font-reading\`（\`viewer.css:51\`）❌
   *   -> **两个变量从不连通** -> 宿主设了 \`fontFamily\` -> **完全没效果** ❌
   * -> 现在：**两个都写** ✅
   *   -> \`--scpdf-font-reading\`（真正生效的）✅
   *   -> \`--scpdf-font-family\`（保留，万一以后 CSS 用了它）✅
   */
  if (appearance.fontFamily) {
    style['--scpdf-font-reading'] = appearance.fontFamily;
    style['--scpdf-font-family'] = appearance.fontFamily;
  }
  if (typeof appearance.fontSize === 'number' && appearance.fontSize > 0) {
    style['--scpdf-font-size'] = `${appearance.fontSize}px`;
  }

  return style;
}
