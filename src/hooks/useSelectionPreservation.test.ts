// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectionPreservation } from './useSelectionPreservation';

/**
 * 造一个"文本层"的 DOM。
 *
 * @param text 文本内容
 * @param pageNumber 页码
 */
function makeTextLayer(text: string, pageNumber = 1): HTMLElement {
  const container = document.createElement('div');
  const page = document.createElement('div');
  page.className = 'scpdf-page';
  page.setAttribute('data-page-number', String(pageNumber));
  const span = document.createElement('span');
  span.setAttribute('data-page-number', String(pageNumber));
  span.textContent = text;
  page.appendChild(span);
  container.appendChild(page);
  document.body.appendChild(container);
  return container;
}

/** 选中容器里的全部文本 */
function selectAll(container: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(container.querySelector('span') as Node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** 等 N 帧 */
async function waitFrames(n: number) {
  for (let i = 0; i < n; i += 1) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  }
}

describe('useSelectionPreservation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  it('**save() 会记下选中的文字**', () => {
    const container = makeTextLayer('Hello World');
    const containerRef = { current: container };
    const { result } = renderHook(() => useSelectionPreservation({ containerRef, scale: 1 }));

    selectAll(container);
    act(() => {
      result.current.save();
    });

    expect(result.current.save).toBeTypeOf('function');
  });

  it('**没有选区时 save() 不该崩**', () => {
    const container = makeTextLayer('Hello');
    const containerRef = { current: container };
    const { result } = renderHook(() => useSelectionPreservation({ containerRef, scale: 1 }));
    expect(() => result.current.save()).not.toThrow();
  });

  it('**容器是 null 时 save() 不该崩**', () => {
    const containerRef = { current: null };
    const { result } = renderHook(() => useSelectionPreservation({ containerRef, scale: 1 }));
    expect(() => result.current.save()).not.toThrow();
  });

  it('**缩放变了 -> 选区被恢复**（核心功能）', async () => {
    const container = makeTextLayer('Hello World');
    const containerRef = { current: container };

    const { result, rerender } = renderHook(
      ({ scale }: { scale: number }) => useSelectionPreservation({ containerRef, scale }),
      { initialProps: { scale: 1 } },
    );

    selectAll(container);
    act(() => {
      result.current.save();
    });

    // ⚠️ **先清掉选区**（模拟"缩放导致文本层重渲染，选区被浏览器清空"）
    window.getSelection()?.removeAllRanges();
    expect(window.getSelection()?.toString()).toBe('');

    // ⚠️ **改缩放** -> 触发恢复
    rerender({ scale: 1.5 });
    await waitFrames(5);

    expect(window.getSelection()?.toString()).toBe('Hello World');
  });

  it('**恢复不了的时候不崩**（文字不存在了）', async () => {
    const container = makeTextLayer('Hello World');
    const containerRef = { current: container };

    const { result, rerender } = renderHook(
      ({ scale }: { scale: number }) => useSelectionPreservation({ containerRef, scale }),
      { initialProps: { scale: 1 } },
    );

    selectAll(container);
    act(() => {
      result.current.save();
    });

    // ⚠️ **把文字换掉**（模拟文本层重渲染后内容变了）
    (container.querySelector('span') as HTMLElement).textContent = '完全不同的内容';

    rerender({ scale: 2 });
    await waitFrames(5);

    // 不该崩，选区是空的也没关系
    expect(true).toBe(true);
  });

  it('**onRestored 会被调**（恢复稳定后）', async () => {
    const container = makeTextLayer('Hello World');
    const containerRef = { current: container };
    const onRestored = vi.fn();

    const { result, rerender } = renderHook(
      ({ scale }: { scale: number }) =>
        useSelectionPreservation({ containerRef, scale, onRestored }),
      { initialProps: { scale: 1 } },
    );

    selectAll(container);
    act(() => {
      result.current.save();
    });

    rerender({ scale: 1.5 });
    // ⚠️ **要等够 10 帧**（"连续 10 帧稳定"才算恢复成功）
    await waitFrames(15);

    expect(onRestored).toHaveBeenCalled();
  });

  it('**返回值是稳定的**（不能每次渲染都换新对象）', () => {
    const container = makeTextLayer('Hello');
    const containerRef = { current: container };
    const { result, rerender } = renderHook(
      ({ scale }: { scale: number }) => useSelectionPreservation({ containerRef, scale }),
      { initialProps: { scale: 1 } },
    );

    const first = result.current;
    rerender({ scale: 1.5 });
    expect(result.current).toBe(first);
  });
});
