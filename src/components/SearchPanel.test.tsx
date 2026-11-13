// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TextPageLike } from '../core/search/search';
import { PdfSearch } from '../core/search/search';
import { SearchPanel } from './SearchPanel';

/** 造一个带文字的页 */
function fakePage(text: string, pageNumber = 1): TextPageLike {
  return {
    pageNumber,
    getTextContent: async () => ({
      items: [{ str: text, transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1, hasEOL: false }],
    }),
  };
}

describe('SearchPanel', () => {
  /** 建一个搜索引擎（3 页，每页有 "agent" 字样） */
  function makeSearch() {
    return new PdfSearch();
  }

  it('输入关键词 → 显示命中数', async () => {
    const search = makeSearch();
    await search.buildIndex(async (n) => fakePage(`page ${n} agent text`), 3);

    render(<SearchPanel search={search} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox'), 'agent');

    await waitFor(() => {
      expect(screen.getByText('3 个结果')).toBeTruthy();
    });
  });

  it('无命中 → 显示"未找到"', async () => {
    const search = makeSearch();
    await search.buildIndex(async (n) => fakePage(`page ${n}`), 3);

    render(<SearchPanel search={search} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox'), 'zzzz');

    await waitFor(() => {
      expect(screen.getByText('未找到匹配内容')).toBeTruthy();
    });
  });

  it('点下一个 → onNavigate 被调用', async () => {
    const search = makeSearch();
    await search.buildIndex(async (n) => fakePage(`agent page ${n}`), 3);

    const onNavigate = vi.fn();
    render(<SearchPanel search={search} onClose={vi.fn()} onNavigate={onNavigate} />);

    await userEvent.type(screen.getByRole('searchbox'), 'agent');
    await waitFor(() => {
      expect(screen.getByText('3 个结果')).toBeTruthy();
    });

    await userEvent.click(screen.getByLabelText('下一个'));

    expect(onNavigate).toHaveBeenCalled();
    expect(onNavigate.mock.calls[0]?.[0]?.pageNumber).toBe(2);
  });

  it('点关闭 → onClose 被调用', async () => {
    const onClose = vi.fn();
    render(<SearchPanel search={makeSearch()} onClose={onClose} />);

    await userEvent.click(screen.getByLabelText('关闭'));

    expect(onClose).toHaveBeenCalled();
  });

  it('无搜索引擎时输入不报错', async () => {
    render(<SearchPanel search={null} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox'), 'test');

    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('索引已建好时直接搜索', async () => {
    const search = makeSearch();
    // 宿主建好索引（提供取页函数）
    await search.buildIndex(async (n) => fakePage(`agent page ${n}`), 3);

    render(<SearchPanel search={search} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox'), 'agent');

    await waitFor(
      () => {
        expect(screen.getByText('3 个结果')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('没有取页函数时索引无法建立（面板不崩溃）', async () => {
    const search = makeSearch();

    render(<SearchPanel search={search} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox'), 'agent');

    await waitFor(() => {
      expect(screen.getByText('未找到匹配内容')).toBeTruthy();
    });
  });
});
