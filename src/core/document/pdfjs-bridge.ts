/**
 * **pdf.js 的默认接线**（宿主不传 `getPage` / `getDocInfo` 时用）。
 *
 * ## 为什么需要这个（审核发现的**最重要的易用性问题**）
 *
 * ### 问题
 *
 * README 的"最小接入"是这样写的：
 *
 * ```tsx
 * <PdfViewer file="/docs/paper.pdf" />
 * **就这样**——没有 provider、没有 store 初始化、没有后端配置。
 * ```
 *
 * -> 但**照抄这段代码是【不工作的】** ❌
 *    -> 实测：\`pages: 0\` / \`canvases: 0\` ❌
 *    -> 而且**没有任何报错** ❌ -> 宿主完全不知道哪里错了 ❌
 *    -> （因为 \`getPage\` / \`getDocInfo\` 是**可选 prop** ✅ -> 不传就静默不渲染 ❌）
 *
 * ### 为什么之前会这样
 *
 * -> 包**不 import pdf.js**  （core 层零依赖）
 * -> 宿主必须自己：
 *    1. \`import * as pdfjs from 'pdfjs-dist'\`
 *    2. 设 \`GlobalWorkerOptions.workerSrc\` ✅（否则 worker 加载失败 ❌）
 *    3. 传 \`getDocInfo\` / \`getPage\` / \`getPageSizes\`
 * -> 宿主漏了任何一步 -> **白屏 + 无报错** ❌
 *
 * ### 修法
 *
 * -> **包内置一份默认接线**
 *    -> 宿主**不传** -> 用默认的  -> **开箱即用**
 *    -> 宿主**传了** -> 用宿主的  （完全覆盖）
 * -> 默认接线会**自动设好 worker**
 *
 * ⚠️ **仍然是"可替换"的**
 * -> 宿主想自己控制 pdf.js 的版本 / worker / 沙箱 -> 传自己的
 *
 * ⚠️ **动态 import**
 * -> \`pdfjs-dist\` 体积不小  -> 不该拖慢**没用 PDF** 的页面
 * -> -> **用到时才加载**
 */

/** 宿主的"取页"回调（和 \`PdfViewer\` 的 prop 同型） */
import { type PdfJsResourcePaths, resolvePdfJsResourcePaths } from './pdfjs-resources';

export type { PdfJsResourcePaths };

export type DefaultGetPage = (pageNumber: number) => Promise<
  | {
      getViewport: (options: { scale: number }) => { width: number; height: number };
      getTextContent: () => Promise<unknown>;
      render: (options: unknown) => { promise: Promise<void>; cancel?: () => void };
      cleanup?: () => void;
    }
  | undefined
>;

/** 宿主需要的"文档信息" */
export interface DefaultDocInfo {
  numPages: number;
  /** 页的尺寸（pt） */
  pageSizes?: { width: number; height: number }[];
  metadata?: unknown;
}

/** 一份已经接好的 pdf.js 上下文 */
export interface PdfJsBridge {
  /**
   * 打开文档。
   *
   * @param data PDF 字节
   * @param password 密码（**加密文档**要用）
   */
  open: (data: Uint8Array, password?: string) => Promise<DefaultDocInfo & { doc: unknown }>;
  /** 取第 n 页（1 起） */
  getPage: (pageNumber: number) => Promise<unknown>;
  /** 各页尺寸（pt） */
  getPageSizes: (numPages: number) => Promise<{ width: number; height: number }[]>;
}

/**
 * **已经初始化好的 pdf.js 桥接**（模块级缓存）。
 *
 * ⚠️ **模块级缓存**：pdf.js 只能初始化一次 ✅（重复设 workerSrc 会出问题 ❌）
 */
let bridgePromise: Promise<PdfJsBridge> | null = null;

/**
 * **动态 import pdf.js 并接好**。
 *
 * ⚠️ **worker 的处理**（实测踩到的坑）：
 * -> pdf.js v6 的 worker 是**独立文件**（\`pdf.worker.min.mjs\`）
 * -> 不设 \`workerSrc\` -> **worker 加载失败** ❌ -> 文档永远不加载 ❌
 * -> 这里用 \`new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)\`
 *    -> **打包器能静态分析到**  -> 产物里会带上这个 worker
 *
 * @returns 接好的桥接
 */
