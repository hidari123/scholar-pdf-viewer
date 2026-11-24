/**
 * 按**拖动范围**过滤选区矩形（纯计算，零 DOM）。
 *
 * ## 问题（实测，真实 arXiv PDF）
 *
 * PDF 的页边戳是**逐字符竖排**的（`left=1231`，每行一个字符）：
 *
 * ```
 * 正文   x = 175 ~ 445
 * 页边戳 x = 1231        ← 和正文**同一行**（top 相同）
 * ```
 *
 * 浏览器按**视觉行**选中同一行的所有 inline box →
 * 页边戳的字符虽然离正文 **1000px**，却被**一起选中**。
 *
 * 实测（拖选正文 175~445）：
 *
 * ```
 * clientRects = [
 *   { l: 175.4,  t: 222.5, w: 45.1, h: 15.6 },   ← 正文
 *   { l: 220.5,  t: 222.5, w:  4.6, h: 15.6 },   ← 正文
 *   { l: 366.0,  t: 222.5, w: 79.0, h: 15.6 },   ← 正文
 *   { l: 1225.9, t: 210.9, w:  9.9, h: 16.9 },   ← 页边戳（离正文 1000px）
 * ]
 * ```
 *
 * → 自绘层把页边戳也画出来 → **选区横跨整页**（Δ左 = 1050px）。
 *
 * ## 修法
 *
 * 用**水平连续性**把矩形分成"列"，只保留**和用户拖动范围重叠**的列：
 *
 * 1. 把所有矩形按水平区间排序，**相邻且间隙 ≤ MAX_COLUMN_GAP** 的归为同一列
 * 2. 拖动范围 = `[min(起点x, 终点x), max(起点x, 终点x)]`
 * 3. 保留**和拖动范围有重叠**的列
 *
 * - 页边戳（1226）和拖动范围（278~432）**不重叠** → 丢掉 ✓
 * - 正文（175~445）和拖动范围**重叠** → 保留 ✓
 * - 两栏排版 → 拖左栏只选左栏 ✓
 *
 * ⚠️ **不能只看起点**（实测踩过的坑）：
 * 只看起点会丢掉拖动范围**右边**的文字（用户明明拖过去了）。
 */

/** 一个矩形（视口坐标） */
export interface ClientRectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 两列之间的**最大间隙**（px）。
 *
 * ⚠️ 必须**远大于**一个字符的宽度（~10px），
 *    但**小于**两栏之间的典型间距（~50px+）。
 *
 * → 100px：
 *   - 能容忍**选中的文字里的空格**（实测正文里有个 89px 的空隙！）
 *   - 又能把"另一列"（几百 px）分开（实测页边戳离正文 780px）
 */
export const MAX_COLUMN_GAP = 100;

/**
 * **判定"离群矩形"的距离阈值**（px）。
 *
 * ## 要解决的两个矛盾（实测踩过的坑）
 *
 * 浏览器会把选区**扩展到行首 / 词边界 / 行尾**：
 * ```
 * 拖动:  x=487 → 607
 * 选区:  x=108 → 1242     ← 浏览器把整行都包进来了（左边差 380px，右边差 635px！）
 * ```
 *
 * → 如果按"拖动范围"严格过滤 → **整行的两端全被丢掉**
 * → 用户看到的现象就是"**多行选择时中间有的没有底色**"
 *   （实测：26 个被选中的 span 里有 **9 个漏选**）。
 *
 * 但页边戳（另一个"离群"）离正文 **780px** → 必须丢掉。
 *
 * → 用一个**中间值**区分：
 * - 行首 / 行尾扩展（~380~640px）→ **保留**（它是用户选的那一行的一部分）
 * - 页边戳（~780px）→ **丢掉**（它根本不是那一行的内容）
 *
 * → 阈值 **450px** —— ⚠️ 但这个值**太小**，实测会漏掉行尾（635px）！
 *    → 见 `filterByDragOrigin` 的新实现（改成按**行的连续性**判断）。
 */
export const OUTLIER_DISTANCE = 450;

