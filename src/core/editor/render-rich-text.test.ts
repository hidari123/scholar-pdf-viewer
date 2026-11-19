/**
 * 富文本的**安全渲染**。
 *
 * > "展示的时候要展示富文本形式的 不要带上标签 翻译成html展示出来"
 */

import { describe, expect, it } from 'vitest';
import { richTextToPlainText, sanitizeRichTextHtml } from './render-rich-text';

describe('sanitizeRichTextHtml', () => {
  it('**排版标签保留**', () => {
    const html = '<p>hello <strong>world</strong> <em>foo</em></p>';
    const out = sanitizeRichTextHtml(html);
    expect(out).toContain('<strong>world</strong>');
    expect(out).toContain('<em>foo</em>');
    expect(out).toContain('<p>');
  });

  it('**`<script>` 整个丢掉（含内容）**', () => {
    const out = sanitizeRichTextHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>ok</p>');
  });

  it('**事件属性丢掉**', () => {
    const out = sanitizeRichTextHtml('<p onclick="alert(1)">x</p>');
    expect(out).not.toContain('onclick');
  });

  it('**`<iframe>` 丢掉**', () => {
    const out = sanitizeRichTextHtml('<iframe src="http://evil"></iframe><p>ok</p>');
    expect(out).not.toContain('iframe');
    expect(out).toContain('<p>ok</p>');
  });

  it('**非白名单标签丢掉（保留内容）**', () => {
    const out = sanitizeRichTextHtml('<marquee>hello</marquee>');
    expect(out).not.toContain('marquee');
    expect(out).toContain('hello');
  });

  it('**http 链接保留**', () => {
    const out = sanitizeRichTextHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('href="https://example.com"');
  });

  it('**mailto 链接保留**', () => {
    const out = sanitizeRichTextHtml('<a href="mailto:a@b.com">mail</a>');
    expect(out).toContain('mailto:');
  });

  it('**javascript: 链接 → 去掉 href（保留文字）**', () => {
    const out = sanitizeRichTextHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('**`style` 里的 url() 丢掉**', () => {
    const out = sanitizeRichTextHtml('<span style="background:url(http://evil)">x</span>');
    expect(out).not.toContain('url(');
  });

  it('**空字符串 → 空字符串**', () => {
    expect(sanitizeRichTextHtml('')).toBe('');
  });

  it('**普通文本不受影响**', () => {
    expect(sanitizeRichTextHtml('hello')).toBe('hello');
  });
});

describe('richTextToPlainText', () => {
  it('**去掉标签**', () => {
    expect(richTextToPlainText('<p>hello</p>')).toBe('hello');
  });

  it('**`<br>` → 换行**', () => {
    expect(richTextToPlainText('a<br>b')).toContain('\n');
  });

  it('**段落之间有间隔**', () => {
    expect(richTextToPlainText('<p>a</p><p>b</p>')).toContain('\n');
  });

  it('**实体解码**', () => {
    expect(richTextToPlainText('a &amp; b')).toBe('a & b');
    expect(richTextToPlainText('&lt;tag&gt;')).toBe('<tag>');
  });

  it('**空字符串**', () => {
    expect(richTextToPlainText('')).toBe('');
  });
});
