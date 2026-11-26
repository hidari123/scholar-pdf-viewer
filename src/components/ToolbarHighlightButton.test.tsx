// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolbarHighlightButton } from './ToolbarHighlightButton';

/*
 * ⚠️ **工具栏的"高亮"分裂按钮**（用户需求：
 * "包工具栏的高亮也需要加个下拉箭头 可以选择颜色
 *  如果没有选就是默认的高亮色"）。
 *
 * -> 主按钮 = 用**当前色**高亮
 * -> ▾ 箭头 = 展开颜色下拉
 * -> 没选过颜色 = **默认色**
 */
const PALETTE = {
  yellow: '#ffd54a',
  green: '#a5d6a7',
  blue: '#90caf9',
};

describe('ToolbarHighlightButton', () => {
  it('**主按钮 -> 用【当前色】高亮**', () => {
    const onHighlight = vi.fn();
    render(
      <ToolbarHighlightButton onHighlight={onHighlight} palette={PALETTE} defaultColor="green" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '高亮' }));
    expect(onHighlight).toHaveBeenCalledWith('green');
  });

  it('**没选过 -> 用【默认色】**', () => {
    const onHighlight = vi.fn();
    render(
      <ToolbarHighlightButton onHighlight={onHighlight} palette={PALETTE} defaultColor="blue" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '高亮' }));
    expect(onHighlight).toHaveBeenCalledWith('blue');
  });

  it('**点箭头 -> 展开颜色下拉**', () => {
    render(
      <ToolbarHighlightButton onHighlight={vi.fn()} palette={PALETTE} defaultColor="yellow" />,
    );
    expect(document.querySelectorAll('.scpdf-toolbar__color-swatch').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '展开颜色下拉' }));
    expect(document.querySelectorAll('.scpdf-toolbar__color-swatch').length).toBe(3);
  });

  it('**选一个色 -> 立刻高亮 + 变成当前色**', () => {
    const onHighlight = vi.fn();
    render(
      <ToolbarHighlightButton onHighlight={onHighlight} palette={PALETTE} defaultColor="yellow" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开颜色下拉' }));
    const swatches = document.querySelectorAll<HTMLElement>('.scpdf-toolbar__color-swatch');
    fireEvent.click(swatches[1] as HTMLElement);

    // ⚠️ **选了就要立刻高亮**
    expect(onHighlight).toHaveBeenCalledWith('green');
    // ⚠️ **下拉要关掉**
    expect(document.querySelectorAll('.scpdf-toolbar__color-swatch').length).toBe(0);

    // ⚠️ **之后主按钮用这个色**
    onHighlight.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '高亮' }));
    expect(onHighlight).toHaveBeenCalledWith('green');
  });

  it('**默认色被标出来**（data-active）', () => {
    render(<ToolbarHighlightButton onHighlight={vi.fn()} palette={PALETTE} defaultColor="green" />);
    fireEvent.click(screen.getByRole('button', { name: '展开颜色下拉' }));
    const active = document.querySelectorAll('.scpdf-toolbar__color-swatch[data-active="true"]');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).title).toBe('绿色');
  });

  it('**色块的 tooltip 是本地化名字**（不是色值）', () => {
    render(
      <ToolbarHighlightButton onHighlight={vi.fn()} palette={PALETTE} defaultColor="yellow" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开颜色下拉' }));
    for (const el of document.querySelectorAll('.scpdf-toolbar__color-swatch')) {
      expect(el.getAttribute('title')).not.toMatch(/^#/);
    }
  });

  it('**没有色板 -> 只画主按钮**（没有下拉）', () => {
    render(<ToolbarHighlightButton onHighlight={vi.fn()} defaultColor="yellow" />);
    expect(document.querySelectorAll('.scpdf-toolbar__btn--split-arrow').length).toBe(0);
    expect(screen.getByRole('button', { name: '高亮' })).not.toBeNull();
  });
});
