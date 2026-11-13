// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OutlineItemLike } from '../core/outline/outline';
import { OutlinePanel } from './OutlinePanel';

/** 页引用 → 页码 */
function mapper(ref: unknown): number | null {
  if (typeof ref === 'number') {
    return ref;
  }
  if (ref && typeof ref === 'object' && 'num' in ref) {
    return (ref as { num: number }).num;
  }
  return null;
}

/** 造一棵目录树 */
function outline(): OutlineItemLike[] {
  return [
    {
      title: '第一章',
      dest: [1, '/XYZ'],
      items: [
        { title: '1.1 节', dest: [2, '/XYZ'] },
        { title: '1.2 节', dest: [3, '/XYZ'] },
      ],
    },
    { title: '第二章', dest: [5, '/XYZ'] },
  ];
}

describe('OutlinePanel', () => {
  /** 最小 props */
  function setup(overrides: Partial<React.ComponentProps<typeof OutlinePanel>> = {}) {
    const props = {
      outline: outline(),
      pageRefToNumber: mapper,
      currentPage: 1,
      onPageSelect: vi.fn(),
      ...overrides,
    };

    render(<OutlinePanel {...props} />);
    return props;
  }

  it('渲染目录项', () => {
    setup();

    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('第二章')).toBeTruthy();
  });

  it('默认全部展开（子项可见）', () => {
    setup();

    expect(screen.getByText('1.1 节')).toBeTruthy();
  });

  it('点目录项 → onPageSelect(页码)', async () => {
    const props = setup();

    await userEvent.click(screen.getByText('第二章'));

    expect(props.onPageSelect).toHaveBeenCalledWith(5);
  });

  it('点折叠按钮 → 子项隐藏', async () => {
    setup();

    // 第一个折叠按钮对应"第一章"
    const toggle = document.querySelectorAll('.scpdf-outline__toggle')[0];
    expect(toggle).toBeTruthy();
    await userEvent.click(toggle as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByText('1.1 节')).toBeNull();
    });
  });

  it('再点一次 → 子项恢复', async () => {
    setup();

    const toggle = document.querySelectorAll('.scpdf-outline__toggle')[0];
    await userEvent.click(toggle as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByText('1.1 节')).toBeNull();
    });

    await userEvent.click(toggle as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('1.1 节')).toBeTruthy();
    });
  });

  it('当前页高亮', () => {
    setup({ currentPage: 5 });

    expect(screen.getByText('第二章').className).toContain('scpdf-outline__item--active');
  });

  it('无解析出页码的项禁用', () => {
    setup({
      outline: [{ title: '无目标', dest: null }],
    });

    expect(screen.getByText('无目标').hasAttribute('disabled')).toBe(true);
  });

  it('空目录 → 不渲染面板', () => {
    const { container } = render(
      <OutlinePanel outline={[]} pageRefToNumber={mapper} currentPage={1} onPageSelect={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
  });
});
