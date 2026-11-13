// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../core/document/loader';
import { usePdfDocument } from './usePdfDocument';

/** 最小 PDF 头 */
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x01, 0x02]);

/** 造 fake fetch */
function fakeFetch(
  handler: (url: string) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }>,
): FetchLike {
  return (url) => handler(url);
}

/** 成功响应 */
function okResponse(body: Uint8Array = PDF_HEAD) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => body.buffer.slice(0) as ArrayBuffer,
  };
}

describe('usePdfDocument', () => {
  it('加载成功后拿到数据', async () => {
    const { result } = renderHook(() =>
      usePdfDocument({
        file: 'https://example.com/a.pdf',
        loadOptions: { fetchImpl: fakeFetch(async () => okResponse()) },
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('加载中状态为 true', async () => {
    const { result } = renderHook(() =>
      usePdfDocument({
        file: 'https://example.com/a.pdf',
        loadOptions: {
          fetchImpl: fakeFetch(
            async () =>
              new Promise((resolve) => {
                setTimeout(() => resolve(okResponse()), 50);
              }),
          ),
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });

  it('HTTP 错误 → onError 收到 E_LOAD_HTTP', async () => {
    const onError = vi.fn();

    const { result } = renderHook(() =>
      usePdfDocument({
        file: 'https://example.com/a.pdf',
        onError,
        loadOptions: {
          fetchImpl: fakeFetch(async () => ({
            ok: false,
            status: 404,
            headers: { get: () => null },
            arrayBuffer: async () => new ArrayBuffer(0),
          })),
        },
      }),
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    expect(result.current.error?.code).toBe('E_LOAD_HTTP');
  });

  it('非 PDF 内容 → E_PDF_INVALID', async () => {
    const { result } = renderHook(() =>
      usePdfDocument({
        file: 'https://example.com/a.txt',
        loadOptions: {
          fetchImpl: fakeFetch(async () => okResponse(new Uint8Array([1, 2, 3]))),
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.error?.code).toBe('E_PDF_INVALID');
    });
  });

  it('file 为 null 时不加载', async () => {
    const { result } = renderHook(() =>
      usePdfDocument({
        file: null,
        loadOptions: { fetchImpl: fakeFetch(async () => okResponse()) },
      }),
    );

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('换文件：旧请求的结果被丢弃（loadId 竞态保护）', async () => {
    const resolvers: ((value: ReturnType<typeof okResponse>) => void)[] = [];

    const fetchImpl = fakeFetch(
      async () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result, rerender } = renderHook(
      (props: { file: string }) => usePdfDocument({ file: props.file, loadOptions: { fetchImpl } }),
      { initialProps: { file: 'https://example.com/a.pdf' } },
    );

    // 等第一个请求发出
    await waitFor(() => {
      expect(resolvers.length).toBe(1);
    });

    // 切到另一个文件 → 第二个请求发出
    rerender({ file: 'https://example.com/b.pdf' });

    await waitFor(() => {
      expect(resolvers.length).toBe(2);
    });

    // 第一个请求返回（已过期）→ 必须被丢弃，不能写入 state
    await act(async () => {
      resolvers[0]?.(okResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xaa])));
      await Promise.resolve();
    });

    expect(result.current.data).toBeNull();

    // 第二个请求返回 → 生效
    await act(async () => {
      resolvers[1]?.(okResponse());
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
  });

  it('getDocInfo 成功 → onDocumentLoad 被调用', async () => {
    const onDocumentLoad = vi.fn();

    renderHook(() =>
      usePdfDocument({
        file: 'https://example.com/a.pdf',
        onDocumentLoad,
        getDocInfo: async () => ({ numPages: 42, title: 'T' }),
        loadOptions: { fetchImpl: fakeFetch(async () => okResponse()) },
      }),
    );

    await waitFor(() => {
      expect(onDocumentLoad).toHaveBeenCalledWith({ numPages: 42, title: 'T' });
    });
  });
});
