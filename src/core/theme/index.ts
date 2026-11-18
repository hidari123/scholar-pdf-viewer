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
  if (appearance.fontFamily) {
    style['--scpdf-font-family'] = appearance.fontFamily;
  }
  if (typeof appearance.fontSize === 'number' && appearance.fontSize > 0) {
    style['--scpdf-font-size'] = `${appearance.fontSize}px`;
  }

  return style;
}
