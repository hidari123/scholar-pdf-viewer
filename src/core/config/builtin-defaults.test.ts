/**
 * 包的内置默认值。
 *
 * > "语言和高亮色都是包需要内置的 但是有接口宿主可以配置
 * > 现在你都放宿主这里了"
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_HIGHLIGHT_PALETTE,
  BUILTIN_LOCALES,
  detectDefaultLocale,
  mergeLocales,
} from './builtin-defaults';

describe('内置高亮色板', () => {
  it('**有内置的色板（宿主不传也能用）**', () => {
    expect(Object.keys(BUILTIN_HIGHLIGHT_PALETTE).length).toBeGreaterThan(0);
  });

  it('**包含常见的高亮色**', () => {
    expect(BUILTIN_HIGHLIGHT_PALETTE.yellow).toBeDefined();
    expect(BUILTIN_HIGHLIGHT_PALETTE.green).toBeDefined();
    expect(BUILTIN_HIGHLIGHT_PALETTE.blue).toBeDefined();
  });

  it('**每个颜色都是合法的 CSS 颜色**', () => {
    for (const color of Object.values(BUILTIN_HIGHLIGHT_PALETTE)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('内置语言表', () => {
  it('**内置了扩展语言（ja / fr）**', () => {
    expect(BUILTIN_LOCALES.ja).toBeDefined();
    expect(BUILTIN_LOCALES.fr).toBeDefined();
  });

  it('**每个语言都覆盖了"核心"的文案**', () => {
    const coreKeys = [
      'search.placeholder',
      'search.next',
      'outline.title',
      'zoom.fitWidth',
      'annotation.save',
      'toast.copied',
    ];
    for (const messages of Object.values(BUILTIN_LOCALES)) {
      for (const key of coreKeys) {
        expect(messages[key as keyof typeof messages]).toBeTruthy();
      }
    }
  });
});

describe('mergeLocales（合并宿主的语言表）', () => {
  it('**不传 → 只有内置的**', () => {
    const merged = mergeLocales();
    expect(Object.keys(merged)).toContain('ja');
    expect(Object.keys(merged)).toContain('fr');
  });

  it('**宿主的新语言会被加进来**', () => {
    const merged = mergeLocales({ ko: { 'search.placeholder': '검색' } });
    expect(merged.ko?.['search.placeholder']).toBe('검색');
  });

  it('**宿主的文案覆盖内置的**', () => {
    const merged = mergeLocales({ ja: { 'search.placeholder': '検索' } });
    expect(merged.ja?.['search.placeholder']).toBe('検索');
  });

  it('**宿主只覆盖一句 → 其他内置的还在**', () => {
    const merged = mergeLocales({ ja: { 'search.placeholder': '検索' } });
    expect(merged.ja?.['search.next']).toBe('次へ');
  });

  it('**不会污染内置的表**（每次都是新对象）', () => {
    const merged = mergeLocales({ ja: { 'search.placeholder': '検索' } });
    merged.ja?.['search.next'];
    expect(BUILTIN_LOCALES.ja?.['search.placeholder']).not.toBe('検索');
  });
});

describe('detectDefaultLocale（推断语言）', () => {
  it('**中文 → zh**', () => {
    expect(detectDefaultLocale()).toMatch(/^(zh|en|ja|fr)$/);
  });

  it('**宿主可以指定兜底**', () => {
    expect(detectDefaultLocale('zh')).toBeTruthy();
  });
});
