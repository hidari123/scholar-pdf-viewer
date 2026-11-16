import { describe, expect, it } from 'vitest';
import { planThumbnails, ThumbnailCache, thumbnailSpec } from './plan';

describe('thumbnailSpec', () => {
  it('按目标宽度算缩放比', () => {
    const spec = thumbnailSpec(595, 842, 120);

    expect(spec.width).toBe(120);
    expect(spec.scale).toBeCloseTo(120 / 595);
  });

  it('高度按页面比例算（**ceil**，与宿主渲染一致）', () => {
    const spec = thumbnailSpec(595, 842, 120);

    // 用 ceil 而不是 round —— 画布尺寸必须向上取整，否则裁掉内容
    expect(spec.height).toBe(Math.ceil((842 * 120) / 595));
  });

  it('尺寸与宿主渲染的画布尺寸一致（零错位）', () => {
    // 宿主渲染时用 Math.ceil(viewport.width/height)
    const spec = thumbnailSpec(612, 792, 120);
    const scale = spec.width / 612;
    const viewport = { width: 612 * scale, height: 792 * scale };

    expect(spec.width).toBe(Math.ceil(viewport.width));
    expect(spec.height).toBe(Math.ceil(viewport.height));
  });

  it('非法输入返回空规格', () => {
    expect(thumbnailSpec(0, 842, 120).width).toBe(0);
    expect(thumbnailSpec(595, 0, 120).width).toBe(0);
    expect(thumbnailSpec(595, 842, 0).width).toBe(0);
  });
});

describe('planThumbnails', () => {
  it('只生成可视页附近的页', () => {
    const plan = planThumbnails({
      totalPages: 100,
      visiblePages: [50],
      cachedPages: [],
      bufferPages: 2,
      batchSize: 10,
    });

    expect(plan.toRender).toEqual([48, 49, 50, 51, 52]);
  });

  it('默认单次最多生成 4 个（避免一次占满主线程）', () => {
    const plan = planThumbnails({
      totalPages: 100,
      visiblePages: [50],
      cachedPages: [],
      bufferPages: 2,
    });

    expect(plan.toRender).toHaveLength(4);
  });

  it('跳过已缓存的页', () => {
    const plan = planThumbnails({
      totalPages: 100,
      visiblePages: [50],
      cachedPages: [49, 50],
      bufferPages: 1,
    });

    expect(plan.toRender).toEqual([51]);
    expect(plan.skipped).toContain(49);
    expect(plan.skipped).toContain(50);
  });

  it('超出 buffer 的页不生成', () => {
    const plan = planThumbnails({
      totalPages: 100,
      visiblePages: [50],
      cachedPages: [],
      bufferPages: 1,
    });

    expect(plan.toRender).toEqual([49, 50, 51]);
  });

  it('batchSize 限制单次生成数量', () => {
    const plan = planThumbnails({
      totalPages: 100,
      visiblePages: [50],
      cachedPages: [],
      bufferPages: 5,
      batchSize: 2,
    });

    expect(plan.toRender).toHaveLength(2);
  });

  it('首尾页不越界', () => {
    const plan = planThumbnails({
      totalPages: 3,
      visiblePages: [1],
      cachedPages: [],
      bufferPages: 2,
    });

    expect(plan.toRender).toEqual([1, 2, 3]);
  });

  it('总页数为 0 → 空计划', () => {
    const plan = planThumbnails({
      totalPages: 0,
      visiblePages: [1],
      cachedPages: [],
    });

    expect(plan.toRender).toEqual([]);
  });

  it('无可视页 → 空计划', () => {
    const plan = planThumbnails({
      totalPages: 10,
      visiblePages: [],
      cachedPages: [],
    });

    expect(plan.toRender).toEqual([]);
  });

  it('按页码升序生成（视觉自然）', () => {
    const plan = planThumbnails({
      totalPages: 100,
      visiblePages: [50, 20],
      cachedPages: [],
      bufferPages: 0,
    });

    expect(plan.toRender).toEqual([20, 50]);
  });
});

describe('ThumbnailCache', () => {
  it('存了能取到', () => {
    const cache = new ThumbnailCache();

    cache.set(1, 'data-1');

    expect(cache.get(1)).toBe('data-1');
  });

  it('没有的返回 undefined', () => {
    const cache = new ThumbnailCache();

    expect(cache.get(99)).toBeUndefined();
  });

  it('超出上限淘汰最久未用的', () => {
    const cache = new ThumbnailCache(2);

    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');

    expect(cache.size).toBe(2);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(3)).toBe('c');
  });

  it('命中后保留（LRU）', () => {
    const cache = new ThumbnailCache(2);

    cache.set(1, 'a');
    cache.set(2, 'b');
    // 访问 1 → 它变成最近使用
    cache.get(1);
    cache.set(3, 'c');

    expect(cache.get(1)).toBe('a');
    expect(cache.get(2)).toBeUndefined();
  });

  it('重复 set 同一页不增加条目数', () => {
    const cache = new ThumbnailCache();

    cache.set(1, 'a');
    cache.set(1, 'b');

    expect(cache.size).toBe(1);
    expect(cache.get(1)).toBe('b');
  });

  it('统计命中率', () => {
    const cache = new ThumbnailCache();

    cache.set(1, 'a');
    cache.get(1);
    cache.get(2);

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('清空缓存', () => {
    const cache = new ThumbnailCache();

    cache.set(1, 'a');
    cache.clear();

    expect(cache.size).toBe(0);
  });
});
