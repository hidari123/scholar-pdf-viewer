/**
 * search —— **索引与渲染的"项对齐"**（修搜索高亮定位不准的关键）。
 *
 * ## 问题（用户反馈："搜索功能高亮定位不准确 这个是个bug 有的不准"）
 *
 * 搜索命中是**字符偏移**（`{pageNumber, start, length}`），
 * 要变成**矩形**必须知道"这个偏移对应哪个文字项"。
 *
 * ### 实测（真实 arXiv PDF，第 1 页）
 *
 * ```
 * 索引的项: 161 个
 * 渲染的项: 112 个
 * 第一个不同的位置: #74
 *   渲染: "(a) Unified adapter "
 *   索引: "REASONING"          ← 图里的旋转标签
 * ```
 *
 * → **下标完全对不上** → 偏移错位 → 高亮跑到别的字上 ❌
 *
 * ### 为什么会这样（两个原因）
 *
 * 1. **渲染会跳过一些项**（空项 / 定位失败 / **旋转文字**）
 *    → 旋转文字（图里的标签、页边戳）在文本层里不存在
 *    → 但**索引里还在** → 从那一点开始下标全错位
 *
 * 2. ⚠️⚠️ **pdf.js 的 `getTextContent()` 会"合并" item**
 *    → 合并与否取决于 `item.fontName` / `item.height` 等字段
 *    → 索引那次调用和渲染那次调用**如果字段不一样**
 *    → **item 的边界就不一样** → 偏移彻底错位
 *    → 实测：索引 161 项（更细）/ 渲染 112 项（更粗）→ 差 49 项！
 *
 * ## 修法：**不依赖"两边边界一致"**
 *
 * → 用**文本内容**把索引的项和渲染的项**对齐**
 *    （而不是靠下标）
 * → 索引的项文本序列 → 命中落在哪几个项上
 * → 再用**文本内容**去渲染的项里找对应的（按顺序 + 按内容）
 * → 找不到就**跳过**（宁可漏画，也不要画到错的字上）
 *
 * ⚠️ **这是"内容对齐"，不是"下标对齐"** → 两边的边界不一样也能对上 ✅
 */

/** 一页的文本项（pdf.js TextItem 的最小形状） */
export interface SearchTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

/**
 * 从 pdf.js 的 items 里挑出**可以参与搜索**的项。
 *
 * ## 判据（**必须和渲染侧一致**）
 *
 * ⚠️ **只做"静态"判据**（不依赖视口）：
 * - 有 `transform`（否则定位不了）
 * - `str` 非空（空项没有内容，也定位不到）
 *
 * ⚠️ **动态判据**（定位失败 / 旋转文字）只有渲染时才知道 →
 *   - 传了 `viewport` → 这里也能判断 → **索引和渲染完全一致** ✅
 *   - 没传 → 索引收全部 → 渲染侧靠**字符位置**兜底
 *
 * ⚠️ **不排序** → 保持 PDF 的原始顺序（索引和偏移都基于它）。
 *
 * @param items pdf.js 的文本项
 * @param options 选项（`viewport` → 也能跳过旋转文字）
 * @returns 可参与搜索的项
 */
export function selectSearchItems<T extends SearchTextItemLike>(
  items: readonly T[],
  options: {
    /** 该页的视口（给了就能跳过旋转文字 → 和渲染完全一致） */
    viewport?: { transform: number[]; scale: number; width: number; height: number };
  } = {},
): T[] {
  const result: T[] = [];

  for (const item of items) {
    // 空项 → 跳过（索引不该为它留位置）
    if (!item.str || item.str.length === 0) {
      continue;
    }
    // 没有 transform → 定位不了 → 跳过
    if (!item.transform || item.transform.length < 6) {
      continue;
    }

    /*
     * ⚠️ **旋转文字**：渲染时会跳过 → 索引也必须跳过（否则偏移错位）。
     *
     * → 需要视口才能判断 → 宿主传了 `viewport` 才生效
     */
    if (options.viewport && isRotatedItem(item, options.viewport)) {
      continue;
    }

    /*
     * ⚠️⚠️ **"定位不了"的项**：渲染时会跳过 → 索引也必须跳过。
     *
     * ### 实测（真实 arXiv PDF 的页眉 logo）
     *
     * ```
     * 搜索 "A2E" → 46 个命中，其中 3 个落在**页眉 logo**上
     * → 但那个 logo 是**图片**，文本层里**根本没有**对应的 span
     * → 高亮框画在了**空白处** → 用户看到"高亮跑到奇怪的地方" ❌
     * ```
     *
     * ### 判据（必须和渲染侧一致）
     *
     * → 渲染侧（`positionTextItem`）：`fontHeight = hypot(tx[2], tx[3])`
     *   → `fontHeight` 不是有限数或 ≤ 0 → **返回 null（不渲染）** ✅
     * → 索引侧也要用**同样的判据** ✅
     */
    if (options.viewport && !canPositionItem(item, options.viewport)) {
      continue;
    }

    result.push(item);
  }

  return result;
}

