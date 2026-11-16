// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HighlightRecord } from '../core/types';
import { AnnotationLayer } from './AnnotationLayer';

/** 造一个高亮 */
function highlight(overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  return {
    id: 'h1',
    color: 'label-6',
    selectedText: '选中的文字',
    position: {
      boundingRect: {
        x1: 10,
        y1: 20,
        x2: 110,
        y2: 40,
        width: 595,
        height: 842,
        pageNumber: 1,
      },
      rects: [
        {
          x1: 10,
          y1: 20,
          x2: 110,
          y2: 40,
          width: 595,
          height: 842,
          pageNumber: 1,
        },
      ],
      pageNumber: 1,
    },
    source: 'my',
    ...overrides,
  };
}

describe('AnnotationLayer', () => {
  /** 最小 props */
  function setup(overrides: Partial<React.ComponentProps<typeof AnnotationLayer>> = {}) {
    const props = {
      pageNumber: 1,
      highlights: [highlight()],
      viewport: { width: 595, height: 842 },
      ...overrides,
    };

    const utils = render(<AnnotationLayer {...props} />);
    return { props, ...utils };
  }

  it('无高亮时不渲染任何元素', () => {
    setup({ highlights: [] });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('渲染高亮块（我的高亮 class）', () => {
    setup();

    const element = screen.getByRole('button');
    expect(element.className).toContain('scpdf-annotation--mine');
  });

  it('他人高亮用不同 class', () => {
    setup({ highlights: [highlight({ source: 'others' })] });

    expect(screen.getByRole('button').className).toContain('scpdf-annotation--others');
  });

  it('坐标按归一化比例换算成视口 px', () => {
    // 参考 595×842，坐标 10,20 → 100,200 时比例 ×0.1
    setup({
      viewport: { width: 59.5, height: 84.2 },
      highlights: [
        highlight({
          position: {
            boundingRect: {
              x1: 10,
              y1: 20,
              x2: 110,
              y2: 40,
              width: 595,
              height: 842,
              pageNumber: 1,
            },
            rects: [
              {
                x1: 10,
                y1: 20,
                x2: 110,
                y2: 40,
                width: 595,
                height: 842,
                pageNumber: 1,
              },
            ],
            pageNumber: 1,
          },
        }),
      ],
    });

    const element = screen.getByRole('button');
    expect(element.style.left).toBe('1px');
    expect(element.style.top).toBe('2px');
    expect(element.style.width).toBe('10px');
    expect(element.style.height).toBe('2px');
  });

  it('只渲染当前页的高亮', () => {
    setup({
      pageNumber: 2,
      highlights: [highlight()],
    });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('点击高亮 → onHighlightClick', async () => {
    const onHighlightClick = vi.fn();
    setup({ onHighlightClick });

    await userEvent.click(screen.getByRole('button'));

    expect(onHighlightClick).toHaveBeenCalledTimes(1);
    expect(onHighlightClick.mock.calls[0]?.[0]?.id).toBe('h1');
  });

  it('激活态加 active class', () => {
    setup({ activeHighlightId: 'h1' });

    expect(screen.getByRole('button').className).toContain('scpdf-annotation--active');
  });

  it('无障碍标签是选中的文本', () => {
    setup();

    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('选中的文字');
  });

  /**
   * 回归：曾经给高亮块加了 `transform: scale(scale)`，
   * 而 rect 已经是视口 px → **双重缩放** → 高亮偏移（实测偏 278px）。
   */
  it('**不加** transform: scale（避免双重缩放）', () => {
    setup();

    const element = screen.getByRole('button');
    expect(element.style.transform).toBe('');
  });

  it('搜索命中也不加 transform: scale', () => {
    setup({
      highlights: [],
      searchRects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    });

    const element = document.querySelector('.scpdf-annotation--search') as HTMLElement;
    expect(element).toBeTruthy();
    expect(element.style.transform).toBe('');
  });

  it('色板命中时用 CSS 变量', () => {
    setup({ palette: { yellow: '#ffd54a' }, highlights: [highlight({ color: 'yellow' })] });

    expect(screen.getByRole('button').style.background).toBe('var(--scpdf-hl-yellow)');
  });

  it('色板未命中时用兜底变量', () => {
    setup({ palette: { yellow: '#ffd54a' }, highlights: [highlight({ color: 'unknown' })] });

    expect(screen.getByRole('button').style.background).toBe('var(--scpdf-highlight-my)');
  });

  it('色板转成 CSS 变量挂在容器上', () => {
    setup({ palette: { yellow: '#ffd54a', 'my-1': '#ff6b6b' } });

    const container = document.querySelector('.scpdf-annotations') as HTMLElement;
    expect(container.style.getPropertyValue('--scpdf-hl-yellow')).toBe('#ffd54a');
    expect(container.style.getPropertyValue('--scpdf-hl-my-1')).toBe('#ff6b6b');
  });
});
