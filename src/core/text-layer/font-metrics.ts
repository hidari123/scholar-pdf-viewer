/**
 * font-metrics —— 字体度量实测（对齐 pdf.js 的做法）。
 *
 * 为什么需要实测：
 * - PDF 里的字宽是**内嵌字体**的度量，浏览器没有那个字体
 * - 浏览器用**系统字体**排版 → 总宽度与 PDF 不同 → 文字逐渐偏移
 * - 要让选区框精确落在 canvas 的字上，必须知道：
 *   1) 浏览器排出来的实际宽度（→ 算 scaleX 拉伸比）
 *   2) 字体的 ascent 比例（→ 算 span 的 top）
 *
 * 这两个值都**只能实测**（canvas measureText），
 * 没有公式能算出来 —— 这也是 pdf.js 的做法。
 *
 * 与 pdf.js 的对应关系：
 * - pdf.js `TextLayer.#getAscent()` → `measureAscentRatio()`
 * - pdf.js `TextLayer.#layout()` 里的 `ctx.measureText()` → `measureTextWidth()`
 */

/** 默认字号（用于测 ascent 比例，任意值即可） */
const DEFAULT_FONT_SIZE = 30;

/** 离屏 canvas 上下文（懒创建，全局复用） */
let ctx: CanvasRenderingContext2D | null = null;

/**
 * 拿到离屏 canvas 的 2D 上下文。
 *
 * @returns 上下文（不可用时返回 null）
 */
function getCtx(): CanvasRenderingContext2D | null {
  if (ctx) {
    return ctx;
  }

  // 非浏览器环境（SSR / Node 测试）→ 返回 null
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'scpdf-visually-hidden';
  canvas.width = DEFAULT_FONT_SIZE;
  canvas.height = DEFAULT_FONT_SIZE;
  // 挂到 DOM 上才能测（Firefox 需要元素在文档中）
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  document.body.append(canvas);

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  ctx = context;
  return ctx;
}

/** ascent 比例缓存（fontFamily → ratio） */
const ascentCache = new Map<string, number>();

/** 文字宽度缓存（`${family}|${size}|${text}` → width） */
const widthCache = new Map<string, number>();

/** 宽度缓存上限（防内存无限增长） */
const WIDTH_CACHE_LIMIT = 5000;

/**
 * 归一化字体族（把 fontFamily 变成 measureText 认得的格式）。
 *
 * @param fontFamily 字体族
 * @returns 归一化后的字体族
 */
function normalizeFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (trimmed.length === 0) {
    return 'sans-serif';
  }
  // 带引号的保留，其余补引号（多字体族需要）
  return trimmed
    .split(',')
    .map((part) => {
      const p = part.trim();
      if (p.length === 0) {
        return p;
      }
      return /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(p)
        ? p
        : `"${p.replace(/["']/g, '')}"`;
    })
    .join(', ');
}

/**
 * 测字体的 ascent 比例（ascent / (ascent + descent)）。
 *
 * 与 pdf.js 的 `TextLayer.#getAscent()` 一致：
 * 用 canvas `measureText('')` 拿 `fontBoundingBoxAscent` / `fontBoundingBoxDescent`。
 *
 * **为什么 top 要用 ascent 而不是字号**：
 * 浏览器的行盒是从**基线向上到 ascent、向下到 descent** 决定的，
 * 不是从基线向上 fontHeight。用 fontHeight 会整体偏低（差 15~20%）。
 *
 * @param fontFamily 字体族
 * @returns ascent 比例（0~1）；测不到时返回默认 0.8
 */
export function measureAscentRatio(fontFamily: string): number {
  const family = normalizeFamily(fontFamily);
  const cached = ascentCache.get(family);
  if (cached !== undefined) {
    return cached;
  }

  const context = getCtx();
  if (!context) {
    return 0.8;
  }

  context.canvas.width = DEFAULT_FONT_SIZE;
  context.canvas.height = DEFAULT_FONT_SIZE;
  context.font = `${DEFAULT_FONT_SIZE}px ${family}`;
  context.textBaseline = 'alphabetic';

  const metrics = context.measureText('');
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = Math.abs(metrics.fontBoundingBoxDescent);

  if (ascent && descent) {
    const ratio = ascent / (ascent + descent);
    ascentCache.set(family, ratio);
    return ratio;
  }

  // 退化：按 pdf.js 的默认值
  const fallback = 0.8;
  ascentCache.set(family, fallback);
  return fallback;
}

/**
 * 测一段文字在指定字体/字号下的**浏览器实际宽度**。
 *
 * 与 pdf.js `TextLayer.#layout()` 里的 `ctx.measureText(div.textContent)` 一致。
 *
 * @param text 文字
 * @param fontFamily 字体族
 * @param fontSize 字号（px）
 * @returns 宽度（px）；测不到时返回 0
 */
export function measureTextWidth(text: string, fontFamily: string, fontSize: number): number {
  if (text.length === 0 || fontSize <= 0) {
    return 0;
  }

  const family = normalizeFamily(fontFamily);
  const key = `${family}|${fontSize.toFixed(2)}|${text}`;

  const cached = widthCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const context = getCtx();
  if (!context) {
    return 0;
  }

  context.font = `${fontSize}px ${family}`;
  context.textBaseline = 'alphabetic';
  const width = context.measureText(text).width;

  // 缓存（有上限，防无限增长）
  if (widthCache.size >= WIDTH_CACHE_LIMIT) {
    widthCache.clear();
  }
  widthCache.set(key, width);

  return width;
}

/**
 * 清理缓存（测试用；字体加载完可能要重测）。
 */
export function clearFontMetricsCache(): void {
  ascentCache.clear();
  widthCache.clear();
}

/**
 * 按 fontName 猜一个系统字体族（降级方案）。
 *
 * 为什么需要猜：PDF 的 `fontName`（如 `g_d0_f1`）不是 CSS 字体名，
 * 而包**不依赖 pdf.js** → 拿不到真实的字体信息。
 *
 * **为什么这样够用**：scaleX 会把浏览器排出来的宽度补偿到 PDF 的宽度，
 * 所以**几何精准不受字体选择影响**；字体只影响"看起来像不像"。
 *
 * @param fontName PDF 里的字体名
 * @returns CSS font-family
 */
export function guessFontFamily(fontName: string | undefined): string {
  if (!fontName) {
    return 'sans-serif';
  }

  const lower = fontName.toLowerCase();

  if (lower.includes('mono') || lower.includes('courier') || lower.includes('consol')) {
    return 'monospace';
  }
  // "sans" 要在 "serif" 之前判断（"sans-serif" 也含 "serif"）
  if (lower.includes('sans')) {
    return 'sans-serif';
  }
  if (lower.includes('serif') || lower.includes('times') || lower.includes('roman')) {
    return 'serif';
  }

  return 'sans-serif';
}
