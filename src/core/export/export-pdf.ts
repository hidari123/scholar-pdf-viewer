/**
 * 导出**带高亮的 PDF**。
 *
 * ## 为什么 pdf-lib 是"可选依赖"
 *
 * 包的边界（v2 原则）：**只做 PDF 相关的、纯前端的事**。
 * 但"写 PDF 文件"需要 PDF 读写库（pdf-lib / pdfkit …）——
 * 大多数宿主**用不到**导出功能（只看不改）。
 *
 * → `pdf-lib` 做成 **optional peerDependency** + **动态 import**
 * → 不用导出的宿主：**不用装**（那段代码根本不会被加载 → 0 体积）
 * → 用导出的宿主：装一个 `pdf-lib` 即可（`npm i pdf-lib`）
 *
 * ## 写什么
 *
 * 写的是**真正的 PDF 高亮批注**（`/Subtype /Highlight`）：
 * - Acrobat / Preview / Chrome / Edge 打开 → **能看到彩色高亮**
 * - 批注里带原文（`/Contents`）→ 点开能看到文字
 * - 是**标准 PDF 特性**，不是私有格式 → 别的软件也认
 */

import type { HighlightLike, PdfAnnot } from '../highlight/annotations';
import { highlightsToPdfAnnots } from '../highlight/annotations';

/** PDF 点坐标 bbox：[x1, y1, x2, y2]（原点在左下、y 向上） */
export type { PdfBbox } from '../highlight/annotations';

/** 高亮的最小形状（导出用） */
export type ExportHighlightLike = HighlightLike;

/** 每页的**点尺寸**（72dpi，如 A4 = 595 × 842） */
export type PageSizePt = { width: number; height: number };

/**
 * 语义色 → RGB（0~1）。
 *
 * ⚠️ **必须和包内的调色板一致**（`core/highlight/palette.ts`），
 *    否则导出的高亮颜色和屏幕上不一样。
 */
const COLOR_RGB: Record<string, [number, number, number]> = {
  yellow: [1, 0.92, 0.23],
  green: [0.55, 0.87, 0.55],
  blue: [0.55, 0.75, 0.95],
  pink: [0.98, 0.65, 0.78],
  purple: [0.79, 0.7, 0.93],
  orange: [0.98, 0.75, 0.45],
};

/** 未知色 → 黄色 */
const FALLBACK_RGB: [number, number, number] = [1, 0.92, 0.23];

/**
 * 颜色 key → RGB。
 *
 * @param color 语义色 key（`yellow` / `green` / …）；也接受 `#rrggbb`
 */
export function colorToRgb(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length >= 6) {
      return [
        Number.parseInt(full.slice(0, 2), 16) / 255,
        Number.parseInt(full.slice(2, 4), 16) / 255,
        Number.parseInt(full.slice(4, 6), 16) / 255,
      ];
    }
  }
  return COLOR_RGB[color] ?? FALLBACK_RGB;
}

/** `pdf-lib` 的最小形状（只要用到的部分） */
export interface PdfLibLike {
  PDFDocument: {
    load(data: ArrayBuffer): Promise<PdfDocLike>;
  };
  /**
   * `PDFContext`（pdf-lib 内部用来建对象的）。
   *
   * ⚠️ **必须有它** → 我们要**手写批注字典**（`/QuadPoints` 只能这么写）。
   */
  PDFName: { of(name: string): unknown };
  PDFNumber: { of(value: number): unknown };
  PDFArray: { withContext(context: unknown): PdfArrayLike };
  /**
   * ⚠️ **必须用 `fromText`，不能用 `of`**（实测踩过的坑：hover 出现乱码批注）。
   *
   * ```
   * PDFHexString.of('中文测试')      → <中文测试>        ← ❌ 乱码
   * PDFHexString.fromText('中文测试') → <FEFF4E2D65876D…>  ←  UTF-16BE + BOM
   * ```
   *
   * → `of` 把字符串**当原始字节**写进 PDF
   * → 阅读器按 **PDFDocEncoding** 解码 → 中文全变乱码
   * → `fromText` 会做 **UTF-16BE + BOM** 编码 → 阅读器能正确识别
   */
  PDFHexString: { of(value: string): unknown; fromText?(value: string): unknown };
  PDFString: { of(value: string): unknown };
  PDFDict: { withContext(context: unknown): PdfDictLike };
}

/** pdf-lib 的文档（最小形状） */
interface PdfDocLike {
  getPages(): PdfPageLike[];
  context: PdfContextLike;
  save(): Promise<Uint8Array>;
}

