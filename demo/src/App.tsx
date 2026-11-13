/*
 * @Author: hidari
 * @Date: 2026-10-30 15:38:10
 * @LastEditors: hidari
 * @LastEditTime: 2026-11-13 16:50:00
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 */

import type { HighlightRecord, NewHighlight, SelectionData } from '@scholar-club/pdf-viewer';
import { PdfViewer } from '@scholar-club/pdf-viewer';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist';
import { useCallback, useMemo, useRef, useState } from 'react';
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

  /** 高亮（受控状态 —— 宿主的数据） */
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);

  /** 选区（宿主拿到的几何） */
  const [selection, setSelection] = useState<SelectionData | null>(null);

  /** 当前页（宿主展示用） */
  const [currentPage, setCurrentPage] = useState(1);

  /** 缩放（宿主展示用） */
  const [scale, setScale] = useState(1);

  /** 选区提示（模拟宿主自己的业务：弹窗/AI 入口） */
  const [hint, setHint] = useState('');

  /** 样张 PDF（用 pdf.js 自己生成一份，避免仓库里放二进制） */
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);

  /** 生成样张 PDF（3 页，带文字，便于测试选中/搜索） */
  const createSample = useCallback(async () => {
    const bytes = buildSamplePdf();
    // Blob 需要 ArrayBuffer（TS 5.7+ 的 Uint8Array 泛型更严格）
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    setSampleUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' })));
  }, []);

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
        };
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

  /** 文档信息（宿主注入给包） */
  const getDocInfo = useCallback(async (data: Uint8Array) => {
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
    docRef.current = doc;
    const info = (await doc.getMetadata().catch(() => null)) as {
      info?: { Title?: string };
    } | null;
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
  const handleHighlightCreate = useCallback((highlight: NewHighlight) => {
    highlightSeq += 1;
    setHighlights((prev) => [
      ...prev,
      {
        id: `h-${highlightSeq}`,
        color: highlight.color ?? 'label-6',
        selectedText: highlight.selectedText,
        position: highlight.position,
        source: 'my',
        createdAt: Date.now(),
      },
    ]);
  }, []);

  /** 工具栏插槽（宿主塞自己的按钮 —— 证明包不需要业务入口） */
  const toolbarSlot = useMemo(
    () => (
      <button
        type="button"
        className="scpdf-toolbar__btn"
        onClick={() => {
          if (!selection) {
            setHint('请先在页面里选中一段文字');
            return;
          }
          handleHighlightCreate({
            color: 'label-2',
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
    ),
    [selection, handleHighlightCreate],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          padding: '8px 12px',
          fontSize: 13,
          borderBottom: '1px solid var(--scpdf-color-border)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <strong>@scholar-club/pdf-viewer</strong>
        <button type="button" className="scpdf-btn" onClick={createSample}>
          生成样张 PDF
        </button>
        {sampleUrl ? (
          <span>
            当前：样张（3 页）· 第 {currentPage} 页 · {Math.round(scale * 100)}%
          </span>
        ) : (
          <span style={{ opacity: 0.6 }}>先点「生成样张 PDF」</span>
        )}
        {hint ? <span style={{ color: 'var(--scpdf-color-primary)' }}>{hint}</span> : null}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <PdfViewer
          file={sampleUrl}
          highlights={highlights}
          toolbar={{ rightSlot: toolbarSlot }}
          getPage={getPage}
          getPageSizes={getPageSizes}
          getDocInfo={getDocInfo}
          onDocumentLoad={handleDocumentLoad}
          onSelectionChange={handleSelection}
          onHighlightCreate={handleHighlightCreate}
          onHighlightClick={(h) => setHint(`点击高亮：${h.selectedText.slice(0, 20)}`)}
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
