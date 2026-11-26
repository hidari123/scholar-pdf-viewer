// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnnotationPanel } from './AnnotationPanel';

/**
 * 渲染一个"只读"的批注详情面板。
 */
function renderPanel(content: string) {
  return render(
    <AnnotationPanel
      annotation={{
        id: 'n1',
        highlightId: 'h1',
        content,
        createdAt: 0,
      }}
      container={{ width: 800, height: 600 }}
      anchorRect={{ left: 100, top: 100, right: 130, bottom: 130 }}
      locale="zh"
    />,
  );
}

/*
 * ⚠️⚠️ **只读内容必须自己消毒**（审核发现的安全问题）。
 *
 * -> 之前**直接渲染宿主的 html** ❌
 * -> 但同一个包的 `RichTextPreview` **是消毒的** ✅ -> **不一致** ❌
 * -> -> 现在**一律消毒**  （纵深防御）
 * -> -> 宿主传了脏数据也不会出事
 */
describe('只读内容的 XSS 防护', () => {
  it('**去掉 <script>**', () => {
    const { container } = renderPanel('<p>ok</p><script>alert(1)</script>');
    const html = container.innerHTML;
    expect(html).not.toContain('script');
    expect(html).toContain('ok');
  });

  it('**去掉 on* 事件属性**', () => {
    const { container } = renderPanel('<p onclick="alert(1)">x</p>');
    expect(container.innerHTML.toLowerCase()).not.toContain('onclick');
  });

  it('**去掉 javascript: 链接**', () => {
    const { container } = renderPanel('<a href="javascript:alert(1)">x</a>');
    expect(container.innerHTML.toLowerCase()).not.toContain('javascript:');
  });

  it('**去掉 iframe**', () => {
    const { container } = renderPanel('<iframe src="http://evil"></iframe><p>ok</p>');
    expect(container.innerHTML.toLowerCase()).not.toContain('<iframe');
    expect(container.innerHTML).toContain('ok');
  });

  it('**保留正常格式**', () => {
    const { container } = renderPanel('<p><strong>粗</strong><em>斜</em></p>');
    expect(container.innerHTML).toContain('strong');
    expect(container.innerHTML).toContain('em');
  });
});
