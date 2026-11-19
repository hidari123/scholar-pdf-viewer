/**
 * search —— PDF 文本索引与搜索引擎。
 *
 * 用法：
 * ```ts
 * const search = new PdfSearch();
 * await search.buildIndex(getPage, totalPages);   // 懒建，可分次调用
 * const hits = search.search('keyword');
 * ```
 */

import type { PdfViewerError } from '../errors';
import { pdfViewerError } from '../errors';
import { joinItemTexts, selectSearchItems } from './align';

/** 一页的文本项（pdf.js TextItem 的最小形状） */
export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

/** 一页的文本内容（pdf.js getTextContent 的最小形状） */
export interface PageTextContent {
  items: TextItemLike[];
}

/** 取文本页的最小形状（与 pdf.js PDFPageProxy 结构兼容） */
export interface TextPageLike {
  pageNumber: number;
  getTextContent(): Promise<PageTextContent>;
}

/** 一次命中 */
export interface SearchHit {
  /** 命中所在页（1-based） */
  pageNumber: number;
  /** 命中的文本 */
  text: string;
  /** 命中在该页文本中的字符起始位置 */
  start: number;
  /** 命中字符数 */
  length: number;
}

/** 搜索选项 */
export interface SearchOptions {
  /** 是否忽略大小写（默认 true） */
  ignoreCase?: boolean;
  /** 单页最多返回多少命中（默认 100） */
  maxHitsPerPage?: number;
  /** 总命中上限（默认 500） */
  maxHits?: number;
}

/** 单页索引 */
interface PageIndex {
  pageNumber: number;
  /** 整页文本 */
  text: string;
  /**
   * **索引用的项文本**（顺序 = 索引顺序）。
   *
   * ⚠️ **必须有它**（实测踩过的坑：搜索高亮定位不准）。
   *
   * → 渲染侧的 `PositionedTextItem` 是**筛过 + 排过序**的
   * → 和索引的原始顺序**对不上** → 偏移错位 → 高亮跑到别的字上
   * → 存一份"索引用了哪些项" → 映射偏移时用它来对齐 ✅
   */
  itemTexts: string[];
}

/** 让出主线程（把长任务切成片，避免阻塞 UI） */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 归一化文本：统一大小写 + 全角转半角（提升搜索命中率） */
function normalize(text: string, ignoreCase: boolean): string {
  const halfWidth = text.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
  return ignoreCase ? halfWidth.toLowerCase() : halfWidth;
}

/**
 * PDF 文本索引与搜索引擎。
 */
export class PdfSearch {
  /** 页索引（pageNumber → 索引项） */
  private readonly index = new Map<number, PageIndex>();

  /** 已建索引的页数 */
  private indexed = 0;

  /** 总页数 */
  private totalPages = 0;

  /** 取页函数 */
  private getPage: ((pageNumber: number) => Promise<TextPageLike | undefined>) | null = null;

  /** 是否建完 */
  private complete = false;

  /** 正在建索引 */
  private building: Promise<void> | null = null;

  /**
   * **索引版本号**（每次索引增长就 +1）。
   *
   * ⚠️ **搜索高亮定位的关键**（实测踩过的坑：高亮定位不准）。
   *
   * → 渲染侧要用"索引的项文本"算对齐偏移
   * → 索引是**异步**建的 → 页面渲染时索引可能还没建好
   * → 宿主/组件用这个版本号当依赖 → 索引一变就重算 ✅
   */
  private version = 0;

  /** 索引变化的监听器 */
  private readonly listeners = new Set<(version: number) => void>();

