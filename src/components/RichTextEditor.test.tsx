// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

describe('RichTextEditor', () => {
  /** 最小 props */
  function setup(overrides: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
    const props = {
      value: '',
      onChange: vi.fn(),
      ...overrides,
    };
    const utils = render(<RichTextEditor {...props} />);
    return { props, ...utils };
  }

  it('渲染工具栏按钮', () => {
    setup({ palette: { yellow: '#fff3a3' } });

    expect(screen.getByLabelText('加粗')).toBeTruthy();
    expect(screen.getByLabelText('清除格式')).toBeTruthy();
    expect(screen.getByLabelText('高亮')).toBeTruthy();
  });

  /*
   * ⚠️ **"无背景色"色块**（用户需求：
   * "高亮这个按钮需要加上一个无背景颜色的选项，如飞书样式"）。
   */
  it('**点"高亮"弹出面板，第一个是"无背景色"斜杠色块**', async () => {
    setup({ palette: { yellow: '#fff3a3' } });

    await userEvent.click(screen.getByLabelText('高亮'));
    console.log(
      'DEBUG palette:',
      !!document.querySelector('.scpdf-rich-text__palette'),
      'html:',
      document.querySelector('.scpdf-rich-text__toolbar')?.innerHTML?.slice(0, 200),
    );

    const none = screen.getByLabelText('无背景色');
    expect(none.className).toContain('scpdf-rich-text__swatch--none');
  });

  it('**面板里有"无背景色"+ 所有颜色**', async () => {
    setup({ palette: { yellow: '#fff3a3', green: '#c8e6c9' } });

    await userEvent.click(screen.getByLabelText('高亮'));

    // ⚠️ **斜杠色块 + 2 个颜色** = 3 个
    expect(document.querySelectorAll('.scpdf-rich-text__swatch')).toHaveLength(3);
  });

  /*
   * ⚠️ **点面板外面要关闭**（用户反馈：
   * "如果点击非选择颜色框的区域 是需要关闭这个选择框的"）。
   */
  it('**点面板外面关闭面板**', async () => {
    setup({ palette: { yellow: '#fff3a3' } });

    await userEvent.click(screen.getByLabelText('高亮'));
    expect(document.querySelector('.scpdf-rich-text__palette')).toBeTruthy();

    // ⚠️ **点 body**（面板外面）
    await userEvent.click(document.body);
    expect(document.querySelector('.scpdf-rich-text__palette')).toBeNull();
  });

  it('**点面板里面不关闭**', async () => {
    setup({ palette: { yellow: '#fff3a3' } });

    await userEvent.click(screen.getByLabelText('高亮'));
    const panel = document.querySelector('.scpdf-rich-text__palette');
    expect(panel).toBeTruthy();

    await userEvent.click(panel as HTMLElement);
    expect(document.querySelector('.scpdf-rich-text__palette')).toBeTruthy();
  });

  /*
   * ⚠️ **没选文字时格式按钮置灰**（用户需求：
   * "清除格式按钮如果没有选择文字 应该置灰"）。
   */
  it('**没选文字时"清除格式"是 disabled**', () => {
    setup();

    const btn = screen.getByLabelText('清除格式') as HTMLButtonElement;
    const sel = window.getSelection();
    console.log(
      'DEBUG sel:',
      JSON.stringify({
        collapsed: sel?.isCollapsed,
        anchorNode: !!sel?.anchorNode,
        rangeCount: sel?.rangeCount,
      }),
    );
    expect(btn.disabled).toBe(true);
  });
});
