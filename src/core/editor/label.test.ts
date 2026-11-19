/**
 * 富文本工具栏的**文案解析**。
 *
 * ⚠️ 用户反馈："语言切换了 但是切换之后实际上 title 啊什么东西都没切换语言呢"
 */

import { describe, expect, it } from 'vitest';
import { resolveToolbarLabel } from './label';

describe('resolveToolbarLabel', () => {
  it('**普通文案原样返回**', () => {
    expect(resolveToolbarLabel('加粗', 'zh')).toBe('加粗');
  });

  it('**占位符 → 中文**', () => {
    expect(resolveToolbarLabel('{richtext.bold}', 'zh')).toBe('加粗');
  });

  it('**占位符 → 英文**', () => {
    expect(resolveToolbarLabel('{richtext.bold}', 'en')).toBe('Bold');
  });

  it('**没注册的语言 → 退回英文（内置语言只有 zh / en）**', () => {
    expect(resolveToolbarLabel('{richtext.bold}', 'ja')).toBe('Bold');
  });

  it('**宿主覆盖文案优先**', () => {
    expect(resolveToolbarLabel('{richtext.bold}', 'zh', { 'richtext.bold': '粗体' })).toBe('粗体');
  });

  it('**宿主注册的语言表生效**', () => {
    expect(
      resolveToolbarLabel('{richtext.bold}', 'fr', undefined, { fr: { 'richtext.bold': 'Gras' } }),
    ).toBe('Gras');
  });

  it('**不是占位符格式（中间有别的字）→ 原样返回**', () => {
    expect(resolveToolbarLabel('前缀 {richtext.bold}', 'zh')).toBe('前缀 {richtext.bold}');
  });
});