/**
 * 判定一个项**能不能被定位**（和渲染侧 `positionTextItem` 的判据一致）。
 *
 * ⚠️ **必须和渲染侧完全一致**（`core/text-layer/layout.ts`）：
 * → `fontHeight = hypot(tx[2], tx[3])`（复合矩阵的垂直分量模长）
 * → 不是有限数 或 ≤ 0 → **定位不了** → 渲染时跳过
 *
 * @param item 文本项
 * @param viewport 视口
 * @returns 能定位则 true
 */
export function canPositionItem(
  item: { transform: number[] },
  viewport: { transform: number[]; scale: number; width: number; height: number },
): boolean {
  const tx = compositeTransform(viewport.transform, item.transform);
  if (!tx) {
    return false;
  }
  const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
  return Number.isFinite(fontHeight) && fontHeight > 0;
}

/**
 * 复合矩阵：`tx = viewport.transform ∘ item.transform`。
 *
 * @param viewportTransform 视口矩阵
 * @param itemTransform 项矩阵
 * @returns 复合矩阵（长度不足 6 时返回 null）
 */
function compositeTransform(viewportTransform: number[], itemTransform: number[]): number[] | null {
  if (
    !viewportTransform ||
    viewportTransform.length < 6 ||
    !itemTransform ||
    itemTransform.length < 6
  ) {
    return null;
  }

  const m1 = viewportTransform;
  const m2 = itemTransform;

  const a = m1[0] ?? 0;
  const b = m1[1] ?? 0;
  const c = m1[2] ?? 0;
  const d = m1[3] ?? 0;
  const e = m1[4] ?? 0;
  const f = m1[5] ?? 0;

  const a2 = m2[0] ?? 0;
  const b2 = m2[1] ?? 0;
  const c2 = m2[2] ?? 0;
  const d2 = m2[3] ?? 0;
  const e2 = m2[4] ?? 0;
  const f2 = m2[5] ?? 0;

  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

/**
 * 判定一个 item 是否是**旋转文字**。
 *
 * ⚠️ **必须和渲染侧的判据一致**（`core/text-layer/layout.ts` 的 `isRotatedAngle`）。
 *
 * → 角度偏离水平超过 **1°** 就算旋转
 *
 * @param item 文本项
 * @param viewport 视口
 * @returns 是旋转文字则 true
 */
export function isRotatedItem(
  item: { transform: number[] },
  viewport: { transform: number[]; scale: number; width: number; height: number },
): boolean {
  const it = item.transform;
  const vt = viewport.transform;
  if (!it || it.length < 6 || !vt || vt.length < 6) {
    return false;
  }

  const ia = it[0] ?? 1;
  const ib = it[1] ?? 0;
  const ic = it[2] ?? 0;
  const id = it[3] ?? 1;
  const ie = it[4] ?? 0;
  const if_ = it[5] ?? 0;
  const va = vt[0] ?? 1;
  const vb = vt[1] ?? 0;
  const vc = vt[2] ?? 0;
  const vd = vt[3] ?? 1;
  const ve = vt[4] ?? 0;
  const vf = vt[5] ?? 0;

  const tx: [number, number, number, number, number, number] = [
    va * ia + vc * ib,
    vb * ia + vd * ib,
    va * ic + vc * id,
    vb * ic + vd * id,
    va * ie + vc * if_ + ve,
    vb * ie + vd * if_ + vf,
  ];

  const angle = Math.atan2(tx[1], tx[0]);
  // ⚠️ 阈值和 `layout.ts` 的 `isRotatedAngle` 保持一致（1°）
  return Math.abs(angle) > (1 * Math.PI) / 180;
}

/**
 * 把选中的项拼成整页文本。
 *
 * @param items 已筛选的项（**保持原始顺序**）
 * @returns 整页文本
 */
export function joinItemTexts(items: readonly { str: string }[]): string {
  let text = '';
  for (const item of items) {
    text += item.str;
  }
  return text;
}

/**
 * **把"索引的字符偏移"换算成"渲染的字符偏移"**。
 *
 * ## 为什么需要这一步（实测踩过的坑：搜索高亮定位不准）
 *
 * ⚠️⚠️ **命中偏移是"索引坐标系"的**，而高亮要画在"渲染的项"上。
 * → 两边的**项边界不同** → **字符总数也可能不同** → 直接用会错位 ❌
 *
 * ### 实测（真实 arXiv PDF）
 *
 * ```
 * 搜索 "A2E"
 * → 索引里 "A2E" 是一个项（3 个字符）
 * → 渲染侧 "A"、"2"、"E" 是**三个独立的项**
 * ```
 *
 * → 用"渲染侧字符偏移"直接去切渲染项 → **只切到 "A"** → 高亮框只有 1 个字符宽 ❌
 * → 用户看到的现象：**"高亮定位不准 / 只框住一部分"**
 *
 * ### 换算方法
 *
 * 1. 先算出这个偏移落在**索引的哪几个项**上（`mapOffsetToItemTexts`）
 * 2. 再用**对齐表**（渲染项 → 索引项）找到这些索引项对应的**渲染项**
 * 3. 用渲染项自己的文本长度**重新定位**偏移
 *
 * @param indexItemTexts 索引的项文本
 * @param renderedTexts 渲染的项文本
 * @param alignment 对齐表（渲染项下标 → 索引项下标，`-1` = 无对应）
 * @param start 索引里的起始偏移
 * @param length 字符数
 * @returns 渲染坐标系里的 `{start, length}`；找不到时返回 `null`
 */
export function convertIndexOffsetToRendered(
  indexItemTexts: readonly string[],
  renderedTexts: readonly string[],
  alignment: readonly number[],
  start: number,
  length: number,
): { start: number; length: number } | null {
  // ① 偏移落在索引的哪几个项上
  const inIndex = mapOffsetToItemTexts(indexItemTexts, start, length);
  if (inIndex.length === 0) {
    return null;
  }

  // ② 索引项 → 渲染项（对齐表是反的，要反过来查）
  /*
   * ⚠️ **一个索引项可能对应多个渲染项**（实测）。
   *
   * → 索引里 "A2E" 是一个项
   * → 渲染侧 "A"、"2"、"E" 是**三个**项
   * → `alignRenderedToIndex` 会把**三个都**映射到索引项 0
   * → 所以这里是 **Map<索引项, 渲染项[]>**（不是单个）✅
   */
  /** 索引项下标 → 渲染项下标列表 */
  const indexToRendered = new Map<number, number[]>();
  for (let r = 0; r < alignment.length; r += 1) {
    const i = alignment[r];
    if (i === undefined || i < 0) {
      continue;
    }
    const list = indexToRendered.get(i);
    if (list) {
      list.push(r);
    } else {
      indexToRendered.set(i, [r]);
    }
  }

  // ③ 换算成渲染坐标
  let renderedStart = -1;
  let renderedEnd = -1;

  for (const { index, offsetInItem, charsInItem } of inIndex) {
    const renderedIndices = indexToRendered.get(index);
    if (!renderedIndices) {
      continue;
    }

    for (const renderedIndex of renderedIndices) {
      const renderedText = renderedTexts[renderedIndex];
      if (renderedText === undefined) {
        continue;
      }

      // 渲染项在渲染坐标系里的起点
      let cursor = 0;
      for (let r = 0; r < renderedIndex; r += 1) {
        cursor += renderedTexts[r]?.length ?? 0;
      }

      const from = cursor + offsetInItem;
      /*
       * ⚠️ **必须裁到渲染项自己的长度**（实测）。
       *
       * → 索引的项可能**比渲染的项长**（"A2E" vs "A"）
       * → 不裁 → 换算出的长度**超出渲染项** → 画到别的字上 ❌
       */
      const to = Math.min(from + charsInItem, cursor + renderedText.length);

      if (renderedStart < 0 || from < renderedStart) {
        renderedStart = from;
      }
      if (to > renderedEnd) {
        renderedEnd = to;
      }
    }
  }

  if (renderedStart < 0 || renderedEnd <= renderedStart) {
    return null;
  }

  return { start: renderedStart, length: renderedEnd - renderedStart };
}

/**
 * **字符偏移 → 索引的项下标**。
 *
 * @param itemTexts 索引用的项文本（顺序 = 索引顺序）
 * @param start 起始偏移
 * @param length 字符数
 * @returns 命中的项下标 + 项内偏移
 */
export function mapOffsetToItemTexts(
  itemTexts: readonly string[],
  start: number,
  length: number,
): { index: number; offsetInItem: number; charsInItem: number }[] {
  const result: { index: number; offsetInItem: number; charsInItem: number }[] = [];
  const rangeStart = start;
  const rangeEnd = start + length;

  let cursor = 0;

  for (let index = 0; index < itemTexts.length; index += 1) {
    const text = itemTexts[index];
    if (text === undefined) {
      continue;
    }
    const itemStart = cursor;
    const itemEnd = cursor + text.length;
    cursor = itemEnd;

    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      continue;
    }

    const from = Math.max(rangeStart, itemStart);
    const to = Math.min(rangeEnd, itemEnd);

    result.push({
      index,
      offsetInItem: from - itemStart,
      charsInItem: to - from,
    });
  }

  return result;
}

