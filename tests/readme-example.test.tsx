// @vitest-environment jsdom
/**
 * README 示例的可编译性测试。
 *
 * 为什么需要：README 里的接入示例是**用户看到的第一份契约**，
 * 示例编译不过 = 用户第一步就卡住。用测试锁住它。
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PdfViewer } from '../src/components/PdfViewer';
import type { HighlightRecord } from '../src/core/types';

/** 模拟 pdf.js 的页代理 */
const fakePage = {
  pageNumber: 1,
  getViewport: (params: { scale: number }) => ({
    width: 595 * params.scale,
    height: 842 * params.scale,
    scale: params.scale,
  }),
  getTextContent: async () => ({ items: [] }),
  render: (_params: { canvasContext: CanvasRenderingContext2D }) => ({
    cancel: () => {},
    promise: Promise.resolve(),
  }),
};

/** README 里的完整接线示例（组件定义在模块级，避免每次渲染重建） */
function Reader() {
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const onSelectionChange = vi.fn();

  const getPage = useCallback(async () => fakePage, []);
  const getDocInfo = useCallback(async () => ({ numPages: 1 }), []);

  return (
    <PdfViewer
      file={null}
      highlights={highlights}
      getPage={getPage}
      getDocInfo={getDocInfo}
      onSelectionChange={onSelectionChange}
      onHighlightCreate={(h) =>
        setHighlights((prev) => [
          ...prev,
          {
            id: `h-${prev.length}`,
            color: h.color,
            selectedText: h.selectedText,
            position: h.position,
          },
        ])
      }
    />
  );
}

describe('README 接入示例', () => {
  it('最小接入：只给 file 也能渲染', () => {
    render(<PdfViewer file={null} />);

    expect(screen.getByTestId('pdf-viewer')).toBeTruthy();
  });

  it('完整接线：受控高亮 + 选区回调', async () => {
    render(<Reader />);

    await waitFor(() => {
      expect(screen.getByTestId('pdf-viewer')).toBeTruthy();
    });
  });
});
