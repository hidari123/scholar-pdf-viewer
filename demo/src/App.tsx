/*
 * @Author: hidari
 * @Date: 2026-10-30 15:38:10
 * @LastEditors: hidari
 * @LastEditTime: 2026-11-13 16:50:00
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */

import type {
  AnnotationRecord,
  HighlightRecord,
  NewHighlight,
  OutlineItemLike,
  PdfViewerDensity,
  PdfViewerHandle,
  PdfViewerTheme,
  SelectionData,
} from '@scholar-club/pdf-viewer';
import {
  downloadFile,
  exportHighlightedPdf,
  exportHighlights,
  PdfSearch,
  PdfViewer,
  parseHighlightDoc,
  stringifyHighlightDoc,
  THEME_LABELS,
  THEMES,
} from '@scholar-club/pdf-viewer';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HighlightPicker, PRESET_COLORS } from './HighlightPicker';
import { createDebouncedSaver, loadHighlights } from './highlight-store';
import './demo.css';
import '@scholar-club/pdf-viewer/styles.css';

/**
 * 真实接入 demo —— 这是包与宿主的**标准接线示例**。
 *
 * 演示的关键点：
 * 1. pdf.js 全部在**宿主**侧（包不依赖 pdf.js）→ 换渲染引擎也不用改包
 * 2. 高亮是**受控**的：包只负责画，宿主负责存
 * 3. 选区**只有几何**：宿主拿到 SelectionData 后自己决定弹什么窗
 * 4. 换后端不影响这里的任何一行 —— 包只认 `file`（URL/Blob）
 */

// worker：pdf.js 的 worker 必须指向真实的 worker 文件
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/** 高亮 ID 生成 */
let highlightSeq = 0;

/**
 * demo 主组件。
 */