/**
 * **把索引的项和渲染的项按"文本内容"对齐**。
 *
 * ## 为什么要这一步（实测踩过的坑）
 *
 * ```
 * 索引的项（更细，161 个）: ["Fig ", "REASONING", " caption", ...]
 * 渲染的项（更粗，112 个）: ["Fig ", "REASONING caption", ...]   ← 合并了！
 * ```
 *
 * → **下标对不上**（第 1 项就不同）
 * → 但**文本能对上**（"REASONING" 在 "REASONING caption" 里）
 *
 * ## 做法
 *
 * 对每个**渲染项**，找出它在**索引项序列**里的位置：
 * 1. 先试**完全相同**的项（按顺序往前找 → 快且准）
 * 2. 找不到就试**包含**它的索引项（渲染侧合并了 → 索引项被吞掉）
 * 3. 都没有 → 这个渲染项没有对应的索引项 → 记为"无偏移"
 *
 * @param indexItemTexts 索引的项文本（顺序 = 索引顺序）
 * @param renderedTexts 渲染的项文本（顺序 = 渲染顺序）
 * @returns 每个渲染项 → 索引里的位置（`-1` = 没有对应）
 */
export function alignRenderedToIndex(
  indexItemTexts: readonly string[],
  renderedTexts: readonly string[],
): number[] {
  const result: number[] = new Array<number>(renderedTexts.length).fill(-1);

  /** 索引里已经用过的项（避免重复匹配） */
  const used = new Set<number>();

  /*
   * ⚠️⚠️ **两遍扫描**（实测踩过的坑：搜索高亮只框住一部分）。
   *
   * ### 为什么不能一遍搞定
   *
   * ```
   * 索引的项: ["A2E", ...]
   * 渲染的项: ["A", "2", "E", ...]
   * ```
   *
   * → 渲染项 "A"：
   *   - 规则 ②（索引项**包含**渲染项）："A2E" 包含 "A" → 匹配 ✅
   *   - 规则 ③（渲染项**包含**索引项）："A" 不包含任何索引项 → 不匹配
   *
   * → 渲染项 "2"：
   *   - 规则 ②：**还是** "A2E" → 匹配 ✅（但它已经被"占用"了！）
   *
   * → 一遍扫描 → "A" 占用��索引项 0 → "2" 找不到 → **高亮只框住 "A"** ❌
   *
   * ### 两遍扫描的分工
   *
   * - **第 1 遍**：只做**完全相同**的匹配 → 精确、无歧义
   * - **第 2 遍**：剩下的用"包含"关系兜底 → **不占用**索引项
   *   → 多个渲染项可以属于同一个索引项 ✅
   */
  for (let r = 0; r < renderedTexts.length; r += 1) {
    const text = renderedTexts[r];
    if (text === undefined || text.length === 0) {
      continue;
    }

    for (let i = 0; i < indexItemTexts.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      if (indexItemTexts[i] === text) {
        used.add(i);
        result[r] = i;
        break;
      }
    }
  }

  // 第 2 遍：包含关系兜底（**不占用**索引项）
  for (let r = 0; r < renderedTexts.length; r += 1) {
    const existing = result[r];
    if (existing !== undefined && existing >= 0) {
      continue;
    }

    const text = renderedTexts[r];
    if (text === undefined || text.length === 0) {
      continue;
    }

    // ② 索引项**包含**渲染项（索引侧合并了）
    for (let i = 0; i < indexItemTexts.length; i += 1) {
      const candidate = indexItemTexts[i];
      if (candidate?.includes(text) && text.length > 0) {
        result[r] = i;
        break;
      }
    }

    // ③ 渲染项**包含**索引项（渲染侧合并了）
    const afterRule2 = result[r];
    if (afterRule2 === undefined || afterRule2 < 0) {
      for (let i = 0; i < indexItemTexts.length; i += 1) {
        const candidate = indexItemTexts[i];
        if (candidate && text.includes(candidate) && candidate.length > 0) {
          result[r] = i;
          break;
        }
      }
    }
  }

  return result;
}

