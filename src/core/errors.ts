/**
 * 错误码体系 —— 宿主据此做重试 / 提示 / 降级，而不是 catch 一个说不清的 Error。
 *
 * 设计原则：
 * - 每类错误有**确定的归属层**（加载 / 渲染 / 缓存 / 交互），宿主能据此决策
 * - 错误对象永远带 `cause`（原始异常）→ 排障时可追到根
 * - 不抛字符串、不抛裸 Error：全部经 `pdfViewerError()` 构造，字段一致
 */

/** 全部错误码（12 条） */
export type PdfViewerErrorCode =
  // 加载层（7 条）
  | 'E_LOAD_HTTP'
  | 'E_LOAD_NETWORK'
  | 'E_LOAD_TIMEOUT'
  | 'E_PDF_INVALID'
  | 'E_EMPTY'
  | 'E_PDF_ENCRYPTED'
  | 'E_PDF_PASSWORD_WRONG'
  // 渲染层（2 条）
  | 'E_RENDER_PAGE'
  | 'E_FONT_MISSING'
  // 缓存层（2 条）
  | 'E_CACHE_QUOTA'
  | 'E_CACHE_UNAVAILABLE'
  // 交互层（1 条）
  | 'E_LINK_INVALID';

/** 错误码 → 中文默认文案（宿主可用 `messages` 覆盖） */
const DEFAULT_MESSAGES: Record<PdfViewerErrorCode, string> = {
  E_LOAD_HTTP: '文档加载失败（服务器错误）',
  E_LOAD_NETWORK: '文档加载失败（网络异常）',
  E_LOAD_TIMEOUT: '文档加载超时',
  E_PDF_INVALID: '文件不是有效的 PDF',
  E_EMPTY: '文件为空',
  E_PDF_ENCRYPTED: '文档已加密，需要密码',
  E_PDF_PASSWORD_WRONG: '密码错误',
  E_RENDER_PAGE: '页面渲染失败',
  E_FONT_MISSING: '字体资源缺失',
  E_CACHE_QUOTA: '缓存空间不足',
  E_CACHE_UNAVAILABLE: '缓存不可用（已降级为内存模式）',
  E_LINK_INVALID: '链接目标无效',
};

/** 包内统一错误对象 */
export interface PdfViewerError {
  code: PdfViewerErrorCode;
  /** 可直接展示的文案（宿主可覆盖） */
  message: string;
  /** 原始异常（排障用） */
  cause?: unknown;
  /** 出错页码（1-based，若与页相关） */
  pageNumber?: number;
  /**
   * **这个错误能不能重试？**
   *
   * ⚠️ README 一直写着错误对象"带 `retryable`"，但**字段根本不存在** ❌
   *   -> 宿主写 \`error.retryable\` -> **永远 undefined**（falsy）❌
   *   -> 宿主以为"不可重试" -> **不给用户重试按钮** ❌
   *
   * → 现在：**字段真的存在**
   * -> 值和 \`isRetryable(error)\` **保持一致**
   * -> 宿主可以直接 \`if (error.retryable) showRetryButton()\`
   */
  retryable: boolean;
}

/**
 * **可重试的错误码**。
 *
 * ⚠️ **只包含"重试有可能成功"的**：
 * -> 网络 / 超时 / HTTP 5xx -> **重试有意义**
 * -> 文件不是 PDF / 密码错 -> **重试没用**（用户得换文件 / 换密码）❌
 */
const RETRYABLE_CODES: readonly PdfViewerErrorCode[] = [
  'E_LOAD_NETWORK',
  'E_LOAD_TIMEOUT',
  'E_LOAD_HTTP',
];

/** 构造统一错误对象（`message` 可覆盖默认文案） */
export function pdfViewerError(
  code: PdfViewerErrorCode,
  options?: { message?: string; cause?: unknown; pageNumber?: number },
): PdfViewerError {
  const error: PdfViewerError = {
    code,
    message: options?.message ?? DEFAULT_MESSAGES[code],
    retryable: RETRYABLE_CODES.includes(code),
  };

  if (options?.cause !== undefined) {
    error.cause = options.cause;
  }
  if (options?.pageNumber !== undefined) {
    error.pageNumber = options.pageNumber;
  }

  return error;
}

/**
 * 是否某个错误码属于"可重试"类（宿主据此决定是否提示重试按钮）。
 *
 * ⚠️ **和 `error.retryable` 字段保持一致**（用同一份名单）
 */
export function isRetryable(error: PdfViewerError): boolean {
  return error.retryable ?? RETRYABLE_CODES.includes(error.code);
}
