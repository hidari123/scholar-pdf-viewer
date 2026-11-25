// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePrintOriginal } from './usePrintOriginal';

describe('usePrintOriginal（打印原 PDF ✅）', () => {
  /*
   * ⚠️ **每个测试后清掉 iframe** ✅
   * -> 不清 ✅ -> 上一个测试的 iframe ✅ 还在 ✅ -> 计数不对 ✅ ❌
   */
  afterEach(() => {
    for (const frame of document.querySelectorAll('iframe')) {
      frame.remove();
    }
  });

  it('**没有 URL 时不建 iframe** ✅', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => usePrintOriginal({ url: null, onError }));
    result.current.print();
    expect(document.querySelectorAll('iframe').length).toBe(0);
    expect(onError).toHaveBeenCalled();
  });

  it('**有 URL 时建一个隐藏的 iframe** ✅', () => {
    const { result } = renderHook(() => usePrintOriginal({ url: '/sample.pdf' }));
    result.current.print();
    const frames = [...document.querySelectorAll('iframe')];
    expect(frames.length).toBe(1);
    expect(frames[0]?.src).toContain('/sample.pdf');
    // ⚠️ **必须【看不见】** ✅ -> 不干扰用户的屏幕 ✅
    expect(frames[0]?.style.visibility).toBe('hidden');
    expect(frames[0]?.style.width).toBe('0px');
    expect(frames[0]?.style.height).toBe('0px');
  });

  it('**URL 变化时重新建 iframe** ✅', () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => usePrintOriginal({ url }),
      { initialProps: { url: '/a.pdf' as string | null } },
    );
    result.current.print();
    rerender({ url: '/b.pdf' });
    result.current.print();
    const frames = [...document.querySelectorAll('iframe')];
    expect(frames.length).toBe(2);
    expect(frames[1]?.src).toContain('/b.pdf');
  });
});