/**
 * **把"索引偏移"直接映射到"渲染项"**（不看项的边界）。
 *
 * ## 为什么（实测踩过的坑：搜索高亮定位不准）
 *
 * 索引的项和渲染的项**边界不同**，但**拼起来的文本完全一样**：
 * ```
 * 索引（161 项）: ["—", "--", " ", "上海人工智能实验室", …]
 * 渲染（112 项）: ["--", "—", " ", "上海人工智能实验室", …]
 * ```
 * → **文本一样，只是切分的位置不同**
 * → 所以最稳的办法：**按字符位置**在渲染侧找
 *
 * ## 做法
 *
 * 1. 把渲染的项按**字符数**累加 → 每个项覆盖一段字符区间
 * 2. 命中的字符偏移落在哪一段 → 就是哪个渲染项
 * 3. 项内的偏移 = 命中起点 - 该项的起点
 *
 * ⚠️ **不依赖索引的项边界** → 两边切分不同也不影响 ✅
 *
 * @param renderedTexts 渲染的项文本（顺序 = 渲染顺序）
 * @param start 起始字符偏移（**基于索引文本**）
 * @param length 字符数
 * @returns 命中的渲染项下标 + 项内偏移
 */
export function mapOffsetToRenderedByText(
  renderedTexts: readonly string[],
  start: number,
  length: number,
): { index: number; offsetInItem: number; charsInItem: number }[] {
  const result: { index: number; offsetInItem: number; charsInItem: number }[] = [];
  const rangeStart = start;
  const rangeEnd = start + length;

  let cursor = 0;

  for (let index = 0; index < renderedTexts.length; index += 1) {
    const text = renderedTexts[index];
    if (text === undefined) {
      continue;
    }
    const itemStart = cursor;
    const itemEnd = cursor + text.length;
    cursor = itemEnd;

    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      continue;
    }

    const from = Math.max(rangeStart, itemStart);
    const to = Math.min(rangeEnd, itemEnd);

    result.push({
      index,
      offsetInItem: from - itemStart,
      charsInItem: to - from,
    });
  }

  return result;
}

