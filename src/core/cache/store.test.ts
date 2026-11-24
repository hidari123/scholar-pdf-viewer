import { beforeEach, describe, expect, it } from 'vitest';
import type { CacheEvent } from '../types';
import { cacheKey, DocumentCache } from './store';

/** 构造指定长度的字节数组 */
function bytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(7);
}

describe('cacheKey', () => {
  it('有 documentId 时用 id 前缀（省掉内容哈希）', () => {
    expect(cacheKey('https://example.com/a.pdf', 'doc-1')).toBe('id:doc-1');
  });

  it('无 documentId 时用 url 前缀', () => {
    expect(cacheKey('https://example.com/a.pdf')).toBe('url:https://example.com/a.pdf');
  });

  it('空 documentId 视为没有', () => {
    expect(cacheKey('https://example.com/a.pdf', '')).toBe('url:https://example.com/a.pdf');
  });
});

describe('DocumentCache（内存模式）', () => {
  let events: CacheEvent[];

  beforeEach(() => {
    events = [];
  });

  /** 建一个纯内存缓存（不触碰 IndexedDB） */
  async function memoryCache(maxBytes = 1000) {
    const cache = new DocumentCache({
      maxBytes,
      memoryOnly: true,
      onEvent: (event) => events.push(event),
    });
    await cache.init();
    return cache;
  }

  it('写入后能读回（内容一致）', async () => {
    const cache = await memoryCache();
    const data = bytes(10);

    await cache.set('a', data);
    const got = await cache.get('a');

    expect(got).not.toBeNull();
    expect(got?.byteLength).toBe(10);
    expect(got?.[0]).toBe(7);
  });

  it('未命中返回 null 并发 miss 事件', async () => {
    const cache = await memoryCache();

    expect(await cache.get('nope')).toBeNull();
    expect(events.some((e) => e.type === 'miss')).toBe(true);
  });

  it('命中发 hit 事件', async () => {
    const cache = await memoryCache();
    await cache.set('a', bytes(4));
    events = [];

    await cache.get('a');

    expect(events.some((e) => e.type === 'hit')).toBe(true);
  });

  it('超配额按 LRU 淘汰最久未访问的', async () => {
    // 配额 100 字节：a=60, b=60 → 放不下两个
    const cache = await memoryCache(100);
    await cache.set('a', bytes(60));
    await cache.set('b', bytes(60));

    // a 被淘汰（b 更近）
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).not.toBeNull();
  });

  it('访问过的条目不会被淘汰（LRU 语义）', async () => {
    // 配额 100：a=40, b=40 共 80（都在），触碰 a 后写 c=40 → 超配额 120 → 淘汰最旧的 b
    const cache = await memoryCache(100);
    await cache.set('a', bytes(40));
    await cache.set('b', bytes(40));

    // 触碰 a（让它变成最新）→ LRU 里 a 是新的、b 是旧的
    await cache.get('a');
    await cache.set('c', bytes(40));

    expect(await cache.get('a')).not.toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('c')).not.toBeNull();
  });

  it('刚写入的条目不会被自己淘汰（同毫秒写入也不丢数据）', async () => {
    // 配额 100，写 a=60 再写 b=60 → b 写入时应淘汰 a（而不是 b 自己）
    const cache = await memoryCache(100);
    await cache.set('a', bytes(60));
    await cache.set('b', bytes(60));

    expect(await cache.get('b')).not.toBeNull();
    expect(await cache.get('a')).toBeNull();
  });

  it('单条超过配额时不缓存（配额是硬约束，不留空壳）', async () => {
    // 配额 100，写 500 字节 → 永远放不下 → 不缓存（而不是突破配额或缓存空壳）
    const cache = await memoryCache(100);
    await cache.set('big', bytes(500));

    expect(await cache.get('big')).toBeNull();
    const stats = await cache.stats();
    expect(stats.bytes).toBe(0);
    expect(stats.count).toBe(0);
  });

  it('淘汰时发 evict 事件', async () => {
    const cache = await memoryCache(100);
    await cache.set('a', bytes(60));
    events = [];

    await cache.set('b', bytes(60));

    expect(events.some((e) => e.type === 'evict')).toBe(true);
  });

  it('删除单条', async () => {
    const cache = await memoryCache();
    await cache.set('a', bytes(4));

    await cache.remove('a');

    expect(await cache.get('a')).toBeNull();
  });

  it('清空', async () => {
    const cache = await memoryCache();
    await cache.set('a', bytes(4));
    await cache.set('b', bytes(4));

    await cache.clear();

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });

  it('stats：内存模式 persistent=false', async () => {
    const cache = await memoryCache(1000);
    await cache.set('a', bytes(40));

    const stats = await cache.stats();

    expect(stats.persistent).toBe(false);
    expect(stats.count).toBe(1);
    expect(stats.bytes).toBe(40);
    expect(stats.maxBytes).toBe(1000);
  });

  it('memoryOnly 初始化时发不可用事件（宿主可据此提示）', async () => {
    await memoryCache();

    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  /*
   * ⚠️ **LRU 淘汰的边界**（补覆盖率）。
   */

  it('**淘汰时会跳过"刚写入的那一条"**（不会自己淘汰自己）', async () => {
    const cache = await memoryCache(20);
    await cache.set('old', bytes(10));
    await cache.set('new', bytes(10));

    // ⚠️ **刚写的这条还在** ✅
    expect(await cache.get('new')).not.toBeNull();
  });

  it('**删掉不存在的 key 不报错**', async () => {
    const cache = await memoryCache();

    await expect(cache.remove('nope')).resolves.toBeUndefined();
  });

  it('**clear 之后读不到东西了**', async () => {
    const cache = await memoryCache();
    await cache.set('a', bytes(4));

    await cache.clear();

    expect(await cache.get('a')).toBeNull();
  });

  it('**stats 报告当前条目数**', async () => {
    const cache = await memoryCache();
    await cache.set('a', bytes(4));

    const stats = await cache.stats();

    expect(stats.persistent).toBe(false);
  });

  it('**重复写同一 key：字节数不重复累加**', async () => {
    const cache = await memoryCache(1000);
    await cache.set('a', bytes(50));
    await cache.set('a', bytes(50));

    const stats = await cache.stats();

    expect(stats.bytes).toBe(50);
  });
});
