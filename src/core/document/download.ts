/**
 * 触发浏览器下载（纯 DOM，**零网络依赖**）。
 *
 * ## 包的边界
 *
 * 包**不负责获取文件** —— 文件是宿主的（URL / Blob / ArrayBuffer / 服务端流）。
 * → 宿主拿到文件后调这个函数即可。
 *
 * → **换后端不用改包**（后端怎么给文件都行：接口、OSS、S3、本地文件）。
 *
 * ## 为什么不放在宿主侧
 *
 * 这段逻辑很短，但**每个宿主都会重复写一遍**，而且容易漏掉
 * `URL.revokeObjectURL`（→ 内存泄漏）。
 * → 放包里 → 一份实现，所有宿主复用。
 */

/**
 * 触发浏览器下载。
 *
 * @param data 文件内容（Blob 或字符串 / 二进制字符串）
 * @param filename 下载文件名
 * @param mimeType MIME 类型（用 Blob 时可省）
 *
 * @example
 * ```ts
 * downloadFile(pdfBlob, '论文.pdf');
 * ```
 */
export function downloadFile(
  data: Blob | string | ArrayBuffer | Uint8Array,
  filename: string,
  mimeType?: string,
): void {
  if (typeof document === 'undefined') {
    return;
  }

  const blob =
    data instanceof Blob
      ? data
      : new Blob([data as BlobPart], mimeType ? { type: mimeType } : undefined);

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  // ⚠️ 用 `removeChild`（`Element.remove()` 不接受参数）
  document.body.removeChild(anchor);

  /*
   * ⚠️ **必须 revoke**，否则 Blob 会一直占着内存。
   *
   * → 延后一点再 revoke（点击是同步的，但浏览器真正开始下载是异步的）
   * → 立刻 revoke 会导致下载失败。
   */
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