  /**
   * **监听索引变化**（索引建好/变大时回调）。
   *
   * ⚠️ **搜索高亮定位的关键**（实测踩过的坑：高亮定位不准）。
   *
   * → 索引是**异步**建的 → 组件第一次渲染时索引可能还是空的
   * → 组件要等索引好了才能算出正确的偏移
   * → 监听 → 索引一变就重渲染 ✅
   *
   * @param listener 回调（收到新的版本号）
   * @returns 取消监听
   */
  subscribeIndexChange(listener: (version: number) => void): () => void {
    this.listeners.add(listener);
    // 立即同步一次当前版本（可能已经建好了）
    listener(this.version);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 通知监听器 */
  private notifyIndexChange(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.version);
      } catch {
        // 监听器出错不影响索引
      }
    }
  }

  /** 索引版本号（索引增长时变化） */
  getIndexVersion(): number {
    return this.version;
  }

  /** 已建索引的页数 */
  getIndexedPages(): number {
    return this.indexed;
  }

  /** 已建索引的页数（别名，兼容旧接口） */
  get indexedPages(): number {
    return this.indexed;
  }

  /** 是否已建完索引 */
  get isComplete(): boolean {
    return this.complete;
  }

  /** 取页函数（宿主可以复用，避免重复实现） */
  getPageProvider(): (pageNumber: number) => Promise<TextPageLike | undefined> {
    return async (pageNumber: number) => {
      try {
        return (await this.getPage?.(pageNumber)) ?? undefined;
      } catch {
        return undefined;
      }
    };
  }

  /** 总页数 */
  getTotalPages(): number {
    return this.totalPages;
  }

  /**
   * 建立索引。
   *
   * ## ⚠️⚠️ **`getTextContent` 必须和渲染用同一份**（实测踩过的坑：高亮定位不准）
   *
   * → pdf.js 的 `getTextContent()` 会**合并** item（`combineTextItems`）
   * → 合并与否取决于 `item.fontName` / `item.height` 等字段
   * → 如果索引那次调用**丢了字段**（比如没传 `fontName`）
   *    → 合并结果**不一样** → item 的边界**不一样** → **偏移错位**
   *    → 实测：索引 161 项 / 渲染 112 项 → 从第 74 项开始全错 ❌
   *
   * → 所以宿主给索引的 `getTextContent` **必须原样透传 pdf.js 的 item**
   *    （或者两边用**同一个函数**）。
   *
   * @param getPage 取页（1-based）
   * @param totalPages 总页数
   * @param options 分片大小（每片建多少页后让出主线程，默认 10）+ 进度回调
   */
  async buildIndex(
    getPage: (pageNumber: number) => Promise<TextPageLike | undefined>,
    totalPages: number,
    options: {
      chunkSize?: number;
      onProgress?: (indexed: number, total: number) => void;
      /**
       * **取该页的视口**（可选）。
       *
       * ⚠️ **强烈建议传**（实测踩过的坑：搜索高亮定位不准）。
       *
       * → 有了视口，索引才能判断"哪些是旋转文字"
       * → 旋转文字在**渲染时不存在** → 索引也必须跳过
       * → 否则索引的文本比渲染的多 457 字符 → **偏移全错位** ❌
       */
      viewport?: (
        pageNumber: number,
      ) => { transform: number[]; scale: number; width: number; height: number } | undefined;
    } = {},
  ): Promise<void> {
    // 已在建 → 等它建完（避免并发重复建）
    if (this.building) {
      await this.building;
      return;
    }
    if (this.complete) {
      return;
    }

    this.getPage = getPage;
    this.totalPages = totalPages;
    const chunkSize = options.chunkSize ?? 10;
    const onProgress = options.onProgress;

    this.building = (async () => {
      while (this.indexed < this.totalPages) {
        const end = Math.min(this.indexed + chunkSize, this.totalPages);

        for (let pageNumber = this.indexed + 1; pageNumber <= end; pageNumber += 1) {
          // 取页本身也可能失败（页已销毁 / 加载失败）→ 同样要兜住
          let page: TextPageLike | undefined;
          try {
            page = await this.getPage?.(pageNumber);
          } catch {
            page = undefined;
          }

          if (!page) {
            // 该页取不到 → 记为空页，继续建后面的（不中断整体索引）
            this.index.set(pageNumber, { pageNumber, text: '', itemTexts: [] });
            this.indexed += 1;
            continue;
          }

          try {
            const content = await page.getTextContent();
            /*
             * ⚠️⚠️ **索引和渲染必须用"同一批项"**（实测踩过的坑：搜索高亮定位不准）。
             *
             * → 渲染侧（`layoutTextItemsWithIndexOffsets`）会跳过
             *   **空项 / 定位失败 / 旋转文字**
             * → 索引如果把这些也算进去 → **偏移错位** → 高亮跑到别的字上
             *
             * ### 实测（真实 arXiv PDF，第 1 页）
             *
             * ```
             * 索引的项: 161 个 → 文本 3010 字符
             * 渲染的项: 112 个 → 文本 2553 字符
             * 差: 457 字符（就是那些**旋转文字**）
             * ```
             *
             * → **旋转文字在渲染时不存在** → 索引也不该收
             * → 但"是不是旋转"**需要视口** → 索引建的时候拿不到
             *
             * ### 修法（两条路）
             *
             * ① **宿主传 `viewport`**（推荐）→ 索引用**完全相同的判据**
             *    → 旋转文字在索引里也不收 → **文本完全一致** ✅
             *
             * ② 宿主不传 → 索引收全部 → 渲染侧用**字符位置**兜底对齐
             *    （`mapOffsetToRenderedByText`）→ 尽量准
             */
            const items = selectSearchItems(content.items, {
              viewport: options.viewport?.(pageNumber),
            });
            const text = joinItemTexts(items);
            this.index.set(pageNumber, {
              pageNumber,
              text,
              itemTexts: items.map((item) => item.str),
            });
            this.indexed += 1;
          } catch {
            // 单页取文本失败（如该页是纯图片）→ 跳过，不中断整体建索引
            this.index.set(pageNumber, { pageNumber, text: '', itemTexts: [] });
            this.indexed += 1;
          }
        }

        // 让出主线程：让 UI 有机会响应
        await yieldToHost();

        /*
         * ⚠️ **通知宿主"索引变大了"**（实测踩过的坑：高亮定位不准）。
         *
         * → 渲染侧要用"索引的项文本"算对齐偏移
         * → 索引是**异步**建的 → 页面渲染时索引可能还没建好
         * → 宿主收到通知 → 重新渲染 → 偏移才算得对 ✅
         */
        this.version += 1;
        this.notifyIndexChange();
        onProgress?.(this.indexed, this.totalPages);
      }

      this.complete = true;
      this.building = null;
      onProgress?.(this.indexed, this.totalPages);
    })();

    await this.building;
  }

  /**
   * 搜索。
   *
   * @param keyword 关键词
   * @param options 搜索选项
   */
  search(keyword: string, options: SearchOptions = {}): SearchHit[] {
    const ignoreCase = options.ignoreCase ?? true;
    const maxHitsPerPage = options.maxHitsPerPage ?? 100;
    const maxHits = options.maxHits ?? 500;

    const trimmed = keyword.trim();
    if (trimmed.length === 0) {
      return [];
    }

    const needle = normalize(trimmed, ignoreCase);
    const hits: SearchHit[] = [];

    // 按页码顺序遍历，保证结果稳定（可预期 > 性能）
    const pageNumbers = [...this.index.keys()].sort((a, b) => a - b);

    for (const pageNumber of pageNumbers) {
      if (hits.length >= maxHits) {
        break;
      }

      const page = this.index.get(pageNumber);
      if (!page?.text) {
        continue;
      }

      const haystack = normalize(page.text, ignoreCase);

      let from = 0;
      let count = 0;

      while (count < maxHitsPerPage && hits.length < maxHits) {
        const at = haystack.indexOf(needle, from);
        if (at < 0) {
          break;
        }

        hits.push({
          pageNumber,
          text: trimmed,
          start: at,
          length: trimmed.length,
        });

        count += 1;
        // 从下一个字符继续（允许重叠命中）
        from = at + 1;
      }
    }

    return hits;
  }

  /** 某页的文本（宿主可用来做摘要/翻译） */
  getPageText(pageNumber: number): string | null {
    return this.index.get(pageNumber)?.text ?? null;
  }

  /**
   * 某页**索引用的项文本**（顺序 = 索引顺序）。
   *
   * ⚠️ **映射搜索命中的偏移时必须用它**（实测踩过的坑：搜索高亮定位不准）。
   *
   * @param pageNumber 页码（1-based）
   * @returns 项文本数组（没建索引则空数组）
   */
  getPageItemTexts(pageNumber: number): string[] {
    return this.index.get(pageNumber)?.itemTexts ?? [];
  }

  /** 全文（已建索引的部分） */
  getText(): string {
    const pageNumbers = [...this.index.keys()].sort((a, b) => a - b);
    return pageNumbers.map((pageNumber) => this.index.get(pageNumber)?.text ?? '').join('\n');
  }

  /** 重置（换文档时调用） */
  reset(): void {
    this.index.clear();
    this.indexed = 0;
    this.totalPages = 0;
    this.complete = false;
    this.building = null;
    this.getPage = null;
  }

  /** 错误（兼容旧的接口） */
  // eslint-disable-next-line class-methods-use-this
  toError(error: unknown): PdfViewerError {
    return pdfViewerError('E_LOAD_NETWORK', { cause: error });
  }
}
