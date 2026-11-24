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
  PdfViewerDensity,
  PdfViewerHandle,
  PdfViewerTheme,
  SelectionData,
} from '@scholar-club/pdf-viewer';
import {
  downloadFile,
  exportHighlightedPdf,
  exportHighlights,
  Icon,
  PdfSearch,
  PdfViewer,
  parseHighlightDoc,
  stringifyHighlightDoc,
  THEMES,
  themeLabel,
} from '@scholar-club/pdf-viewer';
import { AnnotationDialog } from '@scholar-club/pdf-viewer/dialog';
import { TipTapEditor } from '@scholar-club/pdf-viewer/editor';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HighlightPicker, PRESET_COLORS } from './HighlightPicker';
import { createDebouncedSaver, loadHighlights } from './highlight-store';
import './demo.css';
import { demoText } from './demo-i18n';
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

  /*
   * ⚠️ **把 handle 挂到 window 上**（E2E 要用；宿主调试也方便）。
   *
   * -> 审计新增了 `zoomIn` / `zoomOut` / `fitWidth` / `fitPage` / `print` ->
   *    需要能**从外面验证它们真的能用** ✅
   */
  useEffect(() => {
    // @ts-expect-error 调试用的全局句柄
    window.__scpdfViewer = viewerRef;
  }, []);

  /**
   * **当前文档 id**（高亮按文档隔离的 key）。
   *
   * ⚠️ **切换文档时高亮要重置**（用户要求）。
   * → 高亮按 `documentId` 分开存 → 切文档时自动切到对应的那份。
   */
  const [documentId, setDocumentId] = useState('local');

  /**
   * **功能开关的演示**（第 29 轮审核补的 ✅）。
   *
   * -> 之前 demo **完全没用过** `features` ❌
   * -> 宿主看不到【怎么关掉某个功能】❌
   * -> 现在：**可交互地开关** ✅
   * -> 搜索 / 缩略图 / 目录 / 打印 / 键盘 / 主题按钮 ✅
   */
  const [disabledFeatures, setDisabledFeatures] = useState<string[]>([]);

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
   * **给 E2E 用的全局 API**（造数据）。
   *
   * ⚠️ **之前是靠工具栏里那个"造两个同一行的批注"按钮** ❌
   * -> 那个按钮第 27 轮**被删了**（用户说"不需要这个按钮"）✅
   * -> E2E 就没法造"同一行的两条批注"了 ❌
   * -> -> 这里暴露一个**测试专用**的 API ✅
   */
  useEffect(() => {
    // @ts-expect-error 调试用的全局句柄
    window.__scpdfDemo = {
      /**
       * 造两条锚定**同一条高亮**的批注（用来测"合并成一个图标"）。
       */
      /**
       * **导出时写不写批注文字**（E2E 用）✅
       */
      setIncludeAnnotationText(on: boolean) {
        setIncludeAnnotationText(on);
      },
      /**
       * **设置打印方向**（E2E 用）✅
       */
      setPrintOrientation(orientation: 'auto' | 'portrait' | 'landscape') {
        setPrintOrientation(orientation);
      },
      /**
       * **打开工具栏的"高亮"按钮**（E2E 用）✅
       */
      enableToolbarHighlight() {
        setShowToolbarHighlight(true);
      },
      /**
       * **开关功能**（第 29 轮新增 ✅）。
       */
      setDisabledFeatures(list: string[]) {
        setDisabledFeatures(list);
      },
      makeSameLineNotes(highlightId: string) {
        const now = Date.now();
        setStickyNotes((prev) => [
          ...prev,
          {
            id: `note-a-${now}`,
            highlightId,
            content: '第一条批注',
            createdAt: now,
          },
          {
            id: `note-b-${now}`,
            highlightId,
            content: '第二条批注',
            createdAt: now,
          },
        ]);
      },
    };
  }, []);

  /**
   * **待写的批注草稿**（demo 侧的富文本弹窗）。
   *
   * → 选区浮层的"加批注"用的是**包自带**的弹窗
   * → 点高亮块上的批注按钮 → 用这个（demo 自己挂的）
   */
  const [noteDraft, setNoteDraft] = useState<{ highlightId: string; initial: string } | null>(null);

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
  /**
   * **要不要显示工具栏的"高亮"按钮**（E2E 用）。
   *
   * ⚠️ 包的工具栏高亮按钮是**默认隐藏**的 ✅
   * -> 宿主传 `onToolbarHighlight` 才出现 ✅
   * -> demo 平时**不传** ✅ -> 保持"默认隐藏"的样子 ✅
   * -> E2E 里**打开**它来测 ✅
   */
  const [showToolbarHighlight, setShowToolbarHighlight] = useState(false);
  /**
   * **打印方向**（E2E 用）。
   *
   * -> 包新增 `printOrientation` prop ✅（用户确认："允许"）
   * -> demo 平时用 **auto** ✅
   * -> E2E 里可以切成 **landscape** 来测横向 ✅
   */
  /**
   * **导出时要不要写批注文字**（E2E 用）。
   *
   * -> 默认 **false**（不写）✅ -> Chrome 里 hover 不会出黄色便签 ✅
   * -> E2E 测编码时会打开 ✅
   */
  const [includeAnnotationText, setIncludeAnnotationText] = useState(false);
  const [printOrientation, setPrintOrientation] = useState<'auto' | 'portrait' | 'landscape'>(
    'auto',
  );

  /**
   * **语言（宿主可切换）**。
   *
   * ⚠️ 内置 zh / en；宿主还能通过 JSON **加**别的语言。
   */
  const [locale, setLocale] = useState<'zh' | 'en' | 'ja'>('zh');

  /*
   * **demo 自己的文案**（宿主侧 i18n）。
   *
   * → 用户反馈："切换语言还是没变啊"
   * → 根因：**包内文案切换正常**，但 **demo 自己的按钮是硬编码中文** ❌
   * → demo 是宿主 → 宿主的文案自己管 → 切语言时**整页**都变 ✅
   */
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => demoText(locale, key, vars),
    [locale],
  );

  /**
   * **宿主注册的语言表**（JSON）。
   *
   * → 这就是"宿主通过固定 json 添加语言"的接口 ✅
   * → 不用写全 → 缺的自动回退到内置文案
   *
   * ⚠️ **现在包内置了 `ja`**（不用宿主写一整套了）✅
   * → 下面只**覆盖一句**，演示"宿主的优先级更高" ✅
   */
  const HOST_LOCALES = useMemo(
    () => ({
      ja: {
        // 覆盖内置的 "サムネイル" → "ページ"
        'thumbnails.title': 'ページ一覧',
      },
    }),
    [],
  );

  /** 主题（宿主可切换） */
  const [theme, setTheme] = useState<PdfViewerTheme>('light');
  /** 文字方向（RTL 支持） */
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');

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
          <p style={{ padding: 8 }}>{t('demo.sidebar')}</p>
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
    [t],
  );

  /** 当前页（宿主展示用） */
  const [currentPage, setCurrentPage] = useState(1);

  /** 总页数（搜索索引要用） */
  const [numPages, setNumPages] = useState(0);

  /** 目录页码映射就绪标记（解析完 +1 → 包重新解析目录） */
  /** 宿主的目录解析标记（现在包自己解析，宿主不用管了） */
  const [_outlineResolveToken] = useState(0);

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
      setSampleLabel(t('demo.loadLocal'));
      // ⚠️ **换文档 → 换 documentId** → 高亮按文档隔离（切回原来的文档还在）
      setDocumentId('local');
      return true;
    } catch {
      return false;
    }
  }, [t]);

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
    setSampleLabel(t('demo.loadSample'));
    // ⚠️ **换文档 → 换 documentId** → 高亮按文档隔离（切回原来的文档还在）
    setDocumentId('sample');
  }, [t]);

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
      // ⚠️ **缓存各页的尺寸**（搜索索引用它算视口 → 判断旋转文字）
      pageSizesPtRef.current.set(i, { width: viewport.width, height: viewport.height });
    }
    return sizes;
  }, []);

  /**
   * **异步**解析页引用 → 页码（pdf.js 的 `getPageIndex`）。
   *
   * ## 为什么只要这一个函数（之前要 100+ 行）
   *
   * → 之前 demo 要自己：收集页引用 → 异步解析 → 建 Map → 通知包
   * → 现在：**包自己解析**（`resolvePageRef`）✅
   * → 命名目标（"section.1"）也由宿主在这里先 `getDestination` 展开 ✅
   */
  const resolvePageRef = useCallback(async (ref: unknown): Promise<number | null> => {
    const doc = docRef.current;
    if (!doc) {
      return null;
    }
    try {
      // 命名目标 → 先展开成数组（pdf.js 的 getDestination）
      let target: unknown = ref;
      if (typeof ref === 'string') {
        const resolved = await doc.getDestination(ref);
        if (!resolved || !Array.isArray(resolved)) {
          return null;
        }
        target = resolved[0];
      }
      if (!target || typeof target !== 'object') {
        return null;
      }
      const index = await doc.getPageIndex(target as never);
      return index < 0 ? null : index + 1;
    } catch {
      return null;
    }
  }, []);

  /**
   * 取目录（宿主注入）。
   *
   * → 只要给 `getOutline` + `resolvePageRef`，包就能自己解析页码 ✅
   */
  const getOutline = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) {
      return null;
    }
    return doc.getOutline();
  }, []);

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

  /**
   * **搜索索引的版本号**（索引变大时 +1）。
   *
   * ⚠️ 用来触发重渲染 → 让"索引的项文本"重新计算 → 搜索高亮定位准确。
   */
  const [_searchIndexVersion, setSearchIndexVersion] = useState(0);

  /**
   * **各页的尺寸（pt）**（搜索索引用它算视口 → 判断旋转文字）。
   *
   * ⚠️ 搜索高亮定位的关键（实测踩过的坑）：
   * → 旋转文字在渲染时不存在 → 索引也必须跳过 → 否则偏移错位
   */
  const pageSizesPtRef = useRef(new Map<number, { width: number; height: number }>());

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
            /*
             * ⚠️⚠️ **必须提供 `getViewport`**（搜索高亮定位的关键，实测踩过的坑）。
             *
             * → 索引要用它判断"哪些是旋转文字"
             * → 旋转文字在**渲染时不存在** → 索引也必须跳过
             * → 否则索引文本多几百字符 → **偏移全错位** ❌
             *
             * → **页自己提供**比宿主单独传回调更可靠：
             *   宿主的回调通常依赖异步缓存的页尺寸 → 和索引建索引**竞态** ❌
             *   页自己的 `getViewport` 是**同步**的 → 永远拿得到 ✅
             */
            getViewport: (params: { scale: number }) => {
              const viewport = page.getViewport(params);
              return {
                width: viewport.width,
                height: viewport.height,
                scale: viewport.scale,
                transform: viewport.transform as number[],
              };
            },
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
                    /*
                     * ⚠️⚠️ **必须传 `fontName`**（搜索高亮定位的关键，实测踩过的坑）。
                     *
                     * → pdf.js 的 `getTextContent()` 会**合并** item
                     * → 合并与否取决于 `fontName` / `height` 等字段
                     * → 渲染侧传了 `fontName`、索引侧没传
                     *    → **两次调用的 item 边界不一样**
                     *    → 索引 161 项 / 渲染 112 项 → **偏移错位** ❌
                     *
                     * → 两边**字段完全一致** → item 边界一致 → 偏移才对得上 ✅
                     */
                    fontName: 'fontName' in item ? item.fontName : undefined,
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
      {
        /*
         * ⚠️ **索引变大时要通知**（搜索高亮定位的关键）。
         *
         * → 索引是**异步**建的 → 页面渲染时索引可能还没建好
         * → 渲染侧要用"索引的项文本"算对齐偏移 → 索引好了要重算
         */
        onProgress: () => {
          setSearchIndexVersion((v) => v + 1);
        },
        /**
         * ⚠️⚠️ **必须传视口**（搜索高亮定位的关键，实测踩过的坑）。
         *
         * → 有了视口，索引才能判断"哪些是旋转文字"
         * → 旋转文字在**渲染时不存在** → 索引也必须跳过
         * → 否则索引文本多 457 字符 → **偏移全错位** → 高亮跑到别的字上 ❌
         */
        viewport: (pageNumber: number) => {
          const doc = docRef.current;
          if (!doc) {
            return undefined;
          }
          const size = pageSizesPtRef.current.get(pageNumber);
          if (!size) {
            return undefined;
          }
          // ⚠️ 用 pdf.js 的标准视口（和渲染一致 → 旋转判定一致）
          //    pdf.js 的默认视口：scale=1 → [w, 0, 0, -h, 0, h]
          return {
            width: size.width,
            height: size.height,
            scale: 1,
            transform: [size.width, 0, 0, -size.height, 0, size.height],
          };
        },
      },
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
    (highlight: NewHighlight): string => {
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
       *
       * ⚠️⚠️⚠️ **ID 必须用 `crypto.randomUUID()`**（第 27 轮修的真 bug）。
       *
       * ### 之前的计数器为什么会撞
       *
       * -> `highlightSeq` 在**文档加载完成时归零** ❌
       * -> 但**持久化恢复**的高亮还带着原来的 id（`h-1`、`h-2`…）✅
       * -> 刷新页面 -> 建一个新高亮 -> 计数器又是 1 -> **又是 `h-1`** ❌
       * -> **两个高亮同 id** ❌
       *    -> 点击一个 -> **两个都变成激活态** ❌
       *    -> 用户反馈："有时候点击一个高亮 两个高亮都会被选中" ✅
       *
       * ### 修法
       *
       * -> `crypto.randomUUID()` -> **绝对不会重复** ✅
       * -> 不依赖任何状态 -> 刷新、恢复、多标签页都安全 ✅
       */
      const id = `h-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${highlightSeq++}`}`;
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
      /*
       * ⚠️ **返回新建的高亮 id** → "加批注"流程要用它（批注挂在高亮上）。
       * → 不返回 → 包只能自己造 id → 便签找不到对应的高亮 → **不显示** ❌
       */
      return id;
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
    (color: string, selectedText: string, position: unknown): string => {
      return handleHighlightCreate({
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
   *
   * ⚠️ **不再用 `window.prompt`**（用户需求）：
   * > "写批注的时候不要用系统默认的alert，设计一个富文本弹窗来写批注"
   *
   * → 选区浮层里的"加批注" → **包自带的富文本弹窗**（`onNote` 不传时）
   * → 这里的 `onHighlightComment` 是**点高亮块上的批注按钮** → 同样走富文本弹窗
   */
  const handleHighlightComment = useCallback(
    (id: string) => {
      const highlight = highlights.find((h) => h.id === id);
      if (!highlight) {
        return;
      }
      // 复用包的富文本弹窗（demo 侧的一个 state）
      setNoteDraft({
        highlightId: id,
        initial: '',
      });
    },
    [highlights],
  );

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
      setHint(t('demo.noDoc'));
      return;
    }
    setHint(t('demo.exporting'));
    void fetch(sampleUrl)
      .then((r) => r.arrayBuffer())
      .then((buffer) =>
        exportHighlightedPdf({
          pdfBytes: buffer,
          highlights,
          pageSizesPt: viewerRef.current?.getPageSizesPt() ?? [],
          /*
           * ⚠️ **批注文字默认【不写】**（第 27 轮）✅
           * -> 不写 -> Chrome 里 hover 高亮**不会出黄色便签** ✅
           * -> 用户反馈："导出后 hover 高亮还是会出现黄色便签" ✅
           * -> E2E 要测**编码** -> 那里显式打开 ✅
           */
          includeAnnotationText: includeAnnotationText,
        }),
      )
      .then((bytes) => {
        downloadFile(
          new Blob([bytes as BlobPart], { type: 'application/pdf' }),
          `${documentId}-annotated.pdf`,
          'application/pdf',
        );
        setHint(t('demo.exported', { count: highlights.length }));
      })
      .catch((error: unknown) => {
        setHint(`导出失败：${error instanceof Error ? error.message : String(error)}`);
      });
  }, [sampleUrl, documentId, highlights, t, includeAnnotationText]);

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
            setHint(t('demo.savedHighlight'));
          }}
          title={t('demo.addHighlight')}
          aria-label={t('demo.addHighlight')}
        >
          <Icon name="highlight" />
        </button>

        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleExportHighlights}
          title={t('demo.exportJson')}
          aria-label={t('demo.exportJson')}
        >
          <Icon name="exportJson" />
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
          title={t('demo.exportPdf')}
          aria-label={t('demo.exportPdf')}
        >
          {/* ⚠️ **新图标**：之前用 `exportPdf` -> 和"下载 PDF"重复 ❌ */}
          <Icon name="exportAnnotated" />
        </button>

        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleImportHighlights}
          title={t('demo.importJson')}
          aria-label={t('demo.importJson')}
        >
          {/* ⚠️ **新图标**：之前用 `upload` -> 看起来像"上传 PDF" ❌ */}
          <Icon name="importJson" />
        </button>

        <button
          type="button"
          className="scpdf-toolbar__btn"
          onClick={handleDownloadPdf}
          title={t('demo.downloadPdf')}
          aria-label={t('demo.downloadPdf')}
        >
          <Icon name="download" />
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
      t,
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
          {t('demo.loadSample')}
        </button>
        <button type="button" className="scpdf-btn" onClick={reloadLocal}>
          {t('demo.loadLocal')}
        </button>
        {sampleUrl ? (
          <span>
            {t('demo.current')} {sampleLabel || '文档'} · {t('demo.page')} {currentPage} ·{' '}
            {Math.round(scale * 100)}%
          </span>
        ) : (
          <span style={{ opacity: 0.6 }}>{t('demo.loading')}</span>
        )}
        {hint ? <span style={{ color: 'var(--scpdf-color-primary)' }}>{hint}</span> : null}

        {/*
          主题切换器 —— **宿主侧的 UI**。
          包提供 `theme` prop + `THEMES` / `themeLabel` 常量。

          ⚠️ **放在同一行**（不另起一行）
          → 否则 header 变高 → PDF 区域下移 → E2E 的坐标选字用例会选到不同的行
          → 实测缩放矩阵的"选区水平贴合墨迹"从 49/49 掉到 46/49。
        */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>{t('demo.theme')}</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as PdfViewerTheme)}
            aria-label={t('demo.aria.theme')}
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {themeLabel(t, locale)}
              </option>
            ))}
          </select>
          <span style={{ opacity: 0.7, marginLeft: 12, whiteSpace: 'nowrap' }}>
            {t('demo.locale')}
          </span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'zh' | 'en' | 'ja')}
            aria-label={t('demo.aria.locale')}
          >
            <option value="zh">{t('demo.localeName.zh')}</option>
            <option value="en">English</option>
            {/* 宿主通过 JSON 加的语言 */}
            <option value="ja">{t('demo.localeName.ja')}</option>
          </select>
          <span style={{ opacity: 0.7, marginLeft: 12, whiteSpace: 'nowrap' }}>
            {t('demo.density')}
          </span>
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value as PdfViewerDensity)}
            aria-label={t('demo.aria.density')}
          >
            <option value="compact">{t('demo.density.compact')}</option>
            <option value="cozy">{t('demo.density.cozy')}</option>
            <option value="comfortable">{t('demo.density.comfortable')}</option>
          </select>
          {/*
           * ⚠️ **RTL 开关**（审计新增的能力）。
           *
           * -> 之前**完全没有 RTL 支持** -> 阿拉伯语 / 希伯来语的宿主没法用 ❌
           * -> 现在：\`dir\` prop + CSS 镜像 ✅
           */}
          {/*
           * ⚠️ **功能开关的演示**（第 29 轮审核补的 ✅）。
           *
           * -> 演示宿主怎么**按需关掉**包的功能 ✅
           * -> 选【全部开启】= 默认行为 ✅
           */}
          <span style={{ opacity: 0.7, marginLeft: 12, whiteSpace: 'nowrap' }}>功能</span>
          <select
            value={disabledFeatures.join(',') || 'all'}
            onChange={(e) => {
              const value = e.target.value;
              setDisabledFeatures(value === 'all' ? [] : value.split(','));
            }}
            aria-label="功能开关"
            style={{ maxWidth: 160 }}
          >
            <option value="all">全部开启</option>
            <option value="search">关掉搜索</option>
            <option value="thumbnails">关掉缩略图</option>
            <option value="outline">关掉目录</option>
            <option value="print">关掉打印</option>
            <option value="keyboard">关掉键盘</option>
            <option value="themePicker">关掉主题按钮</option>
          </select>
          <span style={{ opacity: 0.7, marginLeft: 12, whiteSpace: 'nowrap' }}>RTL</span>
          <select
            value={dir}
            onChange={(e) => setDir(e.target.value as 'ltr' | 'rtl')}
            aria-label={t('demo.aria.dir')}
          >
            <option value="ltr">{t('demo.rtl.ltr')}</option>
            <option value="rtl">{t('demo.rtl.rtl')}</option>
          </select>
        </span>

        {/*
          高亮颜色选择器 —— **宿主侧的 UI**。
          包只提供 `highlightPalette`（key → 颜色）这条通道，
          取色器/预设/持久化全在宿主。
        */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>{t('demo.highlightColor')}</span>
          <HighlightPicker
            value={highlightColor}
            customColors={customColors}
            onChange={(key) => setHighlightColor(key)}
            onSaveCustom={(key, color) => setCustomColors((prev) => ({ ...prev, [key]: color }))}
            locale={locale}
          />
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <PdfViewer
          ref={viewerRef}
          locale={locale}
          locales={HOST_LOCALES}
          file={sampleUrl}
          documentId={documentId}
          theme={theme}
          /*
           * ⚠️ **主题切换**（包的工具栏里会多一个 🎨 按钮）。
           *
           * -> 用户需求："包在工具栏那里也可以加上一个按钮让用户进行选择" ✅
           * -> 传了 `onThemeChange` -> 工具栏显示主题按钮 ✅
           */
          onThemeChange={setTheme}
          dir={dir}
          appearance={{ density }}
          /*
           * ⚠️ **功能开关**（演示宿主的【按需关闭】✅）。
           *
           * -> `features` 是 **opt-out** ✅：只有显式 `false` 才关 ✅
           * -> 这里只把【关掉的】设成 false ✅
           */
          features={{
            search: !disabledFeatures.includes('search'),
            thumbnails: !disabledFeatures.includes('thumbnails'),
            outline: !disabledFeatures.includes('outline'),
            keyboard: !disabledFeatures.includes('keyboard'),
            print: !disabledFeatures.includes('print'),
            themePicker: !disabledFeatures.includes('themePicker'),
          }}
          slots={useSlots ? demoSlots : undefined}
          highlights={highlights}
          highlightPalette={highlightPalette}
          toolbar={{ rightSlot: toolbarSlot }}
          getPage={getPage}
          getPageSizes={getPageSizes}
          getDocInfo={getDocInfo}
          getOutline={getOutline}
          /*
           * ⚠️ **用包的异步解析器**（不用自己收集页引用 + 建 Map + 通知包）。
           * -> pdf.js 的 `getPageIndex` 是异步的 -> 包自己处理 ✅
           */
          resolvePageRef={resolvePageRef}
          renderThumbnail={renderThumbnail}
          searchEngine={searchEngine}
          onDocumentLoad={handleDocumentLoad}
          onSelectionChange={handleSelection}
          annotationEditor={TipTapEditor}
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
          /*
           * ⚠️ **工具栏的"高亮"按钮**（E2E 才打开）✅
           *
           * -> 包的这个按钮**默认隐藏** ✅（用户确认："默认隐藏吧"）
           * -> demo 平时**不传** ✅ -> 保持默认的样子 ✅
           */
          printOrientation={printOrientation}
          onToolbarHighlight={
            showToolbarHighlight
              ? (color: string) => {
                  setHighlightColor(color);
                  if (!selection) {
                    setHint('（先选中一段文字）');
                    return;
                  }
                  createHighlight(color, selection.text, selection.norm);
                  setHint(t('demo.savedHighlight'));
                }
              : undefined
          }
          onHighlightRemove={handleHighlightRemove}
          onHighlightComment={handleHighlightComment}
          stickyNotes={stickyNotes}
          onAnnotationClick={(note) => setHint(`【批注】${note.content.slice(0, 30)}`)}
          onAnnotationCreate={(id, html, _plain, highlightId, selectedText) => {
            /*
             * **新建批注**（从选区浮层的"加批注"触发）。
             *
             * → 包已经把**高亮**建好了（用默认颜色）
             * → 这里只需要挂一个便签 ✅
             */
            setStickyNotes((prev) => [
              ...prev.filter((n) => n.id !== id),
              {
                id,
                highlightId,
                content: html,
                createdAt: Date.now(),
                text: selectedText,
              },
            ]);
            setHint(t('demo.savedNote'));
          }}
          onAnnotationSave={(id, html) => {
            setStickyNotes((prev) =>
              prev.map((note) => (note.id === id ? { ...note, content: html } : note)),
            );
            setHint(t('demo.savedNote'));
          }}
          /*
           * ⚠️ **批注内容变化**（"编辑"按钮改完内容时触发）。
           *
           * -> 不传 -> 便签详情的"编辑"按钮**点不动**（面板永远是只读）❌
           * -> 用户反馈："便签详情打开的时候也是要有按钮可以选编辑的" ✅
           */
          onAnnotationChange={(id, html) => {
            setStickyNotes((prev) =>
              prev.map((note) => (note.id === id ? { ...note, content: html } : note)),
            );
          }}
          /*
           * ⚠️ **"展开"按钮**（打开便利贴详情）。
           *
           * -> 不传 -> 包**不渲染**"展开"按钮 ❌
           * -> 用户反馈："批注的打开详细按钮目前是失效的" ✅
           */
          onAnnotationExpand={(note) => {
            setHint(`【展开批注】${note.content.slice(0, 30)}`);
          }}
          onAnnotationDelete={(id) => {
            setStickyNotes((prev) => prev.filter((note) => note.id !== id));
            setHint(t('demo.deletedNote'));
          }}
          onHighlightClick={(h) => setHint(`点击高亮：${h.selectedText.slice(0, 20)}`)} /*
           * 选区浮层的动作 —— **宿主注入**（证明包不需要业务入口）。
           *
           * 翻译/提问/笔记由宿主实现；不传就不会显示对应按钮。
           */
          onTranslate={({ text }) => setHint(`【翻译】${text.slice(0, 20)}…（宿主实现）`)}
          onAsk={({ text }) => setHint(`【提问】${text.slice(0, 20)}…（宿主实现）`)}
          /*
           * ⚠️ **不传 `onNote`** → 用**包自带的**"加批注"按钮 + 富文本弹窗
           * → 用户需求："需要在框选的时候工具栏弹窗就要有加批注这个"
           * → 宿主想自己实现弹窗 → 传 `onNote` 即可（会覆盖内置的）
           */
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
            const id = createHighlight(color ?? highlightColor, text, position);
            setHint(`已高亮（${color ?? highlightColor}）`);
            // 返回 id → "加批注"流程用它（批注挂在高亮上）
            return id;
          }}
          onExternalLink={(url) => {
            // 宿主决定怎么开外链（新窗口 / 应用内 WebView）
            globalThis.open?.(url, '_blank', 'noopener,noreferrer');
            setHint(`打开外链：${url}`);
          }}
          onInternalLink={(ctx) => {
            /*
             * ⚠️ **内部跳转（PDF 里的页内链接）**。
             *
             * ### 现在的契约（包自己跳 + 宿主可拦截）
             *
             * -> `ctx.targetPage` = **目标页**（包解析出来的）✅
             *    -> 之前给的是**链接所在页**（没用）❌
             * -> `ctx.currentPage` = 链接**所在**的页 ✅
             * -> `ctx.targetY` = 目标在页内的 y 坐标（跳到**那一行**用）✅
             * -> `ctx.cancel()` = **取消这次跳转** ✅
             *
             * ### ⚠️ **默认行为：包自己跳** ✅
             *
             * -> **不要**在这里再调 `goToPage` ❌
             *    -> 包已经跳了 -> **会跳两次** ❌
             * -> 想自己接管（比如弹确认框）-> 调 `ctx.cancel()` ✅
             */
            const named = typeof ctx.dest === 'string' ? ctx.dest : null;
            setHint(
              named
                ? `内部跳转：${named}（第 ${ctx.targetPage ?? ctx.currentPage} 页）`
                : `内部跳转：第 ${ctx.targetPage ?? ctx.currentPage} 页`,
            );
            /*
             * ⚠️ **这里演示"取消"**（宿主自己接管的情况）。
             * -> 注释掉下面这行 -> 包**自动跳** ✅
             * -> 取消它 -> 包**不跳** ✅
             */
            // ctx.cancel();
          }}
          onPageChange={(p) => setCurrentPage(p)}
          onZoomChange={(s) => setScale(s)}
        />

        {/*
          **demo 自己的批注弹窗**（点高亮块上的批注按钮时用）。

          → 选区浮层的"加批注"用的是**包自带**的那个
          → 这个是 demo 挂在**高亮块**上的（demo 自己加的按钮）
          → 两个入口 → 同一个弹窗组件（`AnnotationDialog`）
        */}
        <AnnotationDialog
          open={noteDraft !== null}
          initialContent={noteDraft?.initial ?? ''}
          onClose={() => {
            setNoteDraft(null);
          }}
          onSubmit={(html) => {
            const draft = noteDraft;
            setNoteDraft(null);
            if (!draft) {
              return;
            }
            setStickyNotes((prev) => [
              ...prev.filter((n) => n.highlightId !== draft.highlightId),
              {
                id: `note-${draft.highlightId}`,
                highlightId: draft.highlightId,
                content: html,
                createdAt: Date.now(),
              },
            ]);
            setHint(t('demo.savedNote'));
          }}
          locale={locale}
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