/**
 * 一个渲染项对应的"索引偏移"。
 *
 * ⚠️ **这是对齐的关键**（实测踩过的坑：搜索高亮定位不准）。
 */
export interface IndexOffset {
  /** 该项在**索引文本**里的起始字符偏移 */
  start: number;
  /** 该项的字符数 */
  length: number;
}

/**
 * **字符偏移 → 渲染项下标**（用"对齐表"）。
 *
 * @param indexOffsets 每个渲染项的索引偏移（`start = -1` 表示没有）
 * @param start 起始字符偏移
 * @param length 字符数
 * @returns 命中的渲染项下标 + 项内偏移
 */
export function mapOffsetToRendered(
  indexOffsets: readonly IndexOffset[],
  start: number,
  length: number,
): { index: number; offsetInItem: number; charsInItem: number }[] {
  const result: { index: number; offsetInItem: number; charsInItem: number }[] = [];
  const rangeStart = start;
  const rangeEnd = start + length;

  for (let index = 0; index < indexOffsets.length; index += 1) {
    const offset = indexOffsets[index];
    if (!offset || offset.start < 0) {
      continue;
    }

    const itemStart = offset.start;
    const itemEnd = offset.start + offset.length;

    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      continue;
    }

    const from = Math.max(rangeStart, itemStart);
    const to = Math.min(rangeEnd, itemEnd);

    result.push({
      index,
      offsetInItem: from - itemStart,
      charsInItem: to - from,
    });
  }

  return result;
}