/**
 * **同一个"视觉行"内的最大空隙**（px）。
 *
 * ⚠️ **用来区分"同一行的延伸"和"另一个元素"**。
 *
 * ## 实测数据（真实 PDF，扫了 6 页共 1478 个 span 间隙）
 *
 * ```
 *   0- 49px: 1302 个   ← 正常词距
 *  50- 99px:   91 个   ← 两端对齐的宽词距
 * 100-149px:   28 个
 * 150-199px:    6 个
 * 250-399px:    3 个
 * ──────────────────── ← **这里有个明显的断层**
 * 750-799px:    6 个   ← 页边戳（逐字符竖排）
 * 800-849px:    6 个
 * 850-899px:   12 个
 * 900-949px:   24 个
 * ```
 *
 * → **正常文字的词距最大 ~200px**，而页边戳是 **750px+**
 * → 中间有**明显的断层** → 阈值取 **400px**（在断层中间，很安全）
 */
export const MAX_SAME_LINE_GAP = 400;

/**
 * **垂直方向的容差**（px）。
 *
 * ⚠️ **必须有**（实测踩到的坑）：
 * -> 起点那一行的**字形盒**可能比鼠标按下的位置**略高** ❌
 * -> 不留容差 -> **起点那行没高亮** ❌
 * -> 20px 足够（一个行高）✅
 */
export const VERTICAL_TOLERANCE = 20;

/**
 * 按**拖动范围**过滤矩形（只丢"离群"的）。
 *
 * ## ⚠️ 实测踩过的坑（这是最隐蔽的一个 bug）
 *
 * ### 旧实现（距离阈值）
 *
 * ```ts
 * // ❌ 按"离得太远才丢"
 * const gap = rect.left > to ? rect.left - to : rectRight < from ? from - rectRight : 0;
 * return gap <= OUTLIER_DISTANCE;   // 450px
 * ```
 *
 * ### 实测（真实 PDF 的 figure caption，用户截图）
 *
 * ```
 * 拖动:  x=171 → 471
 * 选区:  x=166 → 1242       ← 浏览器把**整行**都选上了
 *
 * 漏掉的 span（9 个）：
 *   944,1530 " "            ← 距拖动终点 473px
 *   953,1530 "(a)"          ← 距拖动终点 482px
 *   985,1530 "An Agent Task Protocol"  ← 距拖动终点 514px
 *   1066,1598 "correctness" ← 距拖动终点 595px
 *   166,1621 "only about 0.42–0.77…"   ← **整行都没了**（距 471px 远）
 * ```
 *
 * → **473px > 450px 阈值** → 被丢掉 → **行尾整段没底色** ❌
 * → 用户看到的现象："**多行选择时中间有的没有底色**"
 *
 * ### 新实现（按"行的连续性"）
 *
 * **判据**：矩形和拖动范围之间，如果**只隔着正常的字距**（≤ 60px）
 * → 它是**同一个视觉行的延伸** → **保留**
 * → 如果**隔着一个巨大的空洞**（> 60px）→ 是**另一个东西** → 丢掉
 *
 * ```
 * 行尾的 "An Agent Task Protocol"：和拖动终点之间隔着 "grid. (a) " ≈ 30px → 保留 ✅
 * 页边戳：和正文之间隔着 ~780px 的空洞 → 丢掉 ✅
 * ```
 *
 * → **不再依赖任何距离阈值** → 行尾多远都保留 ✅
 *
 * @param rects 浏览器给的 client rects
 * @param drag 拖动范围（起点 + 终点，视口坐标）；没有则原样返回
 * @returns 过滤后的矩形
 */
