/**
 * 页面内注入：**画布墨迹探针**。
 *
 * 目的：找出"文字实际画在哪"（ground truth），用来检验选区/高亮准不准。
 *
 * ## 为什么需要它
 *
 * 浏览器自己的选区 rect 高度 = 字体的**自然行盒**（比文字本身高 30%）
 * → 拿它当基准会得出"偏了 7px"的假结论（之前踩过这个坑）。
 *
 * pdf.js 把文字画在 canvas 上 → **canvas 的像素位置就是文字的真实位置**。
 * → 扫 canvas 像素，找出墨迹的包围盒 = ground truth。
 */
export const PROBE_SOURCE = `
window.__pdfInkProbe = function (canvas, selRects) {
  if (!canvas || !selRects || selRects.length === 0) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const cw = canvas.width;
  const ch = canvas.height;

  // 选区矩形是"页内坐标" → 换成 canvas 像素坐标
  const cr = canvas.getBoundingClientRect();
  const scaleX = cw / cr.width;
  const scaleY = ch / cr.height;

  const toCssX = (v) => v / scaleX;
  const toCssY = (v) => v / scaleY;

  /*
   * 判定"墨"：像素不是纯白。
   * PDF 页面背景是白色 → 文字是深色 → 亮度 < 200 算有墨。
   */
  const isInk = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000 < 200;

  /*
   * ⚠️⚠️ **必须按"行"分别扫描**，不能把整个包围盒的墨迹都算进来。
   *
   * 选区矩形是**逐行**的（每行一个 rect）→ 如果把多行的墨迹合起来算
   * → 上下相邻行的字也会被算进去 → Δ上/Δ下 会假得离谱。
   *
   * → 对**每个选区矩形**单独扫描它**自己那一行**的墨迹，
   *   然后把各行的结果合并（取 min/max）。
   */
  const rowInk = [];

  for (const rect of selRects) {
    const rx0 = Math.max(0, Math.floor(rect.x * scaleX) - 2);
    const ry0 = Math.max(0, Math.floor(rect.y * scaleY) - 2);
    const rx1 = Math.min(cw, Math.ceil((rect.x + rect.w) * scaleX) + 2);
    const ry1 = Math.min(ch, Math.ceil((rect.y + rect.h) * scaleY) + 2);
    const rw = rx1 - rx0;
    const rh = ry1 - ry0;
    if (rw <= 0 || rh <= 0) continue;

    /*
     * ⚠️ **只扫"中间带"**（rect 垂直方向的 25%~75%）。
     *
     * 选区矩形是 **em 盒**（= fontSize），比实际字形高
     * → 上下的空白里可能有**相邻行**的字（尤其行距小时）
     * → 扫整个矩形会把相邻行的墨迹算进来 → Δ上/Δ下 假得离谱。
     *
     * → 只取中间带（一定是本行的字形）。
     */
    const bandTop = Math.floor(rh * 0.25);
    const bandBottom = Math.ceil(rh * 0.75);

    const rowData = ctx.getImageData(rx0, ry0, rw, rh).data;
    let rl = Infinity;
    let rr = -Infinity;
    let rt = Infinity;
    let rb = -Infinity;
    let count = 0;

    for (let y = bandTop; y < bandBottom; y++) {
      for (let x = 0; x < rw; x++) {
        const i = (y * rw + x) * 4;
        if (isInk(rowData[i], rowData[i + 1], rowData[i + 2])) {
          count++;
          if (x < rl) rl = x;
          if (x > rr) rr = x;
          if (y < rt) rt = y;
          if (y > rb) rb = y;
        }
      }
    }

    if (count > 0) {
      rowInk.push({
        left: toCssX(rl + rx0),
        right: toCssX(rr + rx0 + 1),
        top: toCssY(rt + ry0),
        bottom: toCssY(rb + ry0 + 1),
        count,
      });
    }
  }

  if (rowInk.length === 0) return null;

  /*
   * ⚠️ **逐行返回**（不要合并）。
   *
   * 选区可能**跨多行**（每行一个 rect）→ 合并后的"墨迹范围"是整块
   * → 拿它和单个 rect 比 → Δ上/Δ下 假得离谱。
   *
   * → 每行单独给出（测试里逐行比）。
   */
  return {
    rows: rowInk.map((r) => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      count: r.count,
    })),
    // 合并范围（仅作参考）
    left: Math.min(...rowInk.map((r) => r.left)),
    right: Math.max(...rowInk.map((r) => r.right)),
    top: Math.min(...rowInk.map((r) => r.top)),
    bottom: Math.max(...rowInk.map((r) => r.bottom)),
    // 选区矩形的合并范围
    selLeft: toCssX(
      selRects.reduce((m, r) => Math.min(m, r.x), Infinity) * scaleX,
    ),
    selRight: toCssX(
      selRects.reduce((m, r) => Math.max(m, r.x + r.w), -Infinity) * scaleX,
    ),
    selTop: toCssY(
      selRects.reduce((m, r) => Math.min(m, r.y), Infinity) * scaleY,
    ),
    selBottom: toCssY(
      selRects.reduce((m, r) => Math.max(m, r.y + r.h), -Infinity) * scaleY,
    ),
    inkCount: rowInk.reduce((s, r) => s + r.count, 0),
  };
};
`;