export default function App() {
  /** pdf.js 文档（宿主持有） */
  const docRef = useRef<PDFDocumentProxy | null>(null);
  /**
   * 查看器的**命令式句柄**。
   *
   * ⚠️ demo 的工具栏插槽有**自己的"高亮"按钮**（不走包的浮层动作）
   * → 做完之后要调 `viewerRef.current?.clearSelection()`
   * → 让包清掉选区（否则蓝色选区块一直浮在高亮上 —— 用户反馈"无法取消选中状态"）。
   */
  const viewerRef = useRef<PdfViewerHandle>(null);

  /**
   * **当前文档 id**（高亮按文档隔离的 key）。
   *
   * ⚠️ **切换文档时高亮要重置**（用户要求）。
   * → 高亮按 `documentId` 分开存 → 切文档时自动切到对应的那份。
   */
  const [documentId, setDocumentId] = useState('local');

  /**
   * **防抖保存器**（宿主的持久化）。
   *
   * ⚠️ **放在组件外** → 不会因为重渲染而重建（重建会丢掉待保存的数据）。
   */
  const saver = useMemo(() => createDebouncedSaver(500), []);

  /**
   * 高亮（受控状态 —— 宿主的数据）。
   *
   * ⚠️ **按文档隔离**（用户要求"切换文档时高亮要重置"）。
   * → `documentId → 高亮列表` → 切文档时自动切到对应的那份。
   * → 切回原来的文档，高亮还在（比"直接清空"更友好）。
   *
   * ⚠️ **持久化也在宿主**（包不碰存储）→ 见 `highlight-store.ts`。
   */
  const [highlightsByDoc, setHighlightsByDoc] = useState<Record<string, HighlightRecord[]>>({});

  /**
   * **批注（小便签）列表**（宿主持有）。
   *
   * ⚠️ **包不存数据** → 宿主传进来 → 换后端只改宿主。
   */
  const [stickyNotes, setStickyNotes] = useState<AnnotationRecord[]>([]);

  /**
   * **文档切换 → 从持久化里加载对应文档的高亮**。
   *
   * ⚠️ **包不碰存储**（这是包的边界）→ 加载 / 保存都是**宿主的事**。
   * → 换后端（localStorage → IndexedDB → 接口）**只改 `highlight-store.ts`**。
   */
  useEffect(() => {
    const loaded = loadHighlights(documentId);
    setHighlightsByDoc((prev) => (prev[documentId] ? prev : { ...prev, [documentId]: loaded }));
  }, [documentId]);

  /** 当前文档的高亮（传给包的） */
  const highlights = useMemo(
    () => highlightsByDoc[documentId] ?? [],
    [highlightsByDoc, documentId],
  );

  /**
   * 更新当前文档的高亮。
   *
   * ⚠️⚠️ **必须用"直接赋值"，不能套 updater**（实测踩过的坑）。
   *
   * 之前写成：
   * ```tsx
   * setHighlightsByDoc((prev) => ({ ...prev, [documentId]: updater(prev[documentId] ?? []) }));
   * ```
   * → **套了两层 updater** → React 的 StrictMode 会**双重调用**外层 updater
   * → 内层 `updater` 被调用 2~3 次 → 每次都**追加**一条 → **高亮翻倍**！
   *
   * 实测：点一次"高亮" → 生成了 **3 条**。
   *
   * → 改成**直接用当前值算新值**（不是 updater）→ StrictMode 调几次都一样的结果。
   */
  const setHighlights = useCallback(
    (next: HighlightRecord[] | ((prev: HighlightRecord[]) => HighlightRecord[])) => {
      const current = highlightsByDoc[documentId] ?? [];
      const value =
        typeof next === 'function'
          ? (next as (p: HighlightRecord[]) => HighlightRecord[])(current)
          : next;
      setHighlightsByDoc((prev) => ({ ...prev, [documentId]: value }));
      /*
       * ⚠️ **每次改动都保存**（用户要求"如有接口则每次改动都保存到接口"）。
       *
       * → 这里用 localStorage（宿主选的方案）→ **包不碰存储**。
       * → 防抖 500ms → 连续操作（选中 → 高亮 → 换色）合并成一次写。
       */
      saver.schedule(documentId, value);
    },
    [highlightsByDoc, documentId, saver],
  );

  /** 当前选中的高亮颜色 key（宿主的 UI 状态） */
  const [highlightColor, setHighlightColor] = useState('yellow');

  /** 主题（宿主可切换） */
  const [theme, setTheme] = useState<PdfViewerTheme>('light');

  /** 密度（appearance 的结构开关） */
  const [density, setDensity] = useState<PdfViewerDensity>('cozy');

  /**
   * **插槽演示**（方案 D）。
   *
   * ⚠️ 用 URL 参数 `?slots=1` 开启 → 方便 E2E 直接验证。
   */
  const useSlots = useMemo(
    () => new URLSearchParams(globalThis.location?.search ?? '').get('slots') === '1',
    [],
  );

  /** 用户自定义的颜色（key → 颜色）；持久化也是宿主的事 */
  const [customColors, setCustomColors] = useState<Record<string, string>>({});

  /**
   * 传给包的高亮色板（语义 key → CSS 颜色）。
   *
   * ⚠️ **宿主负责组装**：预设色 + 用户自定义色 → 传给包的 `highlightPalette`。
   * 包只认 key，不关心 key 的含义。
   */
  const highlightPalette = useMemo(() => {
    const palette: Record<string, string> = {};
    for (const item of PRESET_COLORS) {
      palette[item.key] = item.color;
    }
    return { ...palette, ...customColors };
  }, [customColors]);

  /** 选区（宿主拿到的几何） */
  const [selection, setSelection] = useState<SelectionData | null>(null);

  /**
   * **插槽内容**（方案 D 的宿主示例）。
   *
   * ⚠️ 传了插槽 → 包**不再渲染**对应的那块 → 宿主自己负责全部逻辑。
   * 这里演示最小可用版本：工具栏只放一个"翻页"按钮，页内放一个角标。
   */
  const demoSlots = useMemo(
    () => ({
      toolbar: (
        <div className="demo-slot-toolbar" data-slot="toolbar">
          <button
            type="button"
            className="scpdf-toolbar__btn"
            onClick={() => {
              const current = viewerRef.current?.getCurrentPage() ?? 1;
              viewerRef.current?.goToPage(current >= 5 ? 1 : current + 1);
            }}
          >
            宿主工具栏（插槽）
          </button>
        </div>
      ),
      panel: (
        <aside className="demo-slot-panel" data-slot="panel">
          <p style={{ padding: 8 }}>宿主侧栏（插槽）</p>
        </aside>
      ),
      pageOverlay: (pageNumber: number) => (
        <span
          data-slot="page-overlay"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.45)',
            color: '#fff',
            fontSize: 11,
            pointerEvents: 'none',
          }}
        >
          第 {pageNumber} 页
        </span>
      ),
    }),
    [],
  );

  /** 当前页（宿主展示用） */
  const [currentPage, setCurrentPage] = useState(1);

  /** 总页数（搜索索引要用） */
  const [numPages, setNumPages] = useState(0);

  /** 目录页码映射就绪标记（解析完 +1 → 包重新解析目录） */
  const [outlineResolveToken, setOutlineResolveToken] = useState(0);

  /** 缩放（宿主展示用） */
  const [scale, setScale] = useState(1);

  /** 选区提示（模拟宿主自己的业务：弹窗/AI 入口） */
  const [hint, setHint] = useState('');

  /**
   * 样张 PDF。
   *
   * 优先用本地真实文档（`/samples/local.pdf`，体积大不入库），
   * 没有时用内置的手写样张（3 页，可测选中）。
   */
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleLabel, setSampleLabel] = useState('');

  /** 加载本地真实文档（若存在） */
  const loadLocal = useCallback(async () => {
    try {
      const response = await fetch('/samples/local.pdf', { method: 'HEAD' });
      if (!response.ok) {
        return false;
      }
      setSampleUrl('/samples/local.pdf');
      setSampleLabel('本地真实文档');
      // ⚠️ **换文档 → 换 documentId** → 高亮按文档隔离（切回原来的文档还在）
      setDocumentId('local');
      return true;
    } catch {
      return false;
    }
  }, []);

  /** 重新载入本地真实文档（切回原文档） */
  const reloadLocal = useCallback(() => {
    void loadLocal();
  }, [loadLocal]);

  /** 生成样张 PDF（3 页，带文字，便于测试选中/搜索） */
  const createSample = useCallback(async () => {
    const bytes = buildSamplePdf();
    // Blob 需要 ArrayBuffer（TS 5.7+ 的 Uint8Array 泛型更严格）
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    setSampleUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' })));
    setSampleLabel('内置样张（3 页）');
    // ⚠️ **换文档 → 换 documentId** → 高亮按文档隔离（切回原来的文档还在）
    setDocumentId('sample');
  }, []);

  // 启动时优先加载本地真实文档
  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  /** 文档加载完成 → 重置高亮计数 */
  const handleDocumentLoad = useCallback(() => {
    highlightSeq = 0;
  }, []);

  /** 取页（宿主注入给包 —— 包只认这个最小接口） */
  const getPage = useCallback(async (pageNumber: number) => {
    const doc = docRef.current;
    if (!doc) {
      return undefined;
    }
    const page: PDFPageProxy = await doc.getPage(pageNumber);
    return {
      pageNumber: page.pageNumber,
      getViewport: (params: { scale: number }) => {
        const viewport = page.getViewport(params);
        return {
          width: viewport.width,
          height: viewport.height,
          scale: viewport.scale,
          // 文本层定位需要视口变换矩阵（y 轴翻转在这里）
          transform: viewport.transform as number[],
        };
      },
      getTextContent: async () => {
        const content = await page.getTextContent();
        return {
          /**
           * pdf.js 的 items 混合了 TextItem 与 TextMarkedContent：
           * 后者没有 transform/width/height（是标记锚点，不是文字）。
           * 只取真正的文字项（'transform' in item 是可靠的判别）。
           */
          items: content.items
            .filter((item) => 'transform' in item)
            .map((item) => ({
              str: 'str' in item ? item.str : '',
              transform: item.transform,
              width: item.width,
              height: item.height,
              fontName: 'fontName' in item ? item.fontName : undefined,
              hasEOL: 'hasEOL' in item ? item.hasEOL : false,
            })),
        };
      },
      getAnnotations: async () => {
        // 只取链接类注解（其它注解包用不上）
        const list = await page.getAnnotations({ intent: 'display' });
        return list
          .filter((item) => item.subtype === 'Link')
          .map((item) => ({
            subtype: item.subtype,
            rect: item.rect,
            url: 'url' in item ? item.url : undefined,
            dest: 'dest' in item ? (item.dest as string | unknown[] | null) : null,
          }));
      },
      render: (params: {
        canvas?: HTMLCanvasElement;
        canvasContext: CanvasRenderingContext2D;
        viewport: { width: number; height: number; scale: number };
      }) => {
        const viewport = page.getViewport({ scale: params.viewport.scale });
        return page.render({
          canvas: params.canvas as HTMLCanvasElement,
          canvasContext: params.canvasContext,
          viewport,
        });
      },
    };
  }, []);

  /** 各页尺寸（pt）—— 不传则包会用 A4 兜底（滚动条长度会不准） */
  const getPageSizes = useCallback(async (numPages: number) => {
    const doc = docRef.current;
    if (!doc) {
      return [];
    }
    const sizes: { width: number; height: number }[] = [];
    for (let i = 1; i <= numPages; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
    return sizes;
  }, []);

  /**
   * 页引用 → 页码的映射。
   *
   * pdf.js 的 outline 目标里是**页对象的内部引用**，
   * 包拿不到页码 → 必须由宿主提供映射。
   *
   * 实现要点：pdf.js v6 的 `doc.getPageIndex(ref)` 是**异步**的，
   * 而包的 `pageRefToNumber` 是**同步**回调 →
   * 所以这里在拿到目录时**一次性把所有引用的页码解析好**，存进 Map。
   */
  const pageRefMapRef = useRef(new Map<string, number>());

  /**
   * 解析目录里出现的所有目标 → 页码。
   *
   * **dest 有两种形态**（真实 PDF 两种都有）：
   * 1. 数组：[pageRef, '/XYZ', left, top, zoom] → 直接有页引用
   * 2. 字符串：命名目标（如 "section.1"）→ 要先用 `doc.getDestination(name)`
   *    解析成数组才能拿到页引用
   *
   * 真实案例：本机的 A²E 论文用的就是命名目标（不处理的话目录全点不动）。
   */
  const resolveOutlinePages = useCallback(
    async (doc: PDFDocumentProxy, outline: OutlineItemLike[] | null) => {
      const map = new Map<string, number>();

      /** 递归收集所有 dest（数组或命名） */
      const collect = (items: OutlineItemLike[]): unknown[] => {
        const dests: unknown[] = [];
        for (const item of items) {
          if (item.dest) {
            dests.push(item.dest);
          }
          if (item.items?.length) {
            dests.push(...collect(item.items));
          }
        }
        return dests;
      };

      for (const dest of collect(outline ?? [])) {
        try {
          // 命名目标 → 先解析成数组
          const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
          if (!resolved || !Array.isArray(resolved)) {
            console.warn('[demo] 目标无法解析:', dest, resolved);
            continue;
          }

          const ref = resolved[0];
          if (!ref) {
            continue;
          }

          const pageIndex = await doc.getPageIndex(ref as never);
          if (pageIndex < 0) {
            continue;
          }

          const target = ref as { num?: number; gen?: number };
          if (typeof target.num === 'number') {
            const pageNumber = pageIndex + 1;
            // 两种键都存：页引用形态 + 命名目标形态
            map.set(`${target.num}R${target.gen ?? 0}`, pageNumber);
            if (typeof dest === 'string') {
              map.set(dest, pageNumber);
            }
          }
        } catch (error) {
          // 解析不了的引用跳过（该项在 UI 上禁用）
          console.warn('[demo] 目录目标解析失败:', error, dest);
        }
      }

      console.log('[demo] 映射结果:', map.size, '条');

      pageRefMapRef.current = map;

      // 告诉包"映射好了，重新解析目录"
      setOutlineResolveToken((token) => token + 1);
    },
    [],
  );

  /**
   * 页引用 / 命名目标 → 页码。
   *
   * 两种键：
   * - 页引用对象：`{num, gen}` → "330R0"
   * - 命名目标字符串："section.1" → 原样
   */
  const pageRefToNumber = useCallback((ref: unknown): number | null => {
    if (typeof ref === 'string') {
      return pageRefMapRef.current.get(ref) ?? null;
    }
    if (!ref || typeof ref !== 'object') {
      return null;
    }
    const target = ref as { num?: number; gen?: number };
    if (typeof target.num !== 'number') {
      return null;
    }
    return pageRefMapRef.current.get(`${target.num}R${target.gen ?? 0}`) ?? null;
  }, []);

  /**
   * 取目录（宿主注入）。
   *
   * pdf.js 的 dest 里第一个元素是**页对象的内部引用**，
   * 包拿不到页码 → 必须由宿主提供映射（pageRefToNumber）。
   */
  const getOutline = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) {
      return null;
    }
    const outline = await doc.getOutline();

    // 解析目录目标 → 页码（包的 pageRefToNumber 回调是同步的，这里先备好）
    void resolveOutlinePages(doc, outline);

    return outline;
  }, [resolveOutlinePages]);

  /**
   * 渲染缩略图（宿主注入）。
   *
   * 用离屏 canvas 渲染 → 转成 dataURL 给包。
   * （真实项目里也可以用 worker + OffscreenCanvas 更快。）
   *
   * ⚠️ **必须用包给的尺寸 + DPR**：
   * - 画布尺寸用 `Math.ceil(viewport.width/height)` → 与包的 thumbnailSpec 一致（零错位）
   * - 画布物理尺寸乘 DPR → 高 DPI 屏清晰
   * - context 要 `setTransform(ratio,...)` 缩放 → pdf.js 按 viewport 尺寸绘制
   */
  const renderThumbnail = useCallback(
    async (pageNumber: number, width: number): Promise<string | null> => {
      const doc = docRef.current;
      if (!doc) {
        return null;
      }

      try {
        const page = await doc.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = width / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const ratio = Math.min(window.devicePixelRatio || 1, 2);

        const canvas = document.createElement('canvas');
        // 物理像素尺寸（DPR 感知 → 高 DPI 屏清晰）
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        const context = canvas.getContext('2d');
        if (!context) {
          return null;
        }

        // pdf.js 按 viewport 尺寸绘制 → 先按 DPR 缩放 context
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        // pdf.js v6 需要 canvas + viewport
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.85);
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * 搜索引擎（宿主注入）。
   *
   * 关键：`buildIndex` 需要**取页函数**（宿主提供 pdf.js 的页）。
   * 宿主持有文档 → 这里用 getPage 的逻辑提供取文本的页。
   */
  const searchEngine = useMemo(() => new PdfSearch(), []);

  /** 文档就绪后给搜索引擎装上取页函数 */
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) {
      return;
    }

    void searchEngine.buildIndex(
      async (pageNumber) => {
        try {
          const page = await doc.getPage(pageNumber);
          return {
            pageNumber: page.pageNumber,
            getTextContent: async () => {
              const content = await page.getTextContent();
              return {
                items: content.items
                  .filter((item) => 'transform' in item)
                  .map((item) => ({
                    str: 'str' in item ? item.str : '',
                    transform: item.transform,
                    width: item.width,
                    height: item.height,
                    hasEOL: 'hasEOL' in item ? item.hasEOL : false,
                  })),
              };
            },
          };
        } catch {
          return undefined;
        }
      },
      numPages > 0 ? doc.numPages : 0,
    );
    // numPages 是"文档已就绪"的信号（getDocInfo 里设置）
  }, [searchEngine, numPages]);

  /** 文档信息（宿主注入给包） */
  const getDocInfo = useCallback(async (data: Uint8Array) => {
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
    docRef.current = doc;

    const info = (await doc.getMetadata().catch(() => null)) as {
      info?: { Title?: string };
    } | null;

    // 记录页数（搜索索引要用）
    setNumPages(doc.numPages);

    return {
      numPages: doc.numPages,
      title: info?.info?.Title,
    };
  }, []);

  /** 选区变化 → 宿主自己决定做什么（这里只更新提示） */
  const handleSelection = useCallback((next: SelectionData | null) => {
    setSelection(next);
    if (next) {
      const pages = next.pages.length > 1 ? `跨 ${next.pages.length} 页` : `第 ${next.pages[0]} 页`;
      setHint(`选中 ${next.text.length} 字（${pages}）→ 宿主可在此弹窗 / 调模型`);
    } else {
      setHint('');
    }
  }, []);

  /** 新建高亮（宿主保存） */
  const handleHighlightCreate = useCallback(
    (highlight: NewHighlight) => {
      /*
       * ⚠️⚠️ **ID 必须在 updater 外面生成**（实测踩过的坑）。
       *
       * 之前写成：
       * ```tsx
       * setHighlights((prev) => [...prev, { id: `h-${++highlightSeq}`, ... }]);
       * ```
       * → updater 里**有副作用**（改计数器）
       * → React 的 StrictMode 会**双重调用** updater
       * → 同一个高亮被**加了 2~3 次**（每次 ID 还不同）
       * → 实测：点一次"高亮" → **3 条** + "Encountered two children with the same key"。
       *
       * → ID 在外面生成 → updater 是**纯函数** → 调几次结果都一样。
       */
      highlightSeq += 1;
      const id = `h-${highlightSeq}`;
      setHighlights((prev) => [
        ...prev,
        {
          id,
          color: highlight.color ?? 'label-6',
          selectedText: highlight.selectedText,
          position: highlight.position,
          source: 'my',
          createdAt: Date.now(),
        },
      ]);
    },
    [setHighlights],
  );

  /**
   * 宿主自己创建高亮的**统一入口**（工具栏插槽按钮用）。
   *
   * ⚠️ 走 `onHighlightCreate` → **包会顺带清掉选区**
   *    （否则蓝色选区块一直浮在高亮上 —— 用户反馈"无法取消选中状态"）。
   */
  const createHighlight = useCallback(
    (color: string, selectedText: string, position: unknown) => {
      handleHighlightCreate({
        color,
        selectedText,
        position: position as never,
      });
    },
    [handleHighlightCreate],
  );

  /** 换高亮的颜色（宿主实现 —— 包只抛事件） */
  const handleHighlightColorChange = useCallback(
    (id: string, color: string) => {
      setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, color } : h)));
      setHint(`已换色（${color}）`);
    },
    [setHighlights],
  );

  /** 删除高亮（宿主实现） */
  const handleHighlightRemove = useCallback(
    (id: string) => {
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      setHint('已删除高亮');
    },
    [setHighlights],
  );

  /**
   * **添加批注**（WPS 式小便签）。
   *
   * ⚠️ **宿主实现**：包只负责按钮 + 抛事件 + 渲染小便签。
   * → 批注内容怎么编辑、怎么存 → 宿主的事（换后端也不用改包）。
   */
  const handleHighlightComment = useCallback((id: string) => {
    const content = window.prompt('批注内容：', '这是一条批注');
    if (content === null) {
      return;
    }
    setStickyNotes((prev) => [
      ...prev.filter((n) => n.highlightId !== id),
      { id: `note-${id}`, highlightId: id, content, createdAt: Date.now() },
    ]);
    setHint('已添加批注');
  }, []);

  /**
   * **导出高亮**（JSON 文件）。
   *
   * ⚠️ **包只给格式，存储是宿主的事** → 换后端不用改包。
   */
  const handleExportHighlights = useCallback(() => {
    const doc = exportHighlights(documentId, highlights);
    downloadFile(stringifyHighlightDoc(doc), `highlights-${documentId}.json`, 'application/json');
    setHint(`已导出 ${highlights.length} 条高亮`);
  }, [documentId, highlights]);

  /**
   * **导入高亮**（JSON 文件）。
   *
   * ⚠️ 导入的数据可能来自外部 → 用包的 `parseHighlightDoc`（**带校验，永不抛异常**）。
   */
  const handleImportHighlights = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        const doc = parseHighlightDoc(text);
        if (!doc) {
          setHint('导入失败：文件格式不对');
          return;
        }
        setHighlights((prev) => [...prev, ...doc.highlights]);
        setHint(`已导入 ${doc.highlights.length} 条高亮`);
      });
    };
    input.click();
  }, [setHighlights]);

  /**
   * **下载 PDF**。
   *
   * ⚠️ 包**不负责取文件**（文件是宿主的）→ 只提供 `downloadFile` 这个纯 DOM 工具。
   */
  const handleDownloadPdf = useCallback(() => {
    if (!sampleUrl) {
      setHint('没有可下载的文档');
      return;
    }
    void fetch(sampleUrl)
      .then((r) => r.blob())
      .then((blob) => {
        downloadFile(blob, `${documentId}.pdf`, 'application/pdf');
        setHint('已下载 PDF');
      })
      .catch(() => setHint('下载失败'));
  }, [sampleUrl, documentId]);

  /**
   * **导出带高亮的 PDF**。
   *
   * ⚠️ **包只给"纯函数 + 可选依赖"**：
   * - `exportHighlightedPdf`（包）→ 算好批注 + 用 pdf-lib 写文件
   * - `pdf-lib` 是**可选 peerDependency** → 宿主自己装（`npm i pdf-lib`）
   * - 取原始文件、触发下载 → **宿主的事**（包不碰网络）
   */
  const handleExportAnnotatedPdf = useCallback(() => {
    if (!sampleUrl) {
      setHint('没有可导出的文档');
      return;
    }
    setHint('正在导出带高亮的 PDF…');
    void fetch(sampleUrl)
      .then((r) => r.arrayBuffer())
      .then((buffer) =>
        exportHighlightedPdf({
          pdfBytes: buffer,
          highlights,
          pageSizesPt: viewerRef.current?.getPageSizesPt() ?? [],
        }),
      )
      .then((bytes) => {
        downloadFile(
          new Blob([bytes as BlobPart], { type: 'application/pdf' }),
          `${documentId}-annotated.pdf`,
          'application/pdf',
        );
        setHint(`已导出带高亮的 PDF（${highlights.length} 条高亮）`);
      })
      .catch((error: unknown) => {
        setHint(`导出失败：${error instanceof Error ? error.message : String(error)}`);
      });
  }, [sampleUrl, documentId, highlights]);

  /** 工具栏插槽（宿主塞自己的按钮 —— 证明包不需要业务入口） */
  const toolbarSlot = useMemo(
    () => (
      <>
        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={() => {
            if (!selection) {
              setHint('请先在页面里选中一段文字');
              return;
            }
            /*
             * ⚠️ **走 `viewerRef.current.createHighlight()`**（包的统一入口）。
             *
             * → 包会：① 调 `onHighlightCreate`（宿主存）② **清掉选区**。
             *
             * 直接调 `handleHighlightCreate` 的话，包不知道"高亮做完了"
             * → 选区的蓝色块一直浮在新高亮上（用户反馈"无法取消选中状态"）。
             */
            viewerRef.current?.createHighlight({
              color: highlightColor,
              selectedText: selection.text,
              position: selection.norm,
            });
            setHint('已添加高亮（宿主自存，包不碰后端）');
          }}
          title="添加高亮"
          aria-label="添加高亮"
        >
          +
        </button>

        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleExportHighlights}
          title="导出高亮（JSON）"
          aria-label="导出高亮"
        >
          ⤓
        </button>

        {/*
        **导出带高亮的 PDF**（不是 JSON）。

        ⚠️ `pdf-lib` 是**可选 peerDependency** → 宿主自己装（demo 里装了）。
        → 包只给纯函数 + 坐标换算；取文件 / 触发下载是宿主的事。
        */}
        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleExportAnnotatedPdf}
          title="导出带高亮的 PDF"
          aria-label="导出带高亮的 PDF"
        >
          ⤓ᴾ
        </button>

        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleImportHighlights}
          title="导入高亮（JSON）"
          aria-label="导入高亮"
        >
          ⤒
        </button>

        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleDownloadPdf}
          title="下载 PDF"
          aria-label="下载 PDF"
        >
          ⭳
        </button>
      </>
    ),
    [
      selection,
      highlightColor,
      handleExportHighlights,
      handleImportHighlights,
      handleDownloadPdf,
      handleExportAnnotatedPdf,
    ],
  );

  return (
    <div
      className="demo-root"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <div
        className="demo-header"
        style={{
          display: 'flex',
          padding: '8px 12px',
          fontSize: 13,
          borderBottom: '1px solid var(--scpdf-color-border)',
          gap: 12,
          alignItems: 'center',
          /*
           * ⚠️ **不换行 + 固定高度**（实测踩过的坑）。
           *
           * 控件一多，`flex-wrap: wrap` 会让 header **变高**
           * → PDF 区域整体下移 → E2E 里"按坐标选字"的用例选到**不同的行**
           * → 缩放矩阵的"选区水平贴合墨迹"从 49/49 掉到 46/49。
           *
           * → header 高度**固定**（`height` + `overflow: hidden`）
           * → 加控件也不会影响 PDF 区域的位置。
           */
          flexWrap: 'nowrap',
          height: 46,
          overflowX: 'auto',
          overflowY: 'hidden',
          flexShrink: 0,
        }}
      >
        <strong>@scholar-club/pdf-viewer</strong>
        <button type="button" className="scpdf-btn" onClick={createSample}>
          载入内置样张
        </button>
        <button type="button" className="scpdf-btn" onClick={reloadLocal}>
          载入本地真实文档
        </button>
        {sampleUrl ? (
          <span>
            当前：{sampleLabel || '文档'} · 第 {currentPage} 页 · {Math.round(scale * 100)}%
          </span>
        ) : (
          <span style={{ opacity: 0.6 }}>加载中…</span>
        )}
        {hint ? <span style={{ color: 'var(--scpdf-color-primary)' }}>{hint}</span> : null}

        {/*
          主题切换器 —— **宿主侧的 UI**。
          包提供 `theme` prop + `THEMES` / `THEME_LABELS` 常量。

          ⚠️ **放在同一行**（不另起一行）
          → 否则 header 变高 → PDF 区域下移 → E2E 的坐标选字用例会选到不同的行
          → 实测缩放矩阵的"选区水平贴合墨迹"从 49/49 掉到 46/49。
        */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.7 }}>主题：</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as PdfViewerTheme)}
            aria-label="主题"
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
          <span style={{ opacity: 0.7, marginLeft: 12 }}>密度：</span>
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value as PdfViewerDensity)}
            aria-label="密度"
          >
            <option value="compact">紧凑</option>
            <option value="cozy">适中</option>
            <option value="comfortable">宽松</option>
          </select>
        </span>

        {/*
          高亮颜色选择器 —— **宿主侧的 UI**。
          包只提供 `highlightPalette`（key → 颜色）这条通道，
          取色器/预设/持久化全在宿主。
        */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.7 }}>高亮色：</span>
          <HighlightPicker
            value={highlightColor}
            customColors={customColors}
            onChange={(key) => setHighlightColor(key)}
            onSaveCustom={(key, color) => setCustomColors((prev) => ({ ...prev, [key]: color }))}
          />
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <PdfViewer
          ref={viewerRef}
          file={sampleUrl}
          documentId={documentId}
          theme={theme}
          appearance={{ density }}
          slots={useSlots ? demoSlots : undefined}
          highlights={highlights}
          highlightPalette={highlightPalette}
          toolbar={{ rightSlot: toolbarSlot }}
          getPage={getPage}
          getPageSizes={getPageSizes}
          getDocInfo={getDocInfo}
          getOutline={getOutline}
          pageRefToNumber={pageRefToNumber}
          outlineResolveToken={outlineResolveToken}
          renderThumbnail={renderThumbnail}
          searchEngine={searchEngine}
          onDocumentLoad={handleDocumentLoad}
          onSelectionChange={handleSelection}
          onHighlightCreate={(h) => {
            /*
             * ⚠️ **宿主自己的按钮创建了高亮**（走 `viewerRef.createHighlight`）→ 这里存。
             *
             * → 包会顺带清掉选区（"清选区"是 UI 行为，属于包）。
             *
             * ⚠️ **包内置的"高亮"按钮不走这里**（它走 `onHighlight`）
             *    → 两个都走 → 会**保存两次**（实测：点一次生成 3 条）。
             */
            handleHighlightCreate(h);
            setHint(`已高亮（${h.color ?? '默认'}）`);
          }}
          onHighlightColorChange={handleHighlightColorChange}
          onHighlightRemove={handleHighlightRemove}
          onHighlightComment={handleHighlightComment}
          stickyNotes={stickyNotes}
          onAnnotationClick={(note) => setHint(`【批注】${note.content.slice(0, 30)}`)}
          onHighlightClick={(h) => setHint(`点击高亮：${h.selectedText.slice(0, 20)}`)} /*
           * 选区浮层的动作 —— **宿主注入**（证明包不需要业务入口）。
           *
           * 翻译/提问/笔记由宿主实现；不传就不会显示对应按钮。
           */
          onTranslate={({ text }) => setHint(`【翻译】${text.slice(0, 20)}…（宿主实现）`)}
          onAsk={({ text }) => setHint(`【提问】${text.slice(0, 20)}…（宿主实现）`)}
          onNote={({ text }) => setHint(`【笔记】${text.slice(0, 20)}…（宿主实现）`)}
          onHighlight={({ text, color, position }) => {
            /*
             * ⚠️ **包内置的"高亮"按钮** → 走 `onHighlight`。
             *
             * → 宿主在这里存高亮（**只存一次**）。
             * → 包会**自己清选区**（不用宿主再通知）。
             *
             * ⚠️ **不要**在这里再调 `onHighlightCreate` / `createHighlight` 的
             *    包的入口 → 会**保存两次**（实测：点一次生成 3 条）。
             */
            createHighlight(color ?? highlightColor, text, position);
            setHint(`已高亮（${color ?? highlightColor}）`);
          }}
          onExternalLink={(url) => {
            // 宿主决定怎么开外链（新窗口 / 应用内 WebView）
            globalThis.open?.(url, '_blank', 'noopener,noreferrer');
            setHint(`打开外链：${url}`);
          }}
          onPageChange={(p) => setCurrentPage(p)}
          onZoomChange={(s) => setScale(s)}
        />
      </div>
    </div>
  );
}

/**
 * 造一份最小的 3 页 PDF（纯手写字节，无依赖）。
 *
 * 为什么要手写：仓库不放二进制样张（体积 + 审查成本），
 * 且手写 PDF 能精确控制内容（每页一段可选择的文字）。
 *
 * @returns PDF 字节
 */
function buildSamplePdf(): Uint8Array {
  const pages = [
    'Hello PDF Viewer. Select this text to create a highlight.',
    'Second page. Zoom keeps the anchor point stable.',
    'Third page. Scroll fast, rendering stays smooth.',
  ];

  const objects: string[] = [];

  // 1: Catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  // 2: Pages
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );

  pages.forEach((text, index) => {
    const contentObj = 4 + index * 2;

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${2 + pages.length * 2 + 1} 0 R >> >> /Contents ${contentObj} 0 R >>`,
    );

    const stream = `BT /F1 18 Tf 72 760 Td (${escapePdfText(text)}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  // 最后一个对象：Font
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // 组装文件
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // latin1 编码 → 每字符 1 字节
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) {
    bytes[i] = pdf.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** 转义 PDF 文本里的特殊字符 */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
