/**
 * 文档加载管线 —— PDF 的第一道门。
 *
 * 流程：
 *   URL? → fetch（Range 预检：容忍 405/206，206 走分段，405 降级全量）
 *        → 非 2xx → E_LOAD_HTTP
 *        → 超时 → E_LOAD_TIMEOUT
 *        → 网络异常 → E_LOAD_NETWORK
 *        → size === 0 → E_EMPTY
 *        → magic bytes ≠ %PDF- → E_PDF_INVALID
 *   Blob / ArrayBuffer → 跳过网络层，直接校验
 *   校验通过 → 交给 pdf.js（getDocument）
 *
 * 设计要点：
 * - `fetch` **注入**：core 层零全局依赖 → node 环境可单测（不碰真实网络）
 * - magic bytes 在**进 pdf.js 之前**校验：pdf.js 对非 PDF 的报错不可控，我们给宿主明确的 E_PDF_INVALID
 * - Range 只在服务端明确支持时使用：405/501 一律降级为全量（很多静态服务器/CDN 不支持 Range）
 * - `loadId` 由调用方持有：换文件时旧响应到达即丢弃（同一 URL 换内容也必须重载）
 */

import type { PdfViewerError } from '../errors';
import { pdfViewerError } from '../errors';

/** PDF 文件头（magic bytes） */
const PDF_MAGIC = '%PDF-';

/** 默认超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 注入的 fetch 形态（与浏览器 fetch 兼容，便于测试替身） */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** 加载选项 */
export interface LoadOptions {
  /** 注入的 fetch（默认 globalThis.fetch） */
  fetchImpl?: FetchLike;
  /** 超时（毫秒，默认 30000；0 = 不限时） */
  timeoutMs?: number;
  /** 额外请求头（宿主可传鉴权等） */
  headers?: Record<string, string>;
  /** 进度回调（已加载字节 / 总字节） */
  onProgress?: (loaded: number, total: number) => void;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** 加载结果 */
export interface LoadedDocument {
  /** 文档字节 */
  data: Uint8Array;
  /** 字节数 */
  size: number;
  /** 是否走了 Range 分段（false = 全量下载） */
  partial: boolean;
}

/** 读取前 N 字节用于 magic bytes 校验 */
function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) {
    return false;
  }
  for (let i = 0; i < PDF_MAGIC.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

/**
 * 从 URL 加载文档字节。
 *
 * @param url 文档地址
 * @param options 加载选项
 * @param loadId 本次加载标识；调用方负责比对（换文件竞态由调用方丢弃旧结果）
 */
export async function loadFromUrl(
  url: string,
  options: LoadOptions = {},
  loadId = 0,
): Promise<LoadedDocument> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw pdfViewerError('E_LOAD_NETWORK', { message: '当前环境不支持 fetch' });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : undefined;

  // 宿主取消 → 透传 abort
  const onAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onAbort);

  try {
    // 第一段：Range 预检（服务端不支持时降级全量）
    let partial = false;
    let response: Awaited<ReturnType<FetchLike>>;

    try {
      response = await fetchImpl(url, {
        headers: { ...options.headers, Range: 'bytes=0-' },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        // 区分"超时中止"与"宿主主动取消"
        throw options.signal?.aborted
          ? pdfViewerError('E_LOAD_NETWORK', { message: '加载已取消', cause: error })
          : pdfViewerError('E_LOAD_TIMEOUT', { cause: error });
      }
      throw pdfViewerError('E_LOAD_NETWORK', { cause: error });
    }

    if (response.status === 206) {
      partial = true;
    } else if (response.status === 405 || response.status === 501) {
      // 服务端明确不支持 Range → 全量重试
      response = await fetchImpl(url, {
        headers: options.headers,
        signal: controller.signal,
      });
      partial = false;
    } else if (!response.ok) {
      throw pdfViewerError('E_LOAD_HTTP', {
        message: `文档加载失败（HTTP ${response.status}）`,
        cause: response.status,
      });
    }

    // 206 但服务端没给 content-range → 视为全量（部分服务端行为不一致）
    if (partial && !response.headers.get('content-range')) {
      partial = false;
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    if (data.byteLength === 0) {
      throw pdfViewerError('E_EMPTY', { cause: `loadId=${loadId}` });
    }

    if (!hasPdfMagic(data)) {
      throw pdfViewerError('E_PDF_INVALID', { cause: `loadId=${loadId}` });
    }

    const total = Number(response.headers.get('content-length') ?? data.byteLength);
    options.onProgress?.(data.byteLength, total);

    return { data, size: data.byteLength, partial };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 从内存数据加载（Blob / ArrayBuffer / Uint8Array）。
 *
 * 同样做空文件与 magic bytes 校验——本地文件损坏时也要给宿主明确错误。
 */
export async function loadFromData(
  source: Blob | ArrayBuffer | Uint8Array,
  loadId = 0,
): Promise<LoadedDocument> {
  let data: Uint8Array;

  if (source instanceof Uint8Array) {
    data = source;
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source);
  } else {
    data = new Uint8Array(await source.arrayBuffer());
  }

  if (data.byteLength === 0) {
    throw pdfViewerError('E_EMPTY', { cause: `loadId=${loadId}` });
  }

  if (!hasPdfMagic(data)) {
    throw pdfViewerError('E_PDF_INVALID', { cause: `loadId=${loadId}` });
  }

  return { data, size: data.byteLength, partial: false };
}

/** 文档来源 */
export type DocumentSource = string | Blob | ArrayBuffer | Uint8Array;

/**
 * 统一入口：按来源类型分发到 URL / 内存加载路径。
 */
export async function loadDocument(
  source: DocumentSource,
  options: LoadOptions = {},
  loadId = 0,
): Promise<LoadedDocument> {
  if (typeof source === 'string') {
    return loadFromUrl(source, options, loadId);
  }
  return loadFromData(source, loadId);
}

/** 重新抛出为统一错误（pdf.js 的异常归一化在此） */
export function toPdfViewerError(error: unknown): PdfViewerError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as PdfViewerError;
  }

  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';

  if (name === 'PasswordException') {
    return pdfViewerError('E_PDF_ENCRYPTED', { cause: error });
  }

  if (name === 'InvalidPDFException') {
    return pdfViewerError('E_PDF_INVALID', { cause: error });
  }

  return pdfViewerError('E_PDF_INVALID', { cause: error });
}
