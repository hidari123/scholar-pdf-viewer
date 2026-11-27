/**
 * usePdfDocument —— 文档加载的 React 封装。
 *
 * 职责：
 * - 调 core 的 loader（网络层）
 * - 接 core 的 cache（命中则跳过网络）
 * - 用 **loadId** 防"换文件竞态"（旧请求返回时丢弃）
 * - 密码流程（≤3 次重试）
 * - 把状态写进 store，UI 只读 store
 *
 * 两个关键设计（都是踩过坑的）：
 * 1. **回调/选项对象走 ref，不进依赖数组**：宿主通常传内联对象
 *    （`loadOptions={{ fetchImpl }}`、`onError={e => ...}`），每次渲染都是新引用
 *    → 直接进依赖数组会让 effect 每次渲染都重跑 → **无限重新加载**
 * 2. **loadId 单调递增**：换文件/重载后，旧请求的结果必须被丢弃
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentCache } from '../core/cache/store';
import { cacheKey } from '../core/cache/store';
import type { DocumentSource, LoadOptions } from '../core/document/loader';
import { loadDocument, toPdfViewerError } from '../core/document/loader';
import type { PdfViewerError } from '../core/errors';
import { pdfViewerError } from '../core/errors';
import type { PdfDocInfo } from '../core/types';

/** usePdfDocument 的参数 */
export interface UsePdfDocumentOptions {
  /** 文档来源 */
  file: DocumentSource | null;
  /** 宿主业务 id（缓存键） */
  documentId?: string;
  /** 缓存实例（不给则不缓存） */
  cache?: DocumentCache | null;
  /** 加载选项（fetch 注入、超时、请求头等） */
  loadOptions?: LoadOptions;
  /** 密码 */
  password?: string;
  /** 加密文档：宿主接管密码输入 */
  onRequestPassword?: (info: { retry: (password: string) => void; cancel: () => void }) => void;
  /** 加载成功 */
  onDocumentLoad?: (doc: PdfDocInfo) => void;
  /**
   * 从字节构造文档对象（pdf.js getDocument）。
   * 由调用方注入 → core/hooks 都不直接依赖 pdf.js（可测试、可替换）。
   */
  getDocInfo?: (data: Uint8Array) => Promise<PdfDocInfo>;
  /** 出错 */
  onError?: (error: PdfViewerError) => void;
  /** 加载进度 */
  onProgress?: (loaded: number, total: number) => void;
}

/** usePdfDocument 的返回值 */
export interface UsePdfDocumentResult {
  /** 文档字节（加载成功后） */
  data: Uint8Array | null;
  /** 是否加载中 */
  loading: boolean;
  /** 加载进度（0–1） */
  progress: number;
  /** 错误 */
  error: PdfViewerError | null;
  /** 重新加载 */
  reload: () => void;
}

/** 密码重试上限 */
const MAX_PASSWORD_ATTEMPTS = 3;

/**
 * 加载 PDF 文档。
 *
 * @param options 参数
 */
