/**
 * **打印原 PDF**（像 Chrome 一样 ✅）。
 *
 * ## 为什么需要（用户反馈 ✅）
 *
 * > "打印的页面显示也不全 只能展示出来已经缓存的一些 后面都是空白页"
 *
 * ## 根因 ✅
 *
 * -> 我们是**用 DOM + canvas 打印**的 ✅
 * -> -> 页是**虚拟化渲染**的 ✅ -> 打印前要**临时渲染所有页** ✅ ✅
 * -> -> **但 canvas 渲染是异步的** ✅
 * -> -> **Chrome 的打印【不等】** ✅（实测：`page.pdf()` ✅ 和 **CDP** ✅ 都一样 ✅ ❌）
 * -> -> 打印快照时 **只有前 2~4 页画完** ✅ -> 后面**全是空白页** ✅ ❌
 *
 * ## Chrome 原生怎么做 ✅
 *
 * -> **它根本不打印 DOM** ✅ -> **直接把 PDF 文件交给浏览器打印** ✅ ✅
 * -> -> 所以**永远是完整的** ✅ ✅
 *
 * ## 我们的做法 ✅
 *
 * -> **隐藏一个 `<iframe>`** ✅ -> 加载 **PDF 文件** ✅
 * -> -> 等它加载完 ✅ -> 调 **iframe 的 `print()`** ✅ ✅
 * -> -> **浏览器自己处理 PDF** ✅ -> **每一页都完整** ✅ ✅
 *
 * ⚠️ **只适用于"打印原 PDF"** ✅
 * -> 要打印**高亮** ✅ -> 还是得走 DOM ✅（因为高亮不在 PDF 里 ✅）✅
 */

import { useCallback, useRef, useState } from 'react';

/** usePrintOriginal 参数 */
export interface UsePrintOriginalOptions {
  /** PDF 的地址（URL ✅ / Blob 的 URL ✅） */
  url: string | null;
  /** 打印完成的回调 ✅ */
  onAfterPrint?: () => void;
  /** 出错的回调 ✅ */
  onError?: (error: unknown) => void;
}

/** usePrintOriginal 返回值 */
export interface UsePrintOriginalResult {
  /** 打印原 PDF ✅ */
  print: () => void;
  /** 正在准备 ✅ */
  preparing: boolean;
}

/**
 * **打印原 PDF** ✅
 *
 * @param options 参数
 */
export function usePrintOriginal(options: UsePrintOriginalOptions): UsePrintOriginalResult {
  const { url, onAfterPrint, onError } = options;

  /** 隐藏的 iframe ✅ */
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** 正在准备 ✅ */
  const [preparing, setPreparing] = useState(false);

  /*
   * ⚠️ **`onAfterPrint` 放 ref** ✅（避免它进依赖 ✅ -> 回调每次都是新的 ✅）
   */
  const onAfterPrintRef = useRef(onAfterPrint);
  onAfterPrintRef.current = onAfterPrint;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const print = useCallback(() => {
    if (!url) {
      onErrorRef.current?.(new Error('没有可打印的文档'));
      return;
    }

    setPreparing(true);

    /*
     * ⚠️ **建一个隐藏的 iframe** ✅
     *
     * -> 加载 PDF ✅ -> 等 load ✅ -> 调它的 print() ✅ ✅
     * -> -> **浏览器用 PDF 阅读器渲染** ✅ -> **每页都完整** ✅ ✅
     */
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    frame.src = url;

    frame.onload = () => {
      /*
       * ⚠️ **再等一帧** ✅
       *
       * -> PDF 阅读器 ✅ 还要再初始化 ✅ ✅
       */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPreparing(false);
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch (error) {
            onErrorRef.current?.(error);
          } finally {
            /*
             * ⚠️ **打印完就删掉 iframe** ✅
             *
             * -> 不删 ✅ -> **每次打印都留一个** ✅ -> **内存泄漏** ✅ ❌
             */
            setTimeout(() => {
              frame.remove();
            }, 60000);
          }
        });
      });
    };

    frame.onerror = () => {
      setPreparing(false);
      onErrorRef.current?.(new Error('PDF 加载失败'));
      frame.remove();
    };

    document.body.appendChild(frame);
    frameRef.current = frame;
  }, [url]);

  return { print, preparing };
}
