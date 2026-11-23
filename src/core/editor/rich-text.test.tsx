// @vitest-environment jsdom
/**
 * `core/editor/rich-text` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> `sanitizeRichText` 是**包的根导出**（`src/index.ts`）
 *   -> 它是**批注内容的 XSS 防线**（批注 HTML 会存到宿主后端！）
 *   -> 但**零测试**
 *
 * ## 审计发现的真实漏洞
 *
 * -> `style` 的过滤正则：`/(^|;)\s*(background-color|color)\s*:\s*([^;]+)/i`
 *   -> 值组 `[^;]+` **会把 `url(...)` 一起吞掉**
 *   -> `background-color:url(javascript:alert(1))` **能通过**
 */

import { describe, expect, it } from 'vitest';
import { defaultRichTextToolbar, richTextToPlain, sanitizeRichText } from './rich-text';

describe('sanitizeRichText（XSS 防线）', () => {
  it('去掉 on* 事件属性', () => {
    const out = sanitizeRichText('<p onclick="alert(1)">文字</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('文字');
  });

  it('去掉 <script> 标签（但保留文字）', () => {
    const out = sanitizeRichText('<script>alert(1)</script><p>正常</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('</script');
    expect(out).toContain('正常');
  });

  it('去掉 <img>（避免 onerror）', () => {
    const out = sanitizeRichText('<img src=x onerror=alert(1)><p>文字</p>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
  });

  it('javascript: 协议的 href 被去掉', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">点</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('点');
  });

  it('data: 协议的 href 也被去掉', () => {
    const out = sanitizeRichText('<a href="data:text/html,x">点</a>');
    expect(out).not.toContain('data:');
  });

  it('http / https / mailto 的 href 保留，并加上安全属性', () => {
    for (const href of ['https://example.com', 'http://example.com', 'mailto:a@b.com']) {
      const out = sanitizeRichText(`<a href="${href}">点</a>`);
      expect(out).toContain(href);
      expect(out).toContain('rel="noopener noreferrer"');
      expect(out).toContain('target="_blank"');
    }
  });

  it('**style 里的 url() 被去掉**（审计发现的漏洞）', () => {
    const out = sanitizeRichText(
      '<span style="background-color:url(javascript:alert(1))">x</span>',
    );
    expect(out).not.toContain('url(');
    expect(out).not.toContain('javascript:');
  });

  it('**style 里的 url() 在 color 里也被去掉**', () => {
    const out = sanitizeRichText('<mark style="color:url(javascript:alert(1))">x</mark>');
    expect(out).not.toContain('url(');
    expect(out).not.toContain('javascript:');
  });

  it('保留正常的颜色样式', () => {
    const out = sanitizeRichText('<mark style="background-color:#ff0">x</mark>');
    expect(out).toContain('background-color');
    expect(out).toContain('#ff0');
  });

  it('**其它 style 属性被丢掉**（只留颜色）', () => {
    const out = sanitizeRichText(
      '<span style="position:fixed;top:0;background-color:#ff0">x</span>',
    );
    expect(out).not.toContain('position');
    expect(out).not.toContain('top:0');
    expect(out).toContain('background-color');
  });

  it('其它标签的属性全被清空', () => {
    const out = sanitizeRichText('<p class="evil" id="x" data-a="1">文字</p>');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('id=');
    expect(out).not.toContain('data-a');
  });

  it('保留允许的格式标签', () => {
    const out = sanitizeRichText(
      '<p><strong>粗</strong><em>斜</em><u>下划线</u><s>删除线</s><mark>高亮</mark></p>',
    );
    for (const tag of ['<strong>', '<em>', '<u>', '<s>', '<mark>']) {
      expect(out).toContain(tag);
    }
  });

  it('保留列表和引用', () => {
    const out = sanitizeRichText('<ul><li>一</li></ul><blockquote>引用</blockquote>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('<blockquote>');
  });

  it('空字符串不报错', () => {
    expect(sanitizeRichText('')).toBe('');
  });
});

describe('richTextToPlain', () => {
  it('去掉标签只留文字', () => {
    expect(richTextToPlain('<p>第一段</p><p>第二段</p>')).toBe('第一段第二段');
  });

  it('实体被解码', () => {
    expect(richTextToPlain('&amp;&lt;')).toBe('&<');
  });

  it('空字符串', () => {
    expect(richTextToPlain('')).toBe('');
  });
});

describe('defaultRichTextToolbar', () => {
  it('不带色板时**没有"高亮底色"按钮**', () => {
    const commands = defaultRichTextToolbar().map((i) => i.command);
    expect(commands).not.toContain('hiliteColor');
    // 但"文字颜色"还在（它不依赖色板）
    expect(commands).toContain('foreColor');
  });

  it('带色板时**有"高亮底色"按钮**', () => {
    const commands = defaultRichTextToolbar({ yellow: '#ff0' }).map((i) => i.command);
    expect(commands).toContain('hiliteColor');
  });

  it('**按钮顺序固定**（加粗 -> 斜体 -> 下划线 -> 删除线 -> 高亮 -> 文字高亮 -> 文字颜色）', () => {
    const commands = defaultRichTextToolbar({ yellow: '#ff0' }).map((i) => i.command);
    expect(commands.slice(0, 7)).toEqual([
      'bold',
      'italic',
      'underline',
      'strikeThrough',
      'hiliteColor',
      'textHighlight',
      'foreColor',
    ]);
  });

  /*
   * ⚠️ **文字颜色必须用【深色】色板**（用户反馈：
   * "富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色"）。
   */
  it('**文字颜色用独立的深色板**（不复用浅色的高亮板）', () => {
    const items = defaultRichTextToolbar({ yellow: '#fff3a3' }, { red: '#c62828' });
    const fore = items.find((i) => i.command === 'foreColor');
    expect(fore?.palette).toEqual({ red: '#c62828' });
  });

  it('**"文字高亮"用高亮板**（浅色 -> 适合当背景）', () => {
    const items = defaultRichTextToolbar({ yellow: '#fff3a3' }, { red: '#c62828' });
    const highlight = items.find((i) => i.command === 'textHighlight');
    expect(highlight?.palette).toEqual({ yellow: '#fff3a3' });
  });

  it('每个按钮都有 i18n 占位符（宿主才能翻译）', () => {
    for (const item of defaultRichTextToolbar({ yellow: '#ff0' })) {
      expect(item.label).toMatch(/^\{richtext\.\w+\}$/);
    }
  });
});