/** pdf-lib 的上下文（最小形状） */
interface PdfContextLike {
  obj(value: unknown): unknown;
  register(obj: unknown): unknown;
  withContext?: unknown;
}

/** pdf-lib 的数组（最小形状） */
interface PdfArrayLike {
  push(...values: unknown[]): void;
  asRectangle(): number[];
}

/** pdf-lib 的字典（最小形状） */
interface PdfDictLike {
  set(key: unknown, value: unknown): void;
  setRectangle(key: unknown, value: number[]): void;
}

/** pdf-lib 的页（最小形状） */
interface PdfPageLike {
  node: PdfPageNodeLike;
}

/** pdf-lib 的页节点（最小形状） */
interface PdfPageNodeLike {
  set(key: unknown, value: unknown): void;
  setRectangle?(key: unknown, value: number[]): void;
  getAnnots?(): unknown[];
  setAnnots?(annots: unknown[]): void;
}

/** 导出参数 */
export interface ExportHighlightedPdfOptions {
  /** 原始 PDF 的字节（`Uint8Array` / `ArrayBuffer`） */
  pdfBytes: Uint8Array | ArrayBuffer;
  /** 高亮列表 */
  highlights: readonly ExportHighlightLike[];
  /** 每页的点尺寸（72dpi） */
  pageSizesPt: readonly PageSizePt[];
  /**
   * `pdf-lib` 的模块（可选）。
   *
   * ⚠️ **不传就动态 import**（`import('pdf-lib')`）。
   * → 宿主可以自己控制版本 / 打包方式（比如 Vite 的 `optimizeDeps`）。
   */
  pdfLib?: PdfLibLike;
  /**
   * 高亮的不透明度（0~1，默认 0.4）。
   *
   * ⚠️ PDF 的高亮批注是**半透明叠加**在文字上的 → 不透明会挡住正文。
   */
  opacity?: number;
  /**
   * **要不要把高亮的文字写进批注**（默认 **false**）。
   *
   * ⚠️⚠️ **默认不写**（实测踩到的坑，用户反馈）：
   *
   * > "在导出的pdf上hover到高亮上还是会出现黄色便签"
   *
   * -> PDF 的 `/Contents` 是**批注的弹出文字**
   * -> Chrome 的 PDF 阅读器：**hover 到高亮上就显示一个黄色的便签框** ❌
   *    -> 里面显示的就是 `/Contents` 的内容 ❌
   *    -> 用户看到"一个大黄框" ❌
   *    -> 用户反馈："不要这个"
   *
   * -> **A/B 对照实验**（实测，在 Chrome 里 hover 同一个位置）：
   *    - 原始（有 `/Contents`）-> **出黄色便签** ❌
   *    - 变体 A（删 `/Contents`）-> **没有便签**
   *    - 变体 B（只加 `/F` 标志位）-> **还是出便签** ❌
   *    -> **真凶是 `/Contents`**，不是 `/F`
   *
   * -> 高亮本身**不需要**文字  -> 默认不写
   * -> 宿主如果**确实要**批注文字（比如给 Acrobat/WPS 看）-> 打开
   */
  includeAnnotationText?: boolean;
}

/**
 * 导出**带高亮的 PDF**。
 *
 * @param options 参数
 * @returns 新 PDF 的字节
 * @throws 当 `pdf-lib` 不可用时（提示宿主安装）
 *
 * @example
 * ```ts
 * // 宿主侧
 * const bytes = await exportHighlightedPdf({
 *   pdfBytes: originalBytes,
 *   highlights: myHighlights,
 *   pageSizesPt: viewer.getPageSizesPt(),
 * });
 * download(new Blob([bytes], { type: 'application/pdf' }), 'annotated.pdf');
 * ```
 */
