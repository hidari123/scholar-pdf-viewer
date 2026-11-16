import { describe, expect, it } from 'vitest';
import { DEFAULT_HIGHLIGHT_PALETTE, paletteToCssVars, resolveHighlightColor } from './palette';

describe('resolveHighlightColor', () => {
  it('命中色板时返回对应颜色', () => {
    const palette = { yellow: '#ffd54a', green: '#a5d6a7' };

    expect(resolveHighlightColor(palette, 'yellow', '#000')).toBe('#ffd54a');
    expect(resolveHighlightColor(palette, 'green', '#000')).toBe('#a5d6a7');
  });

  it('未命中时返回兜底色', () => {
    expect(resolveHighlightColor({ yellow: '#ffd54a' }, 'purple', '#fallback')).toBe('#fallback');
  });

  it('没有色板时返回兜底色', () => {
    expect(resolveHighlightColor(undefined, 'yellow', '#fallback')).toBe('#fallback');
  });

  it('key 为空时返回兜底色', () => {
    expect(resolveHighlightColor({ yellow: '#ffd54a' }, undefined, '#fallback')).toBe('#fallback');
  });
});

describe('paletteToCssVars', () => {
  it('转成 --scpdf-hl-<key> 变量', () => {
    const vars = paletteToCssVars({ yellow: '#ffd54a', 'my-1': '#ff6b6b' });

    expect(vars).toEqual({
      '--scpdf-hl-yellow': '#ffd54a',
      '--scpdf-hl-my-1': '#ff6b6b',
    });
  });

  it('没有色板时返回空对象', () => {
    expect(paletteToCssVars(undefined)).toEqual({});
  });

  it('空色板返回空对象', () => {
    expect(paletteToCssVars({})).toEqual({});
  });
});

describe('DEFAULT_HIGHLIGHT_PALETTE', () => {
  it('内置 6 个颜色', () => {
    expect(Object.keys(DEFAULT_HIGHLIGHT_PALETTE)).toHaveLength(6);
  });

  it('都是合法的 CSS 十六进制颜色', () => {
    for (const color of Object.values(DEFAULT_HIGHLIGHT_PALETTE)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
