import { describe, expect, it } from 'vitest';
import type { PdfViewerError } from '../errors';
import type { FetchLike } from './loader';
import { loadDocument, loadFromData, loadFromUrl, toPdfViewerError } from './loader';

/** 最小合法 PDF 头（magic bytes 校验只需前 5 字节） */
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x01, 0x02]);

/** 构造 fake fetch：按脚本依次返回预设响应 */
function fakeFetch(
  handler: (
    url: string,
    init?: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }>,
): FetchLike {
  return (url, init) => handler(url, init);
}

/** 构造一个响应对象 */
function response(init: {
  ok?: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}): {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  const headers = init.headers ?? {};
  const body = init.body ?? PDF_HEAD;
  return {
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => body.buffer.slice(0) as ArrayBuffer,
  };
}

/** 取出错误码（断言用） */
async function codeOf(promise: Promise<unknown>): Promise<PdfViewerError['code']> {
  try {
    await promise;
  } catch (error) {
    return (error as PdfViewerError).code;
  }
  throw new Error('期望抛错，但没有');
}

describe('loadFromUrl', () => {
  it('200 全量：返回字节与大小，partial=false', async () => {
    const result = await loadFromUrl(
      'https://example.com/a.pdf',
      {
        fetchImpl: fakeFetch(async () => response({ status: 200, body: PDF_HEAD })),
      },
      1,
    );

    expect(result.size).toBe(PDF_HEAD.byteLength);
    expect(result.partial).toBe(false);
    expect(result.data[0]).toBe(0x25);
  });

  it('206 分段：partial=true', async () => {
    const result = await loadFromUrl('https://example.com/a.pdf', {
      fetchImpl: fakeFetch(async () =>
        response({ status: 206, headers: { 'content-range': 'bytes 0-6/100' } }),
      ),
    });

    expect(result.partial).toBe(true);
  });

  it('服务端不支持 Range（405）：降级为全量重试', async () => {
    const calls: string[] = [];
    const result = await loadFromUrl('https://example.com/a.pdf', {
      fetchImpl: fakeFetch(async (_url, init) => {
        calls.push(init?.headers?.Range ?? 'no-range');
        if (init?.headers?.Range) {
          return response({ status: 405 });
        }
        return response({ status: 200 });
      }),
    });

    expect(calls).toEqual(['bytes=0-', 'no-range']);
    expect(result.partial).toBe(false);
  });

  it('206 但无 content-range：视为全量', async () => {
    const result = await loadFromUrl('https://example.com/a.pdf', {
      fetchImpl: fakeFetch(async () => response({ status: 206 })),
    });

    expect(result.partial).toBe(false);
  });

  it('非 2xx → E_LOAD_HTTP（含状态码）', async () => {
    const error = await codeOf(
      loadFromUrl('https://example.com/a.pdf', {
        fetchImpl: fakeFetch(async () => response({ status: 404 })),
      }),
    );

    expect(error).toBe('E_LOAD_HTTP');
  });

  it('网络异常 → E_LOAD_NETWORK', async () => {
    const error = await codeOf(
      loadFromUrl('https://example.com/a.pdf', {
        fetchImpl: fakeFetch(async () => {
          throw new TypeError('Failed to fetch');
        }),
      }),
    );

    expect(error).toBe('E_LOAD_NETWORK');
  });

  it('超时 → E_LOAD_TIMEOUT（区分宿主主动取消）', async () => {
    const error = await codeOf(
      loadFromUrl('https://example.com/a.pdf', {
        timeoutMs: 5,
        fetchImpl: fakeFetch(
          async (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        ),
      }),
    );

    expect(error).toBe('E_LOAD_TIMEOUT');
  });

  it('空响应 → E_EMPTY', async () => {
    const error = await codeOf(
      loadFromUrl('https://example.com/a.pdf', {
        fetchImpl: fakeFetch(async () => response({ status: 200, body: new Uint8Array() })),
      }),
    );

    expect(error).toBe('E_EMPTY');
  });

  it('非 PDF 内容 → E_PDF_INVALID（magic bytes 校验）', async () => {
    const error = await codeOf(
      loadFromUrl('https://example.com/a.txt', {
        fetchImpl: fakeFetch(async () =>
          response({ status: 200, body: new Uint8Array([0x68, 0x69]) }),
        ),
      }),
    );

    expect(error).toBe('E_PDF_INVALID');
  });
});

describe('loadFromData', () => {
  it('Uint8Array / ArrayBuffer / Blob 都能加载', async () => {
    const fromBytes = await loadFromData(PDF_HEAD);
    const fromBuffer = await loadFromData(PDF_HEAD.buffer.slice(0) as ArrayBuffer);
    const fromBlob = await loadFromData(new Blob([PDF_HEAD]));

    expect(fromBytes.size).toBe(PDF_HEAD.byteLength);
    expect(fromBuffer.size).toBe(PDF_HEAD.byteLength);
    expect(fromBlob.size).toBe(PDF_HEAD.byteLength);
  });

  it('空数据 → E_EMPTY', async () => {
    expect(await codeOf(loadFromData(new Uint8Array()))).toBe('E_EMPTY');
  });

  it('非 PDF → E_PDF_INVALID', async () => {
    expect(await codeOf(loadFromData(new Uint8Array([1, 2, 3])))).toBe('E_PDF_INVALID');
  });
});

describe('loadDocument 统一入口', () => {
  it('URL 走网络路径，内存走本地路径', async () => {
    const viaUrl = await loadDocument('https://example.com/a.pdf', {
      fetchImpl: fakeFetch(async () => response({ status: 200 })),
    });
    const viaData = await loadDocument(PDF_HEAD);

    expect(viaUrl.size).toBe(PDF_HEAD.byteLength);
    expect(viaData.size).toBe(PDF_HEAD.byteLength);
  });
});

describe('toPdfViewerError（pdf.js 异常归一）', () => {
  it('PasswordException → E_PDF_ENCRYPTED', () => {
    const error = Object.assign(new Error('password'), { name: 'PasswordException' });
    expect(toPdfViewerError(error).code).toBe('E_PDF_ENCRYPTED');
  });

  it('InvalidPDFException → E_PDF_INVALID', () => {
    const error = Object.assign(new Error('invalid'), { name: 'InvalidPDFException' });
    expect(toPdfViewerError(error).code).toBe('E_PDF_INVALID');
  });

  it('已是 PdfViewerError 则原样返回', () => {
    const original = { code: 'E_EMPTY' as const, message: 'x' };
    expect(toPdfViewerError(original)).toBe(original);
  });

  it('未知异常 → E_PDF_INVALID（带 cause）', () => {
    const error = toPdfViewerError(new Error('boom'));
    expect(error.code).toBe('E_PDF_INVALID');
    expect(error.cause).toBeInstanceOf(Error);
  });
});