export async function createDefaultPdfJsBridge(
  resourcePaths?: PdfJsResourcePaths,
): Promise<PdfJsBridge> {
  if (!bridgePromise) {
    bridgePromise = (async () => {
      const pdfjs = await import('pdfjs-dist');

      /*
       * ⚠️ **设置 worker**（不设 -> 文档永远加载不出来 ❌）。
       *
       * -> \`new URL(..., import.meta.url)\` 是**打包器能识别的写法**
       * -> Vite / webpack / rollup 都会把 worker 打进产物
       */
      try {
        const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
      } catch {
        /*
         * ⚠️ **兜底**：某些环境（老的打包器 / 某些 CDN）不支持这个写法 ❌
         * -> 试试**字符串路径**（pdf.js 会按它自己的规则解析）
         */
        pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';
      }

      /** 当前打开的文档 */
      let currentDoc: {
        numPages: number;
        getPage: (n: number) => Promise<unknown>;
        getMetadata?: () => Promise<unknown>;
      } | null = null;

      return {
        async open(data: Uint8Array, password?: string) {
          /*
           * ⚠️ **必须传副本**（pdf.js 会把 buffer 交给 worker ❌）
           * -> 不 copy 的话 -> worker 拿到的是**已经被 detach 的** buffer ❌
           * -> -> 随机报"message length does not match" ❌
           */
          /*
           * ⚠️ **加密文档要传密码**（审核发现的功能缺口）
           *
           * -> 不传 -> pdf.js 抛 `PasswordException` ❌
           * -> -> 加密 PDF 在**默认接线**下打不开 ❌
           * -> -> 这里把密码传进去
           */
          /*
           * ⚠️⚠️ **静态资源路径**（用户反馈："页面刚打开顶部出现乱码"）
           *
           * -> 不配 `standardFontDataUrl` ❌
           *    -> pdf.js 请求不到标准字体 ❌
           *    -> 文档里**没内嵌字体**的页会画歪 ❌
           * -> 宿主可以覆盖 ✅（浅覆盖 ✅）
           */
          const resources = resolvePdfJsResourcePaths(resourcePaths);

          const doc = await pdfjs.getDocument({
            data: data.slice(),
            ...(password ? { password } : {}),
            ...(resources.standardFontDataUrl
              ? { standardFontDataUrl: resources.standardFontDataUrl }
              : {}),
            ...(resources.cMapUrl ? { cMapUrl: resources.cMapUrl } : {}),
            ...(resources.wasmUrl ? { wasmUrl: resources.wasmUrl } : {}),
          }).promise;
          currentDoc = doc as never;

          const numPages = doc.numPages;

          /*
           * ⚠️ **顺手把每页的尺寸量出来**
           * -> 宿主经常忘了传 \`getPageSizes\` ❌
           * -> -> 跳页 / 打印的缩放会**偏** ❌
           */
          const pageSizes: { width: number; height: number }[] = [];
          for (let i = 1; i <= numPages; i += 1) {
            const page = await doc.getPage(i);
            if (!page) {
              continue;
            }
            const viewport = page.getViewport({ scale: 1 });
            pageSizes.push({ width: viewport.width, height: viewport.height });
          }

          const metadata = doc.getMetadata ? await doc.getMetadata() : undefined;

          return { numPages, pageSizes, metadata, doc };
        },

        async getPage(pageNumber: number) {
          if (!currentDoc) {
            return undefined;
          }
          return currentDoc.getPage(pageNumber);
        },

        async getPageSizes(numPages: number) {
          const sizes: { width: number; height: number }[] = [];
          for (let i = 1; i <= numPages; i += 1) {
            const page = await currentDoc?.getPage(i);
            if (!page) {
              continue;
            }
            const viewport = (
              page as { getViewport: (o: { scale: number }) => { width: number; height: number } }
            ).getViewport({ scale: 1 });
            sizes.push({ width: viewport.width, height: viewport.height });
          }
          return sizes;
        },
      };
    })();
  }
  return bridgePromise;
}
