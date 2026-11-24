import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIGHLIGHT_PALETTE,
  HIGHLIGHT_COLOR_NAMES,
  paletteToCssVars,
  resolveHighlightColor,
  resolveHighlightColorName,
} from './palette';

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
    expect(Object.keys(DEFAULT_HIGHLIGHT_PALETTE)).toHaveLength(8);
  });

  it('都是合法的 CSS 十六进制颜色', () => {
    for (const color of Object.values(DEFAULT_HIGHLIGHT_PALETTE)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

/*
 * ⚠️ **色块 tooltip 的本地化**（实测踩到的坑，用户反馈：
 * "选区的工具栏里面的中英文title还是会变来变去的
 *  有时候hover上去 title显示中文 有时候英文"）。
 *
 * -> 之前色块的 `title` 直接写**原始色值**（`#ffd54a`）❌
 * -> 界面是中文也显示 `#ffd54a`，英文还是 `#ffd54a` ❌
 */
describe('resolveHighlightColorName', () => {
  it('**内置色板 key -> 本地化名字**', () => {
    expect(resolveHighlightColorName('yellow', 'zh')).toBe('黄色');
    expect(resolveHighlightColorName('yellow', 'en')).toBe('Yellow');
    expect(resolveHighlightColorName('green', 'zh')).toBe('绿色');
  });

  it('**不返回原始色值**（那是最重要的）', () => {
    for (const locale of ['zh', 'en', 'ja', 'fr']) {
      for (const key of Object.keys(DEFAULT_HIGHLIGHT_PALETTE)) {
        const name = resolveHighlightColorName(key, locale);
        expect(name).not.toMatch(/^#/);
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });

  it('**不同语言给不同的名字**', () => {
    expect(resolveHighlightColorName('yellow', 'zh')).not.toBe(
      resolveHighlightColorName('yellow', 'en'),
    );
  });

  it('**宿主自定义的 key -> 退回 key 本身**（不猜）', () => {
    expect(resolveHighlightColorName('my-brand-color', 'zh')).toBe('my-brand-color');
  });

  it('**未知语言 -> 退回英文**', () => {
    expect(resolveHighlightColorName('yellow', 'de')).toBe('Yellow');
  });

  it('**每个内置色板 key 都有名字**', () => {
    for (const key of Object.keys(DEFAULT_HIGHLIGHT_PALETTE)) {
      expect(HIGHLIGHT_COLOR_NAMES[key]).toBeDefined();
    }
  });
});
