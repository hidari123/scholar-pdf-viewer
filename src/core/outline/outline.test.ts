import { describe, expect, it } from 'vitest';
import type { OutlineItemLike } from './outline';
import { flattenOutline, resolveDestPage, visibleOutlineItems } from './outline';

/** 页引用 → 页码的映射（测试用） */
function mapper(ref: unknown): number | null {
  if (typeof ref === 'number') {
    return ref;
  }
  if (ref && typeof ref === 'object' && 'num' in ref) {
    return (ref as { num: number }).num;
  }
  return null;
}

describe('resolveDestPage', () => {
  it('数字页引用 → 页码', () => {
    expect(resolveDestPage([5, '/XYZ', 0, 100, 0], mapper)).toBe(5);
  });

  it('对象页引用（带 num）→ 页码', () => {
    expect(resolveDestPage([{ num: 7 }, '/XYZ'], mapper)).toBe(7);
  });

  it('空目标 → null', () => {
    expect(resolveDestPage(null, mapper)).toBeNull();
    expect(resolveDestPage(undefined, mapper)).toBeNull();
    expect(resolveDestPage([], mapper)).toBeNull();
  });

  it('字符串目标 → null', () => {
    expect(resolveDestPage('named-dest', mapper)).toBeNull();
  });

  it('映射失败 → null', () => {
    expect(resolveDestPage([{ unknown: true }], mapper)).toBeNull();
  });

  it('页码 < 1 → null', () => {
    expect(resolveDestPage([0], mapper)).toBeNull();
  });
});

describe('flattenOutline', () => {
  it('扁平化并记录层级', () => {
    const items: OutlineItemLike[] = [
      {
        title: '第 1 章',
        dest: [1, '/XYZ'],
        items: [{ title: '1.1 节', dest: [2, '/XYZ'] }],
      },
      { title: '第 2 章', dest: [3, '/XYZ'] },
    ];

    const flat = flattenOutline(items, mapper);

    expect(flat).toHaveLength(3);
    expect(flat[0]?.title).toBe('第 1 章');
    expect(flat[0]?.level).toBe(0);
    expect(flat[1]?.title).toBe('1.1 节');
    expect(flat[1]?.level).toBe(1);
    expect(flat[2]?.level).toBe(0);
  });

  it('解析页码', () => {
    const flat = flattenOutline([{ title: 'A', dest: [4, '/XYZ'] }], mapper);

    expect(flat[0]?.pageNumber).toBe(4);
  });

  it('深层层级', () => {
    const items: OutlineItemLike[] = [
      {
        title: 'L0',
        items: [{ title: 'L1', items: [{ title: 'L2' }] }],
      },
    ];

    const flat = flattenOutline(items, mapper);

    expect(flat.map((i) => i.level)).toEqual([0, 1, 2]);
  });

  it('空数组 → 空结果', () => {
    expect(flattenOutline([], mapper)).toEqual([]);
    expect(flattenOutline(undefined, mapper)).toEqual([]);
    expect(flattenOutline(null, mapper)).toEqual([]);
  });

  it('id 唯一', () => {
    const items: OutlineItemLike[] = [
      { title: 'A', items: [{ title: 'A' }] },
      { title: 'A', items: [{ title: 'A' }] },
    ];

    const flat = flattenOutline(items, mapper);
    const ids = new Set(flat.map((i) => i.id));

    expect(ids.size).toBe(flat.length);
  });
});

describe('visibleOutlineItems', () => {
  /** 造一棵两层树 */
  function build() {
    return flattenOutline(
      [
        {
          title: 'L0-A',
          items: [{ title: 'L1-A' }, { title: 'L1-B' }],
        },
        {
          title: 'L0-B',
          items: [{ title: 'L1-C' }],
        },
      ],
      mapper,
    );
  }

  it('无折叠 → 全部可见', () => {
    const items = build();

    expect(visibleOutlineItems(items, new Set())).toHaveLength(5);
  });

  it('折叠顶层 → 它的子项隐藏', () => {
    const items = build();
    const target = items[0];

    const visible = visibleOutlineItems(items, new Set([target?.id ?? '']));

    expect(visible.map((i) => i.title)).toEqual(['L0-A', 'L0-B', 'L1-C']);
  });

  it('折叠中间层 → 只隐藏它的子项', () => {
    const items = build();
    const target = items.find((i) => i.title === 'L0-B');

    const visible = visibleOutlineItems(items, new Set([target?.id ?? '']));

    expect(visible.map((i) => i.title)).toEqual(['L0-A', 'L1-A', 'L1-B', 'L0-B']);
  });

  it('折叠多个 → 都生效', () => {
    const items = build();
    const a = items.find((i) => i.title === 'L0-A');
    const b = items.find((i) => i.title === 'L0-B');

    const visible = visibleOutlineItems(items, new Set([a?.id ?? '', b?.id ?? '']));

    expect(visible.map((i) => i.title)).toEqual(['L0-A', 'L0-B']);
  });
});
