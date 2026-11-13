/**
 * 文档字节缓存 —— 只缓存**文档字节**，不缓存渲染结果。
 *
 * 为什么只缓存字节：
 * - 渲染结果与缩放/旋转强相关（缓存 key 要带上全部渲染参数 → 命中率与收益双输）
 * - 文档字节是**内容寻址**的：同一份 PDF 换缩放、换页码、换设备都不用重下
 * - 命中后省掉的是网络往返（最大的耗时来源），不是渲染耗时
 *
 * 存储策略：
 * - 主存：IndexedDB（idb 封装，Promise API）
 * - 降级：内存 Map（Safari 隐私模式 / IDB 不可用时自动切换，会话内有效）
 * - 淘汰：LRU + 配额上限（默认 50MB）
 *
 * 设计要点：
 * - IDB 不可用不是错误，是**降级**：调用方收到 `onCacheEvent({type:'error'})` 后继续用内存缓存
 * - 所有 IDB 操作包在 try/catch 里：任何 IDB 异常都不能让加载流程失败
 */

import type { IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import { pdfViewerError } from '../errors';
import type { CacheEvent } from '../types';

/** 缓存条目 */
interface CacheEntry {
  key: string;
  data: Uint8Array;
  size: number;
  /**
   * LRU 序号（单调递增）。
   *
   * 为什么不用 `Date.now()`：毫秒精度下同一毫秒写入的条目序号相同 → LRU 顺序随机。
   * 单调计数器保证"后访问的一定更大"，顺序严格可预期。
   */
  sequence: number;
  /** 写入时间（仅用于展示/调试，不参与 LRU 排序） */
  accessedAt: number;
}

/** 缓存配置 */
export interface CacheOptions {
  /** 最大字节数（默认 50MB） */
  maxBytes?: number;
  /** IndexedDB 库名（默认 'pdf-viewer-cache'） */
  dbName?: string;
  /** 强制只用内存（测试 / 隐私模式） */
  memoryOnly?: boolean;
  /** 事件回调 */
  onEvent?: (event: CacheEvent) => void;
}

/** 默认配额（50MB） */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** 默认库名 */
const DEFAULT_DB_NAME = 'pdf-viewer-cache';

/**
 * 文档字节缓存。
 *
 * 对外只暴露 `get` / `set` / `remove` / `clear` / `stats` 五个动作——
 * 不暴露 IndexedDB 细节，调用方不需要知道底层是 IDB 还是内存。
 */
export class DocumentCache {
  private readonly maxBytes: number;
  private readonly dbName: string;
  private readonly memoryOnly: boolean;
  private readonly onEvent?: (event: CacheEvent) => void;

  /** 内存降级存储 */
  private readonly memory = new Map<string, CacheEntry>();

  /** IndexedDB 句柄（null = 不可用，用内存） */
  private db: IDBPDatabase | null = null;

  /** 初始化是否完成（init 之前的调用走内存） */
  private ready = false;

  /** 当前总字节数（内存缓存用） */
  private totalBytes = 0;

  /** LRU 单调序号 */
  private sequence = 0;

  /** 取下一个 LRU 序号 */
  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  constructor(options: CacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.memoryOnly = options.memoryOnly ?? false;
    this.onEvent = options.onEvent;
  }

  /** 初始化（打开 IDB；失败自动降级为内存） */
  async init(): Promise<void> {
    if (this.ready) {
      return;
    }
    this.ready = true;

    if (this.memoryOnly) {
      this.emit({ type: 'error', url: '', error: pdfViewerError('E_CACHE_UNAVAILABLE') });
      return;
    }

    try {
      this.db = await openDB(this.dbName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('documents')) {
            const store = db.createObjectStore('documents', { keyPath: 'key' });
            store.createIndex('accessedAt', 'accessedAt');
          }
        },
      });
    } catch (error) {
      // IDB 不可用（隐私模式 / 被禁用）→ 降级为内存，不是致命错误
      this.db = null;
      this.emit({
        type: 'error',
        url: '',
        error: pdfViewerError('E_CACHE_UNAVAILABLE', { cause: error }),
      });
    }
  }

  /** 读取（命中则 touch LRU） */
  async get(key: string): Promise<Uint8Array | null> {
    if (this.db) {
      try {
        const entry = (await this.db.get('documents', key)) as CacheEntry | undefined;
        if (entry) {
          await this.touch(entry);
          this.emit({ type: 'hit', url: key, size: entry.size });
          return entry.data;
        }
      } catch (error) {
        this.emit({
          type: 'error',
          url: key,
          error: pdfViewerError('E_CACHE_UNAVAILABLE', { cause: error }),
        });
      }
    }

    const memoryEntry = this.memory.get(key);
    if (memoryEntry) {
      memoryEntry.sequence = this.nextSequence();
      this.emit({ type: 'hit', url: key, size: memoryEntry.size });
      return memoryEntry.data;
    }

    this.emit({ type: 'miss', url: key });
    return null;
  }

  /** 写入（超配额先 LRU 淘汰） */
  async set(key: string, data: Uint8Array): Promise<void> {
    const entry: CacheEntry = {
      key,
      data,
      size: data.byteLength,
      sequence: this.nextSequence(),
      accessedAt: Date.now(),
    };

    if (this.db) {
      try {
        await this.db.put('documents', entry);
        await this.evictIfNeeded();
        this.emit({ type: 'save', url: key, size: entry.size });
        return;
      } catch (error) {
        // 配额满（QuotaExceededError）→ 先淘汰再试一次，仍失败则降级内存
        if (await this.evictIfNeeded()) {
          try {
            await this.db.put('documents', entry);
            this.emit({ type: 'save', url: key, size: entry.size });
            return;
          } catch {
            // 落到内存
          }
        }
        this.emit({
          type: 'error',
          url: key,
          error: pdfViewerError('E_CACHE_QUOTA', { cause: error }),
        });
      }
    }

    this.setInMemory(entry);
    this.emit({ type: 'save', url: key, size: entry.size });
  }

  /** 删除单条 */
  async remove(key: string): Promise<void> {
    if (this.db) {
      try {
        await this.db.delete('documents', key);
      } catch (error) {
        this.emit({
          type: 'error',
          url: key,
          error: pdfViewerError('E_CACHE_UNAVAILABLE', { cause: error }),
        });
      }
    }
    this.removeFromMemory(key);
  }

  /** 清空 */
  async clear(): Promise<void> {
    if (this.db) {
      try {
        await this.db.clear('documents');
      } catch (error) {
        this.emit({
          type: 'error',
          url: '',
          error: pdfViewerError('E_CACHE_UNAVAILABLE', { cause: error }),
        });
      }
    }
    this.memory.clear();
    this.totalBytes = 0;
  }

  /** 当前统计（用于 UI 展示与调试） */
  async stats(): Promise<{ count: number; bytes: number; maxBytes: number; persistent: boolean }> {
    if (this.db) {
      try {
        const keys = await this.db.getAllKeys('documents');
        const entries = (await this.db.getAll('documents')) as CacheEntry[];
        const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
        return { count: keys.length, bytes, maxBytes: this.maxBytes, persistent: true };
      } catch {
        // 落到内存统计
      }
    }

    return {
      count: this.memory.size,
      bytes: this.totalBytes,
      maxBytes: this.maxBytes,
      persistent: false,
    };
  }

  /** 关闭（释放 DB 句柄） */
  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  /** 内存写入 + LRU 淘汰 */
  private setInMemory(entry: CacheEntry): void {
    this.removeFromMemory(entry.key);

    // 配额是**硬约束**：单条就超过配额 → 不缓存（宁可这次不命中，也不突破配额）
    if (entry.size > this.maxBytes) {
      this.emit({ type: 'evict', url: entry.key, size: entry.size });
      return;
    }

    this.memory.set(entry.key, entry);
    this.totalBytes += entry.size;

    // 超配额时按 LRU 淘汰。
    // 关键：只淘汰**其它**条目——绝不能把刚写入的这一条淘汰掉
    //（同一毫秒内写入的条目序号接近，"最旧"可能就是它自己 → 静默丢数据）
    while (this.totalBytes > this.maxBytes && this.memory.size > 1) {
      const oldest = this.oldestEntry(entry.key);
      if (!oldest) {
        break;
      }
      this.removeFromMemory(oldest.key);
      this.emit({ type: 'evict', url: oldest.key, size: oldest.size });
    }
  }

  /** 内存删除 */
  private removeFromMemory(key: string): void {
    const entry = this.memory.get(key);
    if (!entry) {
      return;
    }
    this.memory.delete(key);
    this.totalBytes -= entry.size;
  }

  /**
   * 最久未访问的条目
   *
   * @param excludeKey 排除的 key（刚写入的那条不能被淘汰）
   */
  private oldestEntry(excludeKey?: string): CacheEntry | undefined {
    let oldest: CacheEntry | undefined;
    for (const entry of this.memory.values()) {
      if (excludeKey !== undefined && entry.key === excludeKey) {
        continue;
      }
      if (!oldest || entry.sequence < oldest.sequence) {
        oldest = entry;
      }
    }
    return oldest;
  }

  /** 更新访问顺序（LRU touch） */
  private async touch(entry: CacheEntry): Promise<void> {
    entry.sequence = this.nextSequence();
    try {
      await this.db?.put('documents', entry);
    } catch {
      // touch 失败不影响读取结果
    }
  }

  /**
   * 超配额时按 LRU 淘汰。
   * @returns 是否发生了淘汰
   */
  private async evictIfNeeded(): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    try {
      const entries = (await this.db.getAll('documents')) as CacheEntry[];
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      if (total <= this.maxBytes) {
        return false;
      }

      const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
      for (const entry of sorted) {
        if (total <= this.maxBytes) {
          break;
        }
        await this.db.delete('documents', entry.key);
        total -= entry.size;
        this.emit({ type: 'evict', url: entry.key, size: entry.size });
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 事件发出 */
  private emit(event: CacheEvent): void {
    this.onEvent?.(event);
  }
}

/**
 * 生成缓存键：URL 直接用；Blob/内存来源用 documentId 或内容哈希（调用方给）。
 *
 * 为什么不让包自己算内容哈希：hash 需要读全文件字节做 crypto 计算，
 * 大文件会阻塞；而宿主已经有 documentId（业务 id）时直接用它更省。
 */
export function cacheKey(source: string, documentId?: string): string {
  return documentId && documentId.length > 0 ? `id:${documentId}` : `url:${source}`;
}
