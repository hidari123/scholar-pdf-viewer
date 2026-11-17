/**
 * item-geometry —— **按文本项几何**算选区矩形（对齐 pdf.js v6）。
 *
 * ## 为什么要自己算（而不是用 `getClientRects()`）
 *
 * 实测（真实 PDF，230%）：
 *
 * | | 值 |
 * |---|---|
 * | 自绘选区 rect（`getClientRects()`） | `y=231.92, h=44` |
 * | 文本层 span（正确的位置） | `y=237.92, h=33` |
 * | **偏差** | **上偏 6px，框高多 11px** |
 *
 * 根因：浏览器的选区矩形 = **字体的自然行盒**（ascent + descent + lineGap），
 * 而 span 的 box = `fontSize × line-height`（= 33px）。
 * 两者**不是同一个东西** → 选区框跟文字对不齐。
 *
 * ⚠️ **CSS 改不动它**（实测 7 种都无效）：
 * `line-height` / `height` / `display` / `overflow` / `transform: scaleY`
 * —— 浏览器始终用字体自然行盒画选区矩形。
 *
 * ## pdf.js v6 怎么做的
 *
 * pdf.js v6 的 `DrawLayer` **也用 `range.getClientRects()`**，
 * 但它的 CSS 有个关键设置：
 *
 * ```css
 * .textLayer { line-height: 1; }
 * ```
 *
 * → span 的行盒 = `fontSize` → **浏览器的行盒和 span 的 box 对齐了**
 * → 选区矩形就落在文字上。
 *
 * 本包的 `line-height: 1` 也设了，但**没用**：
 * 因为本包的 span 的 `top` = `基线 − ascent`（pdf.js 也一样），
 * 而浏览器的行盒是**从 top 往下 fontSize 高**，
 * 于是行盒的**基线位置** = `top + ascent'`
 * （浏览器用自己字体的 ascent，不是我们实测的）→ 差 6px。
 *
 * ## 结论：水平用浏览器，垂直自己算
 *
 * - **水平**：用 `getClientRects()` 的 `left`/`width`
 *   （浏览器知道字距、kerning、连字 —— 我们不知道）
 * - **垂直**：用**文本项的基线**和**字体高度**算
 *   （`baseline − ascent` / `baseline + descent` → 贴合字形）
 *
 * 这样既准确，又不需要自己实现文本排版。
 */

import { measureAscentRatio } from '../text-layer/font-metrics';
import type { PositionedTextItem } from '../text-layer/layout';

/** 一个文本项在页面里的矩形（页内坐标，px） */
export interface ItemBox {
  left: number;
  /** 基线位置（页内坐标，px） */
  baseline: number;
  /** 字号（PDF 字体高度，px） */
  fontSize: number;
  fontFamily: string;
}

/**
 * 从排好版的文本项算出它的**基线**与几何。
 *
 * `PositionedTextItem.top` = `基线 − ascent`（layout.ts 里就是这么算的），
 * 所以基线要加回去。
 *
 * @param item 排好版的文本项
 * @returns 该项的几何
 */
export function itemBoxOf(item: PositionedTextItem): ItemBox {
  const ascent = item.fontSize * measureAscentRatio(item.fontFamily);
  return {
    left: item.left,
    baseline: item.top + ascent,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
  };
}

/**
 * 计算文本项的**字形垂直范围**（相对基线）。
 *
 * 用 canvas 实测的 ascent/descent（**该字体真实有的字形**），
 * 而不是 `fontSize` —— 后者会把上下都撑大。
 *
 * ⚠️ 这里用的是 `fontBoundingBox*`（字体整体），
 *    实测比真实墨迹大 2~9px（因为多数字没有降部）。
 *    对"选区框贴合"来说这个精度可以接受，且**上下对称**（视觉更整齐）。
 *
 * @param fontFamily 字体族
 * @param fontSize 字号
 * @returns 相对基线的上/下距离
 */
export function glyphExtentOf(
  fontFamily: string,
  fontSize: number,
): { above: number; below: number } {
  const ascentRatio = measureAscentRatio(fontFamily);
  // descent = fontSize − ascent（字体整体高度就是 fontSize）
  const above = fontSize * ascentRatio;
  const below = fontSize - above;
  return { above, below };
}

/**
 * 把一个浏览器的选区矩形**裁剪**成贴合字形的矩形。
 *
 * 做法：
 * - 垂直：以矩形的**中心线**为准（浏览器的行盒以基线为中心），
 *   按字形的 ascent/descent 裁剪
 * - 水平：不动（浏览器算得最准）
 *
 * ⚠️ 为什么用"中心线"而不是"顶部"：
 * 浏览器的行盒是 `[基线 − ascent', 基线 + descent']`，
 * 高度 = `fontSize × (浏览器字体的行高系数)`。
 * 我们不知道浏览器用的 ascent'，但**知道基线在哪**
 * （= 矩形中心 + 一个很小的偏移）→ 用中心线对齐最稳。
 *
 * @param rect 浏览器的选区矩形（页内坐标）
 * @param baseline 该行文字的基线（页内坐标）
 * @param glyph 字形的上/下距离
 * @returns 裁剪后的矩形
 */
export function clipRectToGlyph(
  rect: { x: number; y: number; width: number; height: number },
  baseline: number,
  glyph: { above: number; below: number },
): { x: number; y: number; width: number; height: number } {
  const glyphHeight = glyph.above + glyph.below;

  const top = baseline - glyph.above;
  const bottom = baseline + glyph.below;

  // 保险：裁剪后的高度不能超过原矩形（说明基线算错了 → 退回原矩形）
  if (glyphHeight >= rect.height || top < rect.y || bottom > rect.y + rect.height) {
    return { ...rect };
  }

  return {
    x: rect.x,
    y: top,
    width: rect.width,
    height: bottom - top,
  };
}
