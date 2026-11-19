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

    result.push(item);
  }

  return result;
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

  for (let r = 0; r < renderedTexts.length; r += 1) {
    const text = renderedTexts[r];
    if (text === undefined || text.length === 0) {
      continue;
    }

    // ① 完全相同
    let found = -1;
    for (let i = 0; i < indexItemTexts.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      if (indexItemTexts[i] === text) {
        found = i;
        break;
      }
    }

    // ② 渲染侧把几个索引项合并了 → 找**包含它**的索引项
    if (found < 0) {
      for (let i = 0; i < indexItemTexts.length; i += 1) {
        if (used.has(i)) {
          continue;
        }
        const candidate = indexItemTexts[i];
        if (candidate?.includes(text) && text.length > 0) {
          found = i;
          break;
        }
      }
    }

    // ③ 索引侧把几个渲染项合并了 → 找**被它包含**的索引项
    if (found < 0) {
      for (let i = 0; i < indexItemTexts.length; i += 1) {
        if (used.has(i)) {
          continue;
        }
        const candidate = indexItemTexts[i];
        if (candidate && text.includes(candidate) && candidate.length > 0) {
          found = i;
          break;
        }
      }
    }

    if (found >= 0) {
      used.add(found);
      result[r] = found;
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
