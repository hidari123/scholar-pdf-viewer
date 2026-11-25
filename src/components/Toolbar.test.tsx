// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  /** 最小 props */
  function setup(overrides: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
    const props = {
      page: 3,
      totalPages: 10,
      scale: 1.5,
      locale: 'zh' as const,
      onPageChange: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onFitWidth: vi.fn(),
      onFitPage: vi.fn(),
      ...overrides,
    };

    render(<Toolbar {...props} />);
    return props;
  }

  /*
   * ⚠️ **导出 / 下载按钮**（用户需求 ✅）
   *
   * > "包需要内置导出带高亮的 PDF、导出高亮、PDF 下载"
   *
   * -> 宿主给回调 ✅ -> 按钮出现 ✅ ✅
   * -> 不给 ✅ -> 按钮**不出现** ✅ ✅
   */
  it('**不传回调 -> 不渲染导出按钮** ✅', () => {
    setup();
    expect(screen.queryByLabelText('下载 PDF')).toBeNull();
    expect(screen.queryByLabelText('导出带高亮的 PDF')).toBeNull();
    expect(screen.queryByLabelText('导出高亮')).toBeNull();
  });

  it('**传回调 -> 渲染三个按钮并可点** ✅', async () => {
    const onDownloadPdf = vi.fn();
    const onExportAnnotatedPdf = vi.fn();
    const onExportHighlights = vi.fn();
    setup({ onDownloadPdf, onExportAnnotatedPdf, onExportHighlights });

    await userEvent.click(screen.getByLabelText('下载 PDF'));
    expect(onDownloadPdf).toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('导出带高亮的 PDF'));
    expect(onExportAnnotatedPdf).toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('导出高亮'));
    expect(onExportHighlights).toHaveBeenCalled();
  });

  it('显示当前页与总页数', () => {
    setup();

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('3');
    expect(screen.getByText('/ 10')).toBeTruthy();
  });

  it('点上一页 → onPageChange(page-1)', async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText('上一页'));

    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it('点下一页 → onPageChange(page+1)', async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText('下一页'));

    expect(props.onPageChange).toHaveBeenCalledWith(4);
  });

  it('首页时上一页按钮禁用', () => {
    setup({ page: 1 });

    expect(screen.getByLabelText('上一页').hasAttribute('disabled')).toBe(true);
  });

  it('末页时下一页按钮禁用', () => {
    setup({ page: 10, totalPages: 10 });

    expect(screen.getByLabelText('下一页').hasAttribute('disabled')).toBe(true);
  });

  it('输入页码 → onPageChange', async () => {
    const props = setup();
    const input = screen.getByRole('spinbutton');

    await userEvent.clear(input);
    await userEvent.type(input, '7');

    expect(props.onPageChange).toHaveBeenCalledWith(7);
  });

  it('输入越界页码不触发回调', async () => {
    const props = setup({ page: 1, totalPages: 5 });
    const input = screen.getByRole('spinbutton');

    // 逐字符输入 "9"：每一步都超出总页数 → 不触发
    await userEvent.clear(input);
    await userEvent.type(input, '9');

    expect(props.onPageChange).not.toHaveBeenCalled();
  });

  it('输入中途合法则立即跳页（如输入 7 跳到第 7 页）', async () => {
    const props = setup({ page: 1, totalPages: 10 });
    const input = screen.getByRole('spinbutton');

    await userEvent.clear(input);
    await userEvent.type(input, '7');

    expect(props.onPageChange).toHaveBeenCalledWith(7);
  });

  it('显示当前缩放百分比', () => {
    setup({ scale: 1.25 });

    expect(screen.getByText('125%')).toBeTruthy();
  });

  it('点放大/缩小 → 回调', async () => {
    const props = setup();

    await userEvent.click(screen.getByLabelText('放大'));
    await userEvent.click(screen.getByLabelText('缩小'));

    expect(props.onZoomIn).toHaveBeenCalled();
    expect(props.onZoomOut).toHaveBeenCalled();
  });

  it('缩放到上限后放大按钮禁用', () => {
    setup({ scale: 2.5 });

    expect(screen.getByLabelText('放大').hasAttribute('disabled')).toBe(true);
  });

  it('showPageNav=false → 不显示翻页控件', () => {
    setup({ toolbar: { showPageNav: false } });

    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('showZoom=false → 不显示缩放控件', () => {
    setup({ toolbar: { showZoom: false } });

    expect(screen.queryByText('150%')).toBeNull();
  });

  it('slots 渲染宿主内容', () => {
    setup({
      toolbar: {
        leftSlot: <button type="button">历史</button>,
        rightSlot: <button type="button">分享</button>,
      },
    });

    expect(screen.getByText('历史')).toBeTruthy();
    expect(screen.getByText('分享')).toBeTruthy();
  });

  /*
   * ⚠️⚠️ **审计发现的两个 bug 的回归守卫**。
   */

  it('**打印按钮和缩放按钮互相独立**（showZoom: false 也要有打印）', () => {
    setup({ toolbar: { showZoom: false }, onPrint: vi.fn() });

    // 打印按钮**在**（之前它被 showZoom 连带隐藏了）
    expect(screen.queryByLabelText('打印')).toBeTruthy();
    // 缩放按钮**不在**
    expect(screen.queryByLabelText('放大')).toBeNull();
    expect(screen.queryByText('150%')).toBeNull();
  });

  it('**showZoom: false 时宿主的 rightSlot 照样渲染**', () => {
    setup({
      toolbar: {
        showZoom: false,
        rightSlot: <button type="button">分享</button>,
      },
    });

    expect(screen.getByText('分享')).toBeTruthy();
  });

  it('**rightSlot 只渲染一次**（不能出现两个"分享"）', () => {
    setup({
      toolbar: { rightSlot: <button type="button">分享</button> },
      onPrint: vi.fn(),
    });

    // ⚠️ 有打印按钮 + 有缩放 -> 也不能重复
    expect(screen.getAllByText('分享')).toHaveLength(1);
  });

  it('**leftSlot 也和 showZoom 独立**', () => {
    setup({
      toolbar: {
        showZoom: false,
        leftSlot: <button type="button">历史</button>,
      },
    });

    expect(screen.getByText('历史')).toBeTruthy();
  });

  it('搜索按钮回调（未提供时不显示）', async () => {
    const onToggleSearch = vi.fn();
    setup({ onToggleSearch });

    await userEvent.click(screen.getByLabelText('搜索文档'));

    expect(onToggleSearch).toHaveBeenCalled();
  });

  it('未提供回调时不显示对应按钮', () => {
    setup();

    expect(screen.queryByLabelText('搜索文档')).toBeNull();
  });
});
