// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrintOrientation } from '../core/print';
import { usePrint } from './usePrint';

/**
 * 等两帧（`print()` 会等 2 个 rAF 再调 `window.print`）。
 */
async function waitFrames() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

/**
 * 造一个"查看器根节点"。
 */
function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'scpdf-root';
  const page = document.createElement('div');
  page.className = 'scpdf-page';
  page.style.width = '1407.6px';
  page.style.height = '1821.6px';
  root.appendChild(page);
  document.body.appendChild(root);
  return root;
}

describe('usePrint（审核补测）', () => {
  it('**没有 root 时不该崩**', () => {
    const { result } = renderHook(() => usePrint({ root: null }));
    expect(result.current.print).toBeTypeOf('function');
    expect(result.current.preparing).toBe(false);
  });

  it('**print() 没有 root 时不抛**', () => {
    const { result } = renderHook(() => usePrint({ root: null }));
    expect(() => result.current.print()).not.toThrow();
  });

  it('**print() 会调 window.print**（等两帧后）', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const root = makeRoot();
    const { result } = renderHook(() => usePrint({ root }));
    act(() => {
      result.current.print();
    });
    await waitFrames();
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('**onAfterPrint 会被调**', async () => {
    const after = vi.fn();
    const root = makeRoot();
    const { result } = renderHook(() => usePrint({ root, onAfterPrint: after }));
    act(() => {
      result.current.print();
    });
    await waitFrames();
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(after).toHaveBeenCalled();
  });

  it('**会写 --scpdf-print-scale**（打印 CSS 依赖它）', async () => {
    const root = makeRoot();
    renderHook(() => usePrint({ root, paper: 'A4' }));
    await waitFrames();
    const scale = root.style.getPropertyValue('--scpdf-print-scale');
    expect(scale).not.toBe('');
    const value = Number.parseFloat(scale);
    expect(value).toBeGreaterThan(0);
    // ⚠️ **A4 比 A4 页面小一点** -> 缩放应该 < 1
    expect(value).toBeLessThan(1);
  });

  it('**会写每页的打印宽高**', async () => {
    const root = makeRoot();
    renderHook(() => usePrint({ root }));
    await waitFrames();
    const page = root.querySelector('.scpdf-page') as HTMLElement;
    expect(page.style.getPropertyValue('--scpdf-print-page-width')).toBe('1407.6px');
    expect(page.style.getPropertyValue('--scpdf-print-page-height')).toBe('1821.6px');
  });

  /*
   * ⚠️⚠️ **打印只出前几页**（用户反馈）
   *
   * > "打印纵向只出前几页"
   *
   * ## 根因
   *
   * -> Chrome 的打印分页按**布局盒高度**算
   * -> -> 如果页的 layout box **没被缩**
   * -> -> 一张 A4（1032px）塞不下 1821px 的页
   * -> -> 每页占 **2 张纸** ✅ -> **后面的页被挤出打印范围** ✅ ❌
   *
   * ## 断言
   *
   * -> **缩放后的页高** <= **A4 可打印高度**
   * -> -> 这样才**一页一张纸**
   */
  it('**缩放后的页高要放得进一张 A4**（否则会跨纸）', async () => {
    const root = makeRoot();
    renderHook(() => usePrint({ root, paper: 'A4', orientation: 'portrait' }));
    await waitFrames();

    const scale = Number.parseFloat(root.style.getPropertyValue('--scpdf-print-scale'));
    const pageHeight = 1821.6;

    // ⚠️ **A4 纵向减去边距**（12mm × 4）-> 703 × 1032 px
    const printableHeight = (297 - 12 - 12) * (96 / 25.4);

    expect(scale).toBeGreaterThan(0);
    expect(pageHeight * scale).toBeLessThanOrEqual(printableHeight);
  });

  /*
   * ⚠️⚠️ **打印的页面显示不全**（用户反馈）
   *
   * > "打印的页面显示也不全 只能展示出来已经缓存的一些 后面都是空白页"
   *
   * ## 根因
   *
   * -> 页是**虚拟化渲染**的  -> 平时只渲染**看得见的**
   * -> -> 打印时开始渲染**所有页**
   * -> -> **但 canvas 渲染是异步的**
   * -> -> 原来只等 **2 帧** ✅ -> 14 页**画不完** ✅ ❌
   * -> -> 打印开始时只有**前 2~3 页**有内容 ✅ -> 后面是**空白页** ✅ ❌
   *
   * ## 修法
   *
   * -> 等到**每个 canvas 都画上有内容**  或者**超时兜底**
   */
  it('**会等所有页的 canvas 画完**（不然后面是空白页）', async () => {
    const root = makeRoot();
    /*
     * ⚠️ **给 canvas 打桩**
     *
     * -> jsdom **没有真实的 2D 上下文**  -> `getContext('2d')`  返回 null
     * -> -> 我们**造一个假的**  -> 能测"等待"这个逻辑
     */
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let painted = false;
    HTMLCanvasElement.prototype.getContext = function fakeGetContext(
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind !== '2d') {
        return null;
      }
      return {
        getImageData: () => ({
          data: painted
            ? new Uint8ClampedArray([0, 0, 0, 255])
            : new Uint8ClampedArray([0, 0, 0, 0]),
        }),
      } as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const page = root.querySelector('.scpdf-page') as HTMLElement;
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    page.appendChild(canvas);

    let printed = false;
    const originalPrint = globalThis.print;
    globalThis.print = () => {
      printed = true;
    };

    try {
      const { result } = renderHook(() => usePrint({ root }));
      await waitFrames();
      result.current.print();

      // ⚠️ **还没画完 -> 不应该打印**
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(printed).toBe(false);

      // ⚠️ **画完了 -> 才打印**
      painted = true;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      await waitFrames();
      expect(printed).toBe(true);
    } finally {
      globalThis.print = originalPrint;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  it('**横向时缩放更小**（横向纸更矮）', async () => {
    const root = makeRoot();
    const { rerender } = renderHook(
      ({ orientation }: { orientation: PrintOrientation }) =>
        usePrint({ root, paper: 'A4', orientation }),
      { initialProps: { orientation: 'portrait' as PrintOrientation } },
    );
    await waitFrames();
    const portrait = Number.parseFloat(root.style.getPropertyValue('--scpdf-print-scale'));

    rerender({ orientation: 'landscape' });
    await waitFrames();
    const landscape = Number.parseFloat(root.style.getPropertyValue('--scpdf-print-scale'));

    /*
     * ⚠️⚠️ **横向 A4 更【矮】，不是更宽**
     *
     * -> 竖向 A4: 210 x 297 mm -> 内容区 703 x **1032** px
     * -> 横向 A4: 297 x 210 mm -> 内容区 1032 x **703** px
     * -> 页高 1821px -> 竖向受限于 1032px（scale 0.50）
     *                -> 横向受限于  703px（scale 0.39）
     * -> -> **横向的缩放更小** ✅（不是更大 ❌）
     */
    expect(landscape).toBeLessThan(portrait);
    // ⚠️ **两个都要能放下整页** ✅（不能比纸还大 ❌）
    expect(portrait * 1821.6).toBeLessThanOrEqual(1032 + 1);
    expect(landscape * 1821.6).toBeLessThanOrEqual(703 + 1);
  });
});
