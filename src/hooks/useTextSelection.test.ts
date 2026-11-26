// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextSelection } from './useTextSelection';

/**
 * 造一个"页面 + 文本层"的 DOM。
 *
 * @param text 文本
 * @param pageNumber 页码
 */
function makePage(text: string, pageNumber = 1): HTMLElement {
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = '800px';
  container.style.height = '1000px';

  const page = document.createElement('div');
  page.className = 'scpdf-page';
  page.setAttribute('data-page-number', String(pageNumber));
  page.style.position = 'absolute';
  page.style.top = '0px';
  page.style.left = '0px';
  page.style.width = '800px';
  page.style.height = '1000px';

  const layer = document.createElement('div');
  layer.className = 'scpdf-text-layer';
  layer.style.position = 'absolute';
  layer.style.top = '100px';
  layer.style.left = '50px';

  const span = document.createElement('span');
  span.setAttribute('data-page-number', String(pageNumber));
  /*
   * ⚠️ **必须带 `data-item-index`**
   * -> 选区现在按【文档顺序】裁剪  -> 靠这个属性定位"选了哪一段"
   * -> 没有它  -> 项会被跳过  -> 选区算不出来
   */
  span.setAttribute('data-item-index', '0');
  /*
   * ⚠️ **必须有 `scpdf-text-layer__item` 这个 class**
   * -> `closest(TEXT_LAYER_ITEM_CLASS)` 靠它找到 span
   */
  span.className = 'scpdf-text-layer__item';
  span.textContent = text;
  layer.appendChild(span);
  /*
   * ⚠️ **必须加"内容结束"的哨兵**
   * -> hook 靠它判断选区的结束边界 ✅（没有就不算几何 ❌）
   */
  const end = document.createElement('div');
  end.className = 'scpdf-text-layer__end';
  layer.appendChild(end);
  page.appendChild(layer);
  container.appendChild(page);
  document.body.appendChild(container);
  return container;
}

/** 选中文本层里的全部文字 */
function selectText(container: HTMLElement) {
  const span = container.querySelector('span') as Node;
  const range = document.createRange();
  range.selectNodeContents(span);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

/** 等两帧（几何计算是 rAF 节流的） */
async function waitFrames(n = 3) {
  for (let i = 0; i < n; i += 1) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  }
}

/**
 * ⚠️⚠️ **jsdom 的 `getClientRects()` 全是 0 尺寸**
 *
 * -> 而 hook 的 `collectPages` 会**跳过 0 尺寸的矩形** ❌
 * -> -> jsdom 里**永远选不中** ❌
 * -> -> 所以要**手动 mock** 一个有尺寸的矩形
 *
 * @param rect 矩形
 */
function mockClientRects(rect: { top: number; left: number; width: number; height: number }) {
  const list = [rect] as unknown as DOMRectList;
  /*
   * ⚠️⚠️ **jsdom 的 `Range` 上【没有】`getClientRects`**
   * -> `vi.spyOn` 会直接抛"property is not defined" ❌
   * -> 所以要**自己定义**
   */
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => list,
  });

  /*
   * ⚠️⚠️ **还要 mock `Element.prototype.getClientRects`**
   *
   * -> 选区现在按【文档顺序】裁剪
   * -> -> `collectDomOrderItems` 读的是**每个 span 自己**的 rect
   *    -> `span.getClientRects()`  （不是 Range 的）
   * -> jsdom 里 span 的 rect 也是 0 尺寸  -> 必须 mock
   */
  Object.defineProperty(Element.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: function (this: Element) {
      // ⚠️ 只有文本项才有尺寸  （哨兵 / 页容器没有）
      if (!(this instanceof HTMLElement) || !this.classList.contains('scpdf-text-layer__item')) {
        return [] as unknown as DOMRectList;
      }
      return list;
    },
  });
}

describe('useTextSelection（审核补测）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('**没有选区时 onSelectionChange 收到 null**', () => {
    const container = makePage('Hello World');
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() =>
      useTextSelection({
        containerRef: { current: container },
        pageFrames: [{ pageNumber: 1, left: 0, top: 0, width: 800, height: 1000 }],
        reference: { width: 800, height: 1000 },
        onSelectionChange,
      }),
    );
    expect(result.current).toBeDefined();
  });

  it('**选中文字 -> onSelectionChange 被调**', async () => {
    const container = makePage('Hello World');
    const onSelectionChange = vi.fn();
    renderHook(() =>
      useTextSelection({
        containerRef: { current: container },
        pageFrames: [{ pageNumber: 1, left: 0, top: 0, width: 800, height: 1000 }],
        reference: { width: 800, height: 1000 },
        onSelectionChange,
      }),
    );

    mockClientRects({ top: 100, left: 50, width: 200, height: 20 });
    act(() => {
      selectText(container);
    });
    await waitFrames();

    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(last).not.toBeNull();
    expect(last?.text).toBe('Hello World');
    // ⚠️ **`pages` 是数组**（跨页时有多个）
    expect(last?.pages).toContain(1);
    expect(last?.anchor.pageNumber).toBe(1);
  });

  it('**选区在容器外面 -> 不该产生选区**', async () => {
    const container = makePage('Hello World');
    const outside = document.createElement('div');
    outside.textContent = '外部文字';
    document.body.appendChild(outside);

    const onSelectionChange = vi.fn();
    renderHook(() =>
      useTextSelection({
        containerRef: { current: container },
        pageFrames: [{ pageNumber: 1, left: 0, top: 0, width: 800, height: 1000 }],
        reference: { width: 800, height: 1000 },
        onSelectionChange,
      }),
    );

    act(() => {
      const range = document.createRange();
      range.selectNodeContents(outside);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await waitFrames();

    /*
     * ⚠️ **没选中 -> 不该产生选区**
     * -> 之前用"最后一次是 null"来判断 ❌
     * -> 但 jsdom 里选区本来就选不中 ❌ -> **测不出来** ❌
     * -> -> 改成"【从来没有】产生过选区"
     */
    for (const call of onSelectionChange.mock.calls) {
      expect(call[0]).toBeNull();
    }
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('**容器是 null 时不该崩**', () => {
    const onSelectionChange = vi.fn();
    expect(() =>
      renderHook(() =>
        useTextSelection({
          containerRef: { current: null },
          pageFrames: [],
          reference: { width: 800, height: 1000 },
          onSelectionChange,
        }),
      ),
    ).not.toThrow();
  });

  it('**onClientRects 会给原始矩形**', async () => {
    const container = makePage('Hello World');
    const onClientRects = vi.fn();
    renderHook(() =>
      useTextSelection({
        containerRef: { current: container },
        pageFrames: [{ pageNumber: 1, left: 0, top: 0, width: 800, height: 1000 }],
        reference: { width: 800, height: 1000 },
        onClientRects,
      }),
    );

    mockClientRects({ top: 100, left: 50, width: 200, height: 20 });
    act(() => {
      selectText(container);
    });
    await waitFrames();

    expect(onClientRects).toHaveBeenCalled();
    const rects = onClientRects.mock.calls.at(-1)?.[0];
    expect(Array.isArray(rects)).toBe(true);
    expect(rects.length).toBeGreaterThan(0);
  });

  it('**返回值是稳定的**（不能每次渲染都换新对象）', () => {
    const container = makePage('Hello World');
    const { result, rerender } = renderHook(() =>
      useTextSelection({
        containerRef: { current: container },
        pageFrames: [{ pageNumber: 1, left: 0, top: 0, width: 800, height: 1000 }],
        reference: { width: 800, height: 1000 },
      }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