export function usePdfDocument(options: UsePdfDocumentOptions): UsePdfDocumentResult {
  const {
    file,
    documentId,
    cache,
    loadOptions,
    password,
    onRequestPassword,
    onDocumentLoad,
    getDocInfo,
    onError,
    onProgress,
  } = options;

  const [data, setData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<PdfViewerError | null>(null);

  /**
   * 重载信号：密码重试与手动 reload 共用一个计数器。
   *
   * 为什么合并成一个：effect 的依赖只放"真正改变加载行为"的值，
   * 合并后依赖只剩 [file, documentId, reloadSignal] —— 干净且不触发 lint 告警。
   */
  const [reloadSignal, setReloadSignal] = useState(0);

  /** 最新一次加载的 id（异步回调回来时对比它，不一致就丢弃） */
  const latestLoadIdRef = useRef(0);

  /** 密码重试次数 */
  const passwordAttemptsRef = useRef(0);

  /** 当前密码（放 ref：它是"数据"不是"触发器"，走依赖会引入额外重载） */
  const passwordRef = useRef<string | undefined>(password);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  /** 触发重新加载 */
  const reload = useCallback(() => {
    setReloadSignal((signal: number) => signal + 1);
  }, []);

  /**
   * 依赖数组只放"真正会改变加载行为"的值。
   *
   * 为什么其他 props 用 ref 而不是直接进依赖数组：
   * 宿主通常传**内联对象/内联函数**（`loadOptions={{ fetchImpl }}`、`onError={e => ...}`），
   * 每次渲染都是新引用 → 直接进依赖数组会让 effect 每次渲染都重跑 → **无限重新加载**。
   * 所以把它们存进 ref（始终拿到最新值）。
   */
  const optionsRef = useRef({
    cache,
    loadOptions,
    onRequestPassword,
    onDocumentLoad,
    getDocInfo,
    onError,
    onProgress,
  });

  optionsRef.current = {
    cache,
    loadOptions,
    onRequestPassword,
    onDocumentLoad,
    getDocInfo,
    onError,
    onProgress,
  };

  useEffect(() => {
    if (!file) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const {
      cache: cacheOption,
      loadOptions: loadOptionsOption,
      onRequestPassword: requestPassword,
      onDocumentLoad: documentLoad,
      getDocInfo: docInfo,
      onError: reportError,
      onProgress: reportProgress,
    } = optionsRef.current;

    /**
     * loadId：每次加载尝试的唯一标识，单调递增。
     *
     * - 换文件（file 变）→ effect 重跑 → loadId 变 → 旧请求结果被丢弃
     * - 手动 reload / 密码重试 → reloadSignal 变 → effect 重跑 → loadId 变 → 旧结果被丢弃
     *
     * reloadSignal 参与计算：保证不同 reload 轮次的 id 绝不重复（语义更直观）。
     */
    const loadId = latestLoadIdRef.current + 1 + reloadSignal * 1_000_000;
    latestLoadIdRef.current = loadId;

    let cancelled = false;

    /** 这次加载是否仍然有效（没被更新的加载取代，也没卸载） */
    const isCurrent = () => !cancelled && latestLoadIdRef.current === loadId;

    const run = async () => {
      setLoading(true);
      setError(null);
      setProgress(0);
      passwordAttemptsRef.current = 0;

      try {
        const key = cacheKey(typeof file === 'string' ? file : '', documentId);

        // 1) 查缓存
        if (cacheOption) {
          const cached = await cacheOption.get(key);
          if (cached && isCurrent()) {
            setData(cached);
            setLoading(false);
            setProgress(1);
            return;
          }
        }

        // 2) 走网络 / 内存
        const loaded = await loadDocument(
          file,
          {
            ...loadOptionsOption,
            // 密码走 ref（最新值），密码错误时可换密码重试
            password: passwordRef.current,
            onProgress: (loadedBytes, total) => {
              if (!isCurrent()) {
                return;
              }
              const ratio = total > 0 ? Math.min(1, loadedBytes / total) : 0;
              setProgress(ratio);
              reportProgress?.(loadedBytes, total);
            },
          },
          loadId,
        );

        if (!isCurrent()) {
          return;
        }

        setLoading(false);
        setProgress(1);

        // 3) 写缓存（fire-and-forget：缓存失败不影响使用）
        if (cacheOption) {
          void cacheOption.set(key, loaded.data);
        }

        /*
         * 4) 取文档信息（页数/元数据）—— 由调用方注入 pdf.js 解析
         *
         * ⚠️⚠️ **必须在 `setData` 之前**（实测踩到的坑）。
         *
         * -> `setData` 会触发"取可见页"的 effect ✅
         * -> 那时如果文档**还没打开** ✅ -> `getPage()` 返回 `undefined` ❌
         *    -> **文本层整个没了** ❌（canvas 还在 ✅ -> 不报错 ✅ -> 极难查 ❌）
         * -> `docInfo` 里面才会真正打开文档（默认接线走 `bridge.open()`）✅
         * -> 所以：**先打开 ✅ 再给数据 ✅**
         */
        if (docInfo) {
          try {
            const info = await docInfo(loaded.data);
            if (isCurrent()) {
              documentLoad?.(info);
            }
          } catch (infoError) {
            // 元数据取不到不影响文档本身（可能只是加密/损坏）
            reportError?.(toPdfViewerError(infoError));
          }
        }

        if (!isCurrent()) {
          return;
        }

        setData(loaded.data);
      } catch (caught) {
        if (!isCurrent()) {
          return;
        }

        const normalized = toPdfViewerError(caught);

        // 加密文档 → 请求密码（≤3 次）
        if (normalized.code === 'E_PDF_ENCRYPTED' && requestPassword) {
          const attempts = passwordAttemptsRef.current + 1;
          passwordAttemptsRef.current = attempts;

          if (attempts > MAX_PASSWORD_ATTEMPTS) {
            const finalError = pdfViewerError('E_PDF_PASSWORD_WRONG', { cause: normalized });
            setError(finalError);
            setLoading(false);
            reportError?.(finalError);
            return;
          }

          setLoading(false);
          requestPassword({
            retry: (pwd: string) => {
              passwordRef.current = pwd;
              setReloadSignal((signal: number) => signal + 1);
            },
            cancel: () => {
              setLoading(false);
              setError(null);
            },
          });
          return;
        }

        setError(normalized);
        setLoading(false);
        reportError?.(normalized);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // 依赖只放"真正改变加载行为"的值；其余（回调/选项对象/密码）走 ref。
    // reloadSignal 是**故意的重载触发器**（密码重试 / 手动 reload 都 +1）。
  }, [file, documentId, reloadSignal]);

  return { data, loading, progress, error, reload };
}
