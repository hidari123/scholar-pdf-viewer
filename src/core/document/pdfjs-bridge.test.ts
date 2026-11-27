/**
 * 默认 pdf.js 接线的回归测试。
 *
 * ⚠️ **重点测竞态**（实测踩到的坑，见 `pdfjs-bridge.ts` 里的说明）：
 *
 * -> `usePdfDocument` 先 `setData(bytes)` ✅ 再 `await docInfo(bytes)` ✅
 * -> 而 `docInfo` 里面才调 `bridge.open()` ✅
 * -> `setData` 会**立刻**触发"取可见页"的 effect ✅
 *    -> 那时 `open()` **还没跑完** ✅
 * -> 修法：`getPage()` 先 await `open()` 的 promise ✅
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** pdf.js 的假实现 */
const pdfjsMock = {
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
};

/** 假的一页 */
function fakePage(pageNumber: number) {
  return {
    pageNumber,
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
      transform: [scale, 0, 0, -scale, 0, 800 * scale],
    }),
    getTextContent: vi.fn(async () => ({
      items: [{ str: 'hello', transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10 }],
    })),
    render: vi.fn(),
  };
}

/** 假的文档 */
function fakeDoc(numPages = 3) {
  return {
    numPages,
    getPage: vi.fn(async (n: number) => fakePage(n)),
    getMetadata: vi.fn(async () => ({ info: {} })),
  };
}

describe('createDefaultPdfJsBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    pdfjsMock.getDocument.mockReset();
    // ⚠️ **pdf.js 的 `getDocument` 返回 `{ promise }`** ✅
    pdfjsMock.getDocument.mockImplementation(
      () => ({ promise: Promise.resolve(fakeDoc()) }) as never,
    );

    // ⚠️ **mock 掉 pdfjs-dist** ✅
    vi.doMock('pdfjs-dist', () => pdfjsMock);
  });

  afterEach(() => {
    vi.doUnmock('pdfjs-dist');
  });

  it('open 之后能取到页', async () => {
    const { createDefaultPdfJsBridge } = await import('./pdfjs-bridge');
    const bridge = await createDefaultPdfJsBridge();

    const info = await bridge.open(new Uint8Array([1, 2, 3]));
    expect(info.numPages).toBe(3);

    const page = await bridge.getPage(1);
    expect(page).toBeTruthy();
  });

  /**
   * ⚠️ **竞态回归**：先调 `getPage`（`open` 还没跑完）✅
   *
   * -> 修之前：返回 `undefined` ❌ -> 文本层整个没了 ❌
   * -> 修之后：等 `open` 跑完 ✅ -> 拿到页 ✅
   */
  it('getPage 在 open 之前调用时，会等 open 完成', async () => {
    let resolveDoc: ((doc: unknown) => void) | undefined;
    // ⚠️ **pdf.js 的 `getDocument` 返回 `{ promise }`** ✅
    pdfjsMock.getDocument.mockImplementation(
      () =>
        ({
          promise: new Promise((resolve) => {
            resolveDoc = resolve as (doc: unknown) => void;
          }),
        }) as never,
    );

    const { createDefaultPdfJsBridge } = await import('./pdfjs-bridge');
    const bridge = await createDefaultPdfJsBridge();

    // ⚠️ **先调 getPage**（此时 open 还没开始 ✅）
    const pagePromise = bridge.getPage(1);

    // ⚠️ **再调 open**（比 getPage 晚 ✅）
    const openPromise = bridge.open(new Uint8Array([1, 2, 3]));

    // ⚠️ **让 getDocument 的 promise 落地 ✅**
    resolveDoc?.(fakeDoc());
    await openPromise;

    const page = await pagePromise;
    expect(page).toBeTruthy();
    expect(typeof (page as { getTextContent?: unknown }).getTextContent).toBe('function');
  });

  it('getPageSizes 在 open 之前调用时，会等 open 完成', async () => {
    let resolveDoc: ((doc: unknown) => void) | undefined;
    pdfjsMock.getDocument.mockImplementation(
      () =>
        ({
          promise: new Promise((resolve) => {
            resolveDoc = resolve as (doc: unknown) => void;
          }),
        }) as never,
    );

    const { createDefaultPdfJsBridge } = await import('./pdfjs-bridge');
    const bridge = await createDefaultPdfJsBridge();

    const sizesPromise = bridge.getPageSizes(3);
    const openPromise = bridge.open(new Uint8Array([1, 2, 3]));
    resolveDoc?.(fakeDoc());
    await openPromise;

    const sizes = await sizesPromise;
    expect(sizes).toHaveLength(3);
    expect(sizes[0]?.width).toBe(600);
  });

  it('没调 open 就 getPage -> 返回 undefined', async () => {
    const { createDefaultPdfJsBridge } = await import('./pdfjs-bridge');
    const bridge = await createDefaultPdfJsBridge();
    expect(await bridge.getPage(1)).toBeUndefined();
  });
});