export async function exportHighlightedPdf(
  options: ExportHighlightedPdfOptions,
): Promise<Uint8Array> {
  const {
    pdfBytes,
    highlights,
    pageSizesPt,
    opacity = 0.4,
    includeAnnotationText = false,
  } = options;

  /*
   * ⚠️ **动态 import**（可选依赖）。
   *
   * → 不用导出的宿主：**这段代码根本不会被加载**（0 体积）
   * → 用导出的宿主：装 `pdf-lib` 即可
   */
  let pdfLib = options.pdfLib;
  if (!pdfLib) {
    try {
      pdfLib = (await import(/* @vite-ignore */ 'pdf-lib')) as unknown as PdfLibLike;
    } catch (error) {
      throw new Error(
        '[pdf-viewer] 导出 PDF 需要 pdf-lib：npm i pdf-lib' +
          '（也可以通过 exportHighlightedPdf({ pdfLib }) 自己传进来）',
        { cause: error },
      );
    }
  }

  /*
   * ⚠️ **宿主传了但形状不对** → 给一句人话，别抛 `Cannot read properties of undefined`。
   */
  if (!pdfLib || typeof pdfLib.PDFDocument?.load !== 'function') {
    throw new Error('[pdf-viewer] exportHighlightedPdf：pdfLib 参数无效（需要 PDFDocument.load）');
  }

  const annots = highlightsToPdfAnnots(highlights, pageSizesPt);

  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  // 没有高亮 → 原样返回（不用白跑一趟 pdf-lib）
  if (annots.length === 0) {
    return bytes;
  }

  // ⚠️ `Uint8Array` 可能是**更大的 buffer 的一段** → 必须切出来
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const doc = await pdfLib.PDFDocument.load(buffer);
  const pages = doc.getPages();

  /** 按页分组（同一页的多个矩形 → 一个批注对象） */
  const byPage = new Map<number, PdfAnnot[]>();
  for (const annot of annots) {
    const list = byPage.get(annot.pageNumber) ?? [];
    list.push(annot);
    byPage.set(annot.pageNumber, list);
  }

  for (const [pageNumber, pageAnnots] of byPage) {
    const page = pages[pageNumber - 1];
    if (!page) {
      continue;
    }

    /*
     * ⚠️ **每页一个批注对象**，里面带多个矩形（`/QuadPoints`）。
     *
     * PDF 的高亮批注用 `/QuadPoints` 表达"一行一个矩形"（8 个数 = 4 个点）：
     * ```
     * [x1, yTop, x2, yTop, x1, yBottom, x2, yBottom]
     * ```
     * → 一次能表达多行 → **一条高亮 = 一个批注**（更符合 PDF 的语义）。
     */
    const quadPoints: number[] = [];
    for (const annot of pageAnnots) {
      const [x1, y1, x2, y2] = annot.rect;
      // quad points 的顺序：左上、右上、左下、右下
      quadPoints.push(x1, y2, x2, y2, x1, y1, x2, y1);
    }

    const rgb = colorToRgb(pageAnnots[0]?.color ?? 'yellow');
    const first = pageAnnots[0];

    /*
     * ⚠️ **批注的外框 = 所有矩形的并集**（PDF 要求 `Rect` 覆盖 `QuadPoints`）。
     */
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const annot of pageAnnots) {
      minX = Math.min(minX, annot.rect[0]);
      minY = Math.min(minY, annot.rect[1]);
      maxX = Math.max(maxX, annot.rect[2]);
      maxY = Math.max(maxY, annot.rect[3]);
    }

    /*
     * ⚠️⚠️ **必须手写批注字典**（实测踩过的坑）。
     *
     * 之前的写法：
     * ```ts
     * page.node.setAnnots([{ subtype: 'Highlight', rect, color, opacity, contents }]);
     * page.node.setRectangle('QuadPoints', quadPoints);   // ❌ 写到"页"上了！
     * ```
     *
     * 问题：
     * 1. `/QuadPoints` **必须挂在批注上**（不是页上）→ 之前写错地方 → **批注没有高亮形状**
     * 2. `setAnnots` 的参数是**普通对象** → pdf-lib 会转成它的"高层批注对象"
     *    → 那个对象**没有 `QuadPoints` 字段** → 就算写对地方也写不进去
     *
     * → 解法：**用 pdf-lib 的底层 API 手写字典**：
     * ```
     * PDFDict → set(/Type /Annot, /Subtype /Highlight, /Rect [...], /QuadPoints [...], ...)
     * → context.obj(dict) → context.register(ref)
     * → 页的 /Annots 数组里放这个 ref
     * ```
     */
    const context = doc.context;
    const dict = pdfLib.PDFDict.withContext(context);

    dict.set(pdfLib.PDFName.of('Type'), pdfLib.PDFName.of('Annot'));
    dict.set(pdfLib.PDFName.of('Subtype'), pdfLib.PDFName.of('Highlight'));

    /*
     * ⚠️⚠️ **pdf-lib 的 `PDFArray.push()` 只接受一个参数**（实测踩过的坑）。
     *
     * ```js
     * PDFArray.prototype.push = function (object) { ... }   // ← 只有 1 个形参
     * ```
     *
     * → `push(a, b, c, d)` **只 push 了第一个** → 数组里只有 1 个元素
     * → 读回来是 `[ 10 ]` → `asRectangle()` 直接报错：
     * ```
     * Attempted to convert PDFArray with 1 elements to rectangle, but must have exactly 4 elements.
     * ```
     *
     * → 必须**一个一个 push**。
     */
    const pushNumbers = (array: PdfArrayLike, values: number[]) => {
      for (const value of values) {
        array.push(pdfLib.PDFNumber.of(value));
      }
    };

    // 外框
    const rectArray = pdfLib.PDFArray.withContext(context);
    pushNumbers(rectArray, [minX, minY, maxX, maxY]);
    dict.set(pdfLib.PDFName.of('Rect'), context.register(rectArray));

    // 每行一个矩形
    const quadArray = pdfLib.PDFArray.withContext(context);
    pushNumbers(quadArray, quadPoints);
    dict.set(pdfLib.PDFName.of('QuadPoints'), context.register(quadArray));

    // 颜色（PDF 的 /C 是 3 个 0~1 的数）
    const colorArray = pdfLib.PDFArray.withContext(context);
    pushNumbers(colorArray, [rgb[0], rgb[1], rgb[2]]);
    dict.set(pdfLib.PDFName.of('C'), context.register(colorArray));

    // 不透明度（PDF 1.4+ 的 /CA）
    dict.set(pdfLib.PDFName.of('CA'), pdfLib.PDFNumber.of(opacity));
    dict.set(pdfLib.PDFName.of('ca'), pdfLib.PDFNumber.of(opacity));

    /*
     * ⚠️ **批注标志位（/F）**。
     *
     * -> PDF 的 `/F` 是**标志位**（位掩码）
     *    - 位 1（值 1）= Invisible（完全不可见）
     *    - 位 2（值 2）= Hidden（不显示，但打印）
     *    - 位 3（值 4）= Print（打印时显示）
     *    - 位 4（值 8）= NoZoom
     * -> 高亮批注：**不显示图标、但要能打印**
     *    -> `/F = 4`（Print）
     *    -> 阅读器**不画便签图标**
     *
     * ⚠️ **但这不是"黄色便签"的真凶**（实测）
     * -> A/B 对照：只加 `/F` -> **还是出便签** ❌
     * -> **真凶是 `/Contents`**  （见上面的说明）
     * -> `/F` 还是要加（规范 + 部分阅读器认它）
     */
    dict.set(pdfLib.PDFName.of('F'), pdfLib.PDFNumber.of(4));

    /*
     * ⚠️⚠️ **批注文字（/Contents）默认【不写】**（实测踩到的坑）
     *
     * -> `/Contents` 是**批注的弹出文字**
     * -> Chrome 的 PDF 阅读器 hover 到高亮上就显示**一个黄色便签框** ❌
     *    -> 用户反馈："导出后 hover 高亮还是会出现黄色便签 不要这个"
     * -> A/B 对照实验证明：**真凶是 `/Contents`**（不是 `/F`）
     * -> 宿主确实要批注文字 -> `includeAnnotationText: true`
     */
    const contents = (first?.text ?? '').slice(0, 2000);
    if (contents && includeAnnotationText) {
      /*
       * ⚠️⚠️ **必须用 `fromText`**（实测踩过的坑：用户反馈"导出带高亮的 PDF 后
       * hover 上去会出来乱码批注 明明没有批注"）。
       *
       * ```
       * PDFHexString.of('中文测试')      → <中文测试>        ← ❌ 乱码
       * PDFHexString.fromText('中文测试') → <FEFF4E2D65876D…>  ←
       * ```
       *
       * → `of` 把字符串**当原始字节**写进 PDF
       * → 阅读器按 **PDFDocEncoding** 解码 → 中文全变乱码
       * → `fromText` 做 **UTF-16BE + BOM** 编码 → 阅读器能正确识别
       *
       * ⚠️ 老版本 pdf-lib 没有 `fromText` → 退回 `of`（至少英文是对的）。
       */
      const hex = pdfLib.PDFHexString.fromText
        ? pdfLib.PDFHexString.fromText(contents)
        : pdfLib.PDFHexString.of(contents);
      dict.set(pdfLib.PDFName.of('Contents'), hex);
    }

    /*
     * ⚠️ **挂到页的 /Annots 数组上**。
     *
     * → 原来的批注要保留（PDF 里可能有别的批注）
     */
    const existing = page.node.getAnnots?.() ?? [];
    const refs = existing.map((annot) => context.obj(annot));

    const annotsArray = pdfLib.PDFArray.withContext(context);
    for (const ref of refs) {
      annotsArray.push(ref);
    }
    annotsArray.push(context.register(context.obj(dict)));

    page.node.set(pdfLib.PDFName.of('Annots'), annotsArray);
  }

  return doc.save();
}