export function filterByDragOrigin(
  rects: ClientRectLike[],
  drag: { startX: number; endX: number; startY?: number; endY?: number } | null,
  maxRectHeight?: number,
): ClientRectLike[] {
  // 没有拖动范围 → 不过滤（保守：宁可多画，也不要画不出来）
  if (!drag || rects.length <= 1) {
    return rects;
  }

  /*
   * ⚠️⚠️ **先按【垂直方向】过滤**（跨页选择的关键，实测踩到的坑）。
   *
   * ### 问题（用户反馈）
   *
   * > "跨页选择高亮的时候 实测只能高亮第一页的内容
   * >  第二页的内容也高亮到了第一页"
   *
   * ### 实测
   *
   * -> 从第 1 页**最后一行**往下拖到第 2 页 ✅
   * -> 浏览器**自动滚动**（鼠标拖到容器外）✅
   * -> 滚动后 Range 被**向前扩展到了页首** ❌
   *    -> 选区长度 **1726** 字符（本来只有 ~84）❌
   *    -> 矩形里有**整页**的（top=-3028, height=1822）❌
   *    -> 选区文字从**页眉**（"上海人工智能实验室"）开始 ❌
   * -> -> 高亮时**全落在第 1 页** ❌
   *
   * ### 修法
   *
   * -> 只保留**和拖动的垂直范围有重叠**的矩形 ✅
   * -> 拖动起点在第 1 页底部 -> 页首的矩形**在拖动范围之外** -> 丢掉 ✅
   *
   * ⚠️ **要留一点容差**（`VERTICAL_TOLERANCE`）✅
   * -> 起点那一行**可能略高于**起点（字形盒比行盒小）❌
   * -> 不留容差 -> **起点那行的高亮没了** ❌
   */
  if (typeof drag.startY === 'number' && typeof drag.endY === 'number') {
    const fromY = Math.min(drag.startY, drag.endY) - VERTICAL_TOLERANCE;
    const toY = Math.max(drag.startY, drag.endY) + VERTICAL_TOLERANCE;
    const inRangeRaw = rects.filter((rect) => {
      const rectTop = rect.top;
      const rectBottom = rect.top + rect.height;
      return rectBottom > fromY && rectTop < toY;
    });
    /*
     * ⚠️⚠️ **同时丢掉"整页"的矩形**（实测踩到的坑）。
     *
     * -> 浏览器的 Range 跨页时会给一个**整页**的矩形 ❌
     *    -> 比如 `{top: -3028, height: 1822, left: 17}`（整页）❌
     * -> 它的**垂直范围覆盖整页** -> 垂直过滤**留不住它** ❌
     *    -> 但它的**水平范围**也覆盖整页 -> 水平过滤会**以它为准** ❌
     *    -> -> 结果：**真正的正文被丢掉**，留下的是整页矩形 ❌
     *    -> -> 高亮画成一整页 ❌
     *
     * -> 判据：**高度超过页面高度的 1/3** -> 一定是整页/旋转项 ❌
     *    -> 和 `useTextSelection` 里已有的"旋转文字"过滤一致 ✅
     */
    const maxNormalHeight =
      maxRectHeight !== undefined && maxRectHeight > 0 ? maxRectHeight / 3 : Infinity;
    const inRange = inRangeRaw.filter((rect) => rect.height <= maxNormalHeight);

    // 全过滤掉了 -> 说明拖动范围有问题 -> 保守起见**保留原来的** ✅
    if (inRange.length > 0) {
      rects = inRange;
    }
  }

  // 拖动的水平范围（用户从左往右拖，或从右往左拖）
  const from = Math.min(drag.startX, drag.endX);
  const to = Math.max(drag.startX, drag.endX);

  /*
   * ⚠️ **按"视觉行"分组**。
   *
   * 浏览器的选区在**同一行内是连续的** → 同一行的矩形应该一起保留 / 一起丢掉。
   *
   * ⚠️ **分组的 key 必须用 `top`，不能用"中点"**（实测踩过的坑）。
   *
   * 浏览器的每个 span 会给**两个** rect：
   * ```
   * 166,1526 106x27   ← 行盒（高 27）
   * 166,1530 106x21   ← 字形盒（高 21）
   * ```
   * → 它们的**中点**差 5px → 用中点分组 → **同一行被拆成两个组** ❌
   * → 后果：行首的延伸和正文分到两组 → **互相看不到 → 行首被丢掉**
   *
   * → 用 `top`（同一行的 top 最多差 4px）→ 但还是要留容差 → **用 top 分桶**，
   *   再把**垂直重叠**的桶合并。
   */
  const rows: ClientRectLike[][] = [];

  for (const rect of rects) {
    // 找和它**垂直重叠**的行 → 加进去；否则新开一行
    let target: ClientRectLike[] | undefined;
    for (const row of rows) {
      const first = row[0];
      if (!first) {
        continue;
      }
      const rowTop = Math.min(...row.map((r) => r.top));
      const rowBottom = Math.max(...row.map((r) => r.top + r.height));
      const overlaps = rect.top < rowBottom && rect.top + rect.height > rowTop;
      if (overlaps) {
        target = row;
        break;
      }
    }
    if (target) {
      target.push(rect);
    } else {
      rows.push([rect]);
    }
  }

  const result: ClientRectLike[] = [];

  for (const rowRects of rows) {
    // 按 left 排序（→ 相邻的两个矩形之间的"空隙"就是分段点）
    const sorted = [...rowRects].sort((a, b) => a.left - b.left);

    /*
     * **合并相邻的矩形**（间距 ≤ `MAX_SAME_LINE_GAP` 就算同一段）。
     *
     * → 得到若干"段"（segment），每段是一串连续的矩形。
     */
    const segments: ClientRectLike[][] = [];
    let current: ClientRectLike[] = [];
    let currentRight = Number.NEGATIVE_INFINITY;

    for (const rect of sorted) {
      if (current.length === 0) {
        current = [rect];
        currentRight = rect.left + rect.width;
        continue;
      }
      if (rect.left - currentRight <= MAX_SAME_LINE_GAP) {
        // 和上一段挨得够近 → 同一段
        current.push(rect);
        currentRight = Math.max(currentRight, rect.left + rect.width);
      } else {
        // 隔着一个空洞 → 断开
        segments.push(current);
        current = [rect];
        currentRight = rect.left + rect.width;
      }
    }
    if (current.length > 0) {
      segments.push(current);
    }

    /*
     * **找出"核心段"** = 和拖动范围有重叠的段。
     */
    const coreSegments = segments.filter((segment) => {
      const segLeft = segment[0]?.left ?? 0;
      const segRight = Math.max(...segment.map((r) => r.left + r.width));
      return segLeft <= to && segRight >= from;
    });

    // 没有核心段 → 整行都不属于这次选择 → 丢掉
    if (coreSegments.length === 0) {
      continue;
    }

    /*
     * **保留核心段 + 和核心段"挨得够近"的段**。
     *
     * ⚠️ **不能只看"和拖动范围的距离"**（实测踩过的坑）：
     * → 行尾的 "An Agent Task Protocol" 离拖动终点 **514px**
     * → 按距离判断 → 被丢掉 → **行尾整段没底色** ❌
     *
     * → 正确判据：**段和段之间的空隙**（不是段和拖动范围的距离）
     * → 浏览器扩展出来的部分，段之间只隔着**正常字距**（~10~30px）
     * → 真正的"另一个元素"（页边戳）隔着一个**巨大的空洞**（~780px）
     */
    const keep = new Set<ClientRectLike>();
    for (const segment of coreSegments) {
      for (const rect of segment) {
        keep.add(rect);
      }
    }

    // 反复扩展：只要有段和"已保留的边界"挨得够近 → 也保留
    let changed = true;
    while (changed) {
      changed = false;
      for (const segment of segments) {
        if (segment.every((r) => keep.has(r))) {
          continue; // 已经保留了
        }
        const segLeft = segment[0]?.left ?? 0;
        const segRight = Math.max(...segment.map((r) => r.left + r.width));

        // 和"已保留的矩形"的最小间隙
        let minGap = Number.POSITIVE_INFINITY;
        for (const kept of keep) {
          const keptRight = kept.left + kept.width;
          const gap =
            segLeft > keptRight
              ? segLeft - keptRight
              : kept.left > segRight
                ? kept.left - segRight
                : 0;
          minGap = Math.min(minGap, gap);
        }

        if (minGap <= MAX_SAME_LINE_GAP) {
          for (const rect of segment) {
            keep.add(rect);
          }
          changed = true;
        }
      }
    }

    result.push(...keep);
  }

  return result;
}
