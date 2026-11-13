/**
 * 文本索引与搜索 —— PDF 全文检索。
 *
 * 设计要点：
 * - **懒建索引**：只在第一次搜索时建，不在加载时建（加载时建会让首屏变慢）
 * - **分片构建**：一页一页建，每页之间让出主线程（`await yieldToHost()`），
 *   否则 500 页文档建索引会卡住 UI 好几秒
 * - **大小写/全角容错**：搜索体验的细节（用户搜 "pdf" 要能命中 "PDF"）
 *
 * 命中结果的坐标：pdf.js 的 `getTextContent()` 给的是**文本项 + 变换矩阵**，
 * 由调用方（渲染层）换算成矩形——本模块只负责"找到哪一页的哪一段文字"。
 */

import type { PdfViewerError } from '../errors';
import { pdfViewerError } from '../errors';

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
  /** 每页的命中（懒搜，不预先算） */
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
 *
 * 用法：
 * ```ts
 * const search = new PdfSearch();
 * await search.buildIndex(getPage, totalPages);   // 懒建，可分次调用
 * const hits = search.search('keyword');
 * ```
 */
export class PdfSearch {
  /** 页索引（pageNumber → 索引项） */
  private readonly index = new Map<number, PageIndex>();

  /** 已建索引的页数 */
  private indexed = 0;

  /** 总页数 */
  private totalPages = 0;

  /** 建索引是否在进行中 */
  private building: Promise<void> | null = null;

  /** 是否已建完 */
  private complete = false;

  /** 取某页（由调用方提供，通常是缓存好的 page proxy） */
  private getPage: ((pageNumber: number) => Promise<TextPageLike | undefined>) | null = null;

  /** 已建索引的页数（只读） */
  get indexedPages(): number {
    return this.indexed;
  }

  /** 是否已建完 */
  get isComplete(): boolean {
    return this.complete;
  }

  /**
   * 建立索引。
   *
   * @param getPage 取页（1-based）
   * @param totalPages 总页数
   * @param options 分片大小（每片建多少页后让出主线程，默认 10）
   */
  async buildIndex(
    getPage: (pageNumber: number) => Promise<TextPageLike | undefined>,
    totalPages: number,
    options: { chunkSize?: number } = {},
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
            this.index.set(pageNumber, { pageNumber, text: '' });
            this.indexed += 1;
            continue;
          }

          try {
            const content = await page.getTextContent();
            const text = content.items.map((item) => item.str).join('');
            this.index.set(pageNumber, { pageNumber, text });
            this.indexed += 1;
          } catch {
            // 单页取文本失败（如该页是纯图片）→ 跳过，不中断整体建索引
            this.index.set(pageNumber, { pageNumber, text: '' });
            this.indexed += 1;
          }
        }

        // 让出主线程：让 UI 有机会响应
        await yieldToHost();
      }

      this.complete = true;
      this.building = null;
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
      const page = this.index.get(pageNumber);
      if (!page) {
        continue;
      }

      const haystack = normalize(page.text, ignoreCase);
      let from = 0;
      let pageHitCount = 0;

      while (pageHitCount < maxHitsPerPage && hits.length < maxHits) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) {
          break;
        }

        hits.push({
          pageNumber,
          text: page.text.slice(at, at + trimmed.length),
          start: at,
          length: trimmed.length,
        });

        pageHitCount += 1;
        from = at + Math.max(needle.length, 1);
      }

      if (hits.length >= maxHits) {
        break;
      }
    }

    return hits;
  }

  /** 某页的文本（宿主可用来做摘要/翻译） */
  getPageText(pageNumber: number): string | null {
    return this.index.get(pageNumber)?.text ?? null;
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

  /**
   * 提取全文（用于宿主的摘要/翻译/索引）。
   *
   * 失败时抛统一错误码（宿主可据此提示"该文档不支持全文提取"）。
   */
  async extractFullText(
    getPage: (pageNumber: number) => Promise<TextPageLike | undefined>,
    totalPages: number,
  ): Promise<string> {
    try {
      await this.buildIndex(getPage, totalPages);
      return this.getText();
    } catch (error) {
      throw this.toError(error);
    }
  }

  /** 归一化为统一错误 */
  private toError(error: unknown): PdfViewerError {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
    ) {
      return error as PdfViewerError;
    }
    return pdfViewerError('E_PDF_INVALID', { cause: error });
  }
}
