/**
 * `core/errors` 的单元测试。
 *
 * ## 为什么现在才加（审计发现的）
 *
 * → \`pdfViewerError\` / \`isRetryable\` 是**包的根导出**（\`src/index.ts\`）❌
 *   -> 但**零测试** ❌
 * -> 12 个错误码的 \`DEFAULT_MESSAGES\` 表**从没被断言过** ❌
 *   -> 少一条 / 拼错一个 -> \`message: undefined\` **直接发给宿主** ❌
 * -> README 一直说错误对象"带 \`retryable\`" -> 但**字段根本不存在** ❌
 *   -> 宿主写 \`error.retryable\` -> **永远 undefined** ❌
 */

import { describe, expect, it } from 'vitest';
import { isRetryable, pdfViewerError } from './errors';

describe('pdfViewerError', () => {
  /** 12 个错误码（和 `PdfViewerErrorCode` 一致） */
  const ALL_CODES = [
    'E_LOAD_HTTP',
    'E_LOAD_NETWORK',
    'E_LOAD_TIMEOUT',
    'E_PDF_INVALID',
    'E_EMPTY',
    'E_PDF_ENCRYPTED',
    'E_PDF_PASSWORD_WRONG',
    'E_RENDER_PAGE',
    'E_FONT_MISSING',
    'E_CACHE_QUOTA',
    'E_CACHE_UNAVAILABLE',
    'E_LINK_INVALID',
  ] as const;

  it('**每个错误码都有非空的默认文案**（少一条 -> 宿主拿到 undefined）', () => {
    for (const code of ALL_CODES) {
      const error = pdfViewerError(code);
      expect(error.code).toBe(code);
      expect(typeof error.message).toBe('string');
      // ⚠️ 不能是空串 -> 宿主会显示一个空白错误
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('**每个错误码都有 retryable 字段**（README 一直说有）', () => {
    for (const code of ALL_CODES) {
      const error = pdfViewerError(code);
      expect(typeof error.retryable).toBe('boolean');
    }
  });

  it('可覆盖文案', () => {
    const error = pdfViewerError('E_LOAD_HTTP', { message: '自定义文案' });
    expect(error.message).toBe('自定义文案');
  });

  it('cause 没传就不出现（不是 undefined 键）', () => {
    const error = pdfViewerError('E_LOAD_HTTP');
    expect('cause' in error).toBe(false);
  });

  it('cause 传了就带上', () => {
    const cause = new Error('boom');
    const error = pdfViewerError('E_LOAD_NETWORK', { cause });
    expect(error.cause).toBe(cause);
  });

  it('pageNumber = 0 也要带上（不能用真值判断）', () => {
    const error = pdfViewerError('E_RENDER_PAGE', { pageNumber: 0 });
    expect(error.pageNumber).toBe(0);
  });

  it('pageNumber 没传就不出现', () => {
    const error = pdfViewerError('E_RENDER_PAGE');
    expect('pageNumber' in error).toBe(false);
  });
});

describe('isRetryable', () => {
  it('**网络 / 超时 / HTTP 错误 -> 可重试**', () => {
    expect(isRetryable(pdfViewerError('E_LOAD_NETWORK'))).toBe(true);
    expect(isRetryable(pdfViewerError('E_LOAD_TIMEOUT'))).toBe(true);
    expect(isRetryable(pdfViewerError('E_LOAD_HTTP'))).toBe(true);
  });

  it('**文件坏了 / 密码错 -> 不可重试**（重试没用）', () => {
    expect(isRetryable(pdfViewerError('E_PDF_INVALID'))).toBe(false);
    expect(isRetryable(pdfViewerError('E_EMPTY'))).toBe(false);
    expect(isRetryable(pdfViewerError('E_PDF_PASSWORD_WRONG'))).toBe(false);
    expect(isRetryable(pdfViewerError('E_PDF_ENCRYPTED'))).toBe(false);
  });

  it('**和 `error.retryable` 字段保持一致**', () => {
    const codes = [
      'E_LOAD_HTTP',
      'E_LOAD_NETWORK',
      'E_LOAD_TIMEOUT',
      'E_PDF_INVALID',
      'E_EMPTY',
      'E_PDF_ENCRYPTED',
      'E_PDF_PASSWORD_WRONG',
      'E_RENDER_PAGE',
      'E_FONT_MISSING',
      'E_CACHE_QUOTA',
      'E_CACHE_UNAVAILABLE',
      'E_LINK_INVALID',
    ] as const;
    for (const code of codes) {
      const error = pdfViewerError(code);
      expect(isRetryable(error)).toBe(error.retryable);
    }
  });
});
