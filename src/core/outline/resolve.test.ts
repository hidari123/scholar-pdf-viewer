/**
 * 目录页码的**异步解析**。
 *
 * > "目录还是无法点击跳转"
 *
 * → 之前只有**同步**的 `pageRefToNumber` → 宿主得自己写 50+ 行
 * → 宿主漏了最后一步（通知包）→ 目录点了没反应 ❌
 * → 现在：宿主给一个**异步**函数 → **包自己解析** ✅
 */

import { describe, expect, it, vi } from 'vitest';
import type { OutlineItemLike } from './outline';
import { resolveOutlinePageNumbers } from './resolve';

const outline: OutlineItemLike[] = [
  {
    title: 'Introduction',
    dest: [{ num: 10, gen: 0 }, '/XYZ', 0, 100, 0],
    items: [
      { title: 'Background', dest: [{ num: 12, gen: 0 }, '/XYZ', 0, 100, 0] },
      { title: 'Related Work', dest: [{ num: 14, gen: 0 }, '/XYZ', 0, 100, 0] },
    ],
  },
  { title: 'Named Target', dest: 'section.1' },
];

describe('resolveOutlinePageNumbers', () => {
  it('**解析出页码（页引用 → 页码）**', async () => {
    const mapper = await resolveOutlinePageNumbers(outline, async (ref) => {
      const target = ref as { num?: number };
      return typeof target.num === 'number' ? target.num : null;
    });

    expect(mapper({ num: 10, gen: 0 })).toBe(10);
    expect(mapper({ num: 12, gen: 0 })).toBe(12);
    expect(mapper({ num: 14, gen: 0 })).toBe(14);
  });

  it('**命名目标也能解析**', async () => {
    const mapper = await resolveOutlinePageNumbers(outline, async (ref) => {
      if (ref === 'section.1') {
        return 3;
      }
      const target = ref as { num?: number };
      return typeof target.num === 'number' ? target.num : null;
    });

    expect(mapper('section.1')).toBe(3);
  });

  it('**解析不出来 → null（不抛）**', async () => {
    const mapper = await resolveOutlinePageNumbers(outline, async () => null);
    expect(mapper({ num: 10, gen: 0 })).toBeNull();
    expect(mapper('section.1')).toBeNull();
  });

  it('**解析器抛错 → 跳过这一项（不整个失败）**', async () => {
    const mapper = await resolveOutlinePageNumbers(outline, async (ref) => {
      const target = ref as { num?: number };
      if (target.num === 12) {
        throw new Error('炸了');
      }
      return typeof target.num === 'number' ? target.num : null;
    });

    expect(mapper({ num: 10, gen: 0 })).toBe(10);
    expect(mapper({ num: 12, gen: 0 })).toBeNull();
  });

  it('**页码 < 1 → 当作解析不出来**', async () => {
    const mapper = await resolveOutlinePageNumbers(outline, async () => 0);
    expect(mapper({ num: 10, gen: 0 })).toBeNull();
  });

  it('**同一个页引用只解析一次**', async () => {
    const resolvePageRef = vi.fn(async () => 5);
    await resolveOutlinePageNumbers(
      [
        { title: 'A', dest: [{ num: 1, gen: 0 }] },
        { title: 'B', dest: [{ num: 1, gen: 0 }] },
      ],
      resolvePageRef,
    );
    expect(resolvePageRef).toHaveBeenCalledTimes(1);
  });

  it('**目录为空 → 返回一个能用的空映射**', async () => {
    const mapper = await resolveOutlinePageNumbers(null, async () => 1);
    expect(mapper({ num: 1, gen: 0 })).toBeNull();
  });

  it('**没有 dest 的项不影响其他项**', async () => {
    const mapper = await resolveOutlinePageNumbers(
      [{ title: 'No dest' }, { title: 'With dest', dest: [{ num: 7, gen: 0 }] }],
      async (ref) => (ref as { num?: number }).num ?? null,
    );
    expect(mapper({ num: 7, gen: 0 })).toBe(7);
  });
});
