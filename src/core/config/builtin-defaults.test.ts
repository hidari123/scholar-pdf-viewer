/**
 * 包的内置默认值。
 *
 * > "语言和高亮色都是包需要内置的 但是有接口宿主可以配置
 * > 现在你都放宿主这里了"
 *
 * ## 验证什么
 *
 * 1. **内置的高亮色板**（宿主不传也有）
 * 2. **内置的语言表**（中文 / 英文必须内置）
 * 3. 宿主可以**覆盖**内置的（任意语言、任意一句）
 * 4. `core` 子路径也能拿到内置的（不用从主入口 import）
 */

import { describe, expect, it } from 'vitest';
import type { MessageKey } from '../../i18n/messages';
import {
  BUILTIN_HIGHLIGHT_PALETTE,
  BUILTIN_LOCALES,
  detectDefaultLocale,
  mergeLocales,
} from './builtin-defaults';
import { mergeConfig } from './index';

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

  it('**key 是语义名（宿主可以按 key 存用户选的颜色）**', () => {
    const keys = Object.keys(BUILTIN_HIGHLIGHT_PALETTE);
    expect(keys).toContain('yellow');
    expect(keys).toContain('green');
    for (const key of keys) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });
});

describe('内置语言表', () => {
  it('**中文和英文是内置的**（用户需求）', () => {
    expect(BUILTIN_LOCALES.zh).toBeDefined();
    expect(BUILTIN_LOCALES.en).toBeDefined();
  });

  it('**中文和英文覆盖了核心文案**', () => {
    const coreKeys = [
      'search.placeholder',
      'search.next',
      'outline.title',
      'zoom.fitWidth',
      'annotation.save',
      'toast.copied',
    ];
    for (const locale of ['zh', 'en'] as const) {
      for (const key of coreKeys as MessageKey[]) {
        expect(BUILTIN_LOCALES[locale]?.[key]).toBeTruthy();
      }
    }
  });

  it('**还内置了扩展语言（ja / fr）**', () => {
    expect(BUILTIN_LOCALES.ja).toBeDefined();
    expect(BUILTIN_LOCALES.fr).toBeDefined();
  });

  it('**每个内置语言都覆盖了核心文案**', () => {
    const coreKeys = [
      'search.placeholder',
      'search.next',
      'outline.title',
      'zoom.fitWidth',
      'annotation.save',
      'toast.copied',
    ];
    for (const messages of Object.values(BUILTIN_LOCALES)) {
      for (const key of coreKeys as MessageKey[]) {
        expect(messages[key]).toBeTruthy();
      }
    }
  });
});

describe('mergeLocales（合并宿主的语言表）', () => {
  it('**不传 -> 只有内置的**', () => {
    const merged = mergeLocales();
    expect(Object.keys(merged)).toContain('zh');
    expect(Object.keys(merged)).toContain('en');
    expect(Object.keys(merged)).toContain('ja');
  });

  it('**宿主的新语言会被加进来**', () => {
    const merged = mergeLocales({ ko: { 'search.placeholder': '검색' } });
    expect(merged.ko?.['search.placeholder']).toBe('검색');
  });

  it('**宿主可以覆盖内置的中文**', () => {
    const merged = mergeLocales({ zh: { 'search.placeholder': '我的搜索' } });
    expect(merged.zh?.['search.placeholder']).toBe('我的搜索');
  });

  it('**宿主可以覆盖内置的英文**', () => {
    const merged = mergeLocales({ en: { 'search.placeholder': 'My Search' } });
    expect(merged.en?.['search.placeholder']).toBe('My Search');
  });

  it('**覆盖中文不影响英文**', () => {
    const merged = mergeLocales({ zh: { 'search.placeholder': '我的搜索' } });
    expect(merged.en?.['search.placeholder']).toBe('Search document');
  });

  it('**宿主只覆盖一句 -> 其他内置的还在**', () => {
    const merged = mergeLocales({ ja: { 'search.placeholder': '検索' } });
    expect(merged.ja?.['search.next']).toBe('次へ');
  });

  it('**不会污染内置的表**（每次都是新对象）', () => {
    const merged = mergeLocales({ zh: { 'search.placeholder': '我的搜索' } });
    merged.zh?.['search.next'];
    expect(BUILTIN_LOCALES.zh?.['search.placeholder']).not.toBe('我的搜索');
  });
});

describe('detectDefaultLocale（推断语言）', () => {
  it('**返回受支持的语言**', () => {
    expect(detectDefaultLocale()).toMatch(/^(zh|en|ja|fr)$/);
  });

  it('**宿主可以指定兜底**', () => {
    expect(detectDefaultLocale('zh')).toBeTruthy();
  });
});

describe('mergeConfig（宿主什么都不传 -> 用内置的）', () => {
  it('**色板用内置的**', () => {
    const merged = mergeConfig(undefined, {});
    expect(merged.highlightPalette).toBeDefined();
    expect(Object.keys(merged.highlightPalette ?? {}).length).toBeGreaterThan(0);
    expect(merged.highlightPalette?.yellow).toBe(BUILTIN_HIGHLIGHT_PALETTE.yellow);
  });

  it('**语言表用内置的（含中英文）**', () => {
    const merged = mergeConfig(undefined, {});
    expect(Object.keys(merged.locales ?? {})).toContain('zh');
    expect(Object.keys(merged.locales ?? {})).toContain('en');
  });

  it('**宿主传的色板完全覆盖内置的**', () => {
    const merged = mergeConfig({}, { highlightPalette: { my: '#123456' } });
    expect(merged.highlightPalette).toEqual({ my: '#123456' });
    expect(merged.highlightPalette?.yellow).toBeUndefined();
  });

  it('**宿主传的语言表合并到内置的上面**', () => {
    const merged = mergeConfig({}, { locales: { zh: { 'search.placeholder': '我的搜索' } } });
    expect(merged.locales?.zh?.['search.placeholder']).toBe('我的搜索');
    expect(merged.locales?.en?.['search.placeholder']).toBe('Search document');
  });
});
