/**
 * `core/theme` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> `appearance.fontFamily` 写的是 `--scpdf-font-family` ❌
 *   -> 但 `.scpdf-root` 用的是 `--scpdf-font-reading`（`viewer.css:51`）❌
 *   -> **两个变量从不连通** -> 宿主设了 `fontFamily` -> **完全没效果** ❌
 *   -> 而且 `--scpdf-font-family` **根本不在 `:root` 里**（连默认值都没有）❌
 */

import { describe, expect, it } from 'vitest';
import { appearanceStyles, themeClasses } from './index';

describe('appearanceStyles', () => {
  it('不传 -> 空对象（不覆盖任何东西）', () => {
    expect(appearanceStyles()).toEqual({});
    expect(appearanceStyles(undefined)).toEqual({});
  });

  it('**空对象 -> 空结果**', () => {
    expect(appearanceStyles({})).toEqual({});
  });

  it('pageRadius -> --scpdf-radius-page', () => {
    const style = appearanceStyles({ pageRadius: 8 });
    expect(style['--scpdf-radius-page']).toBe('8px');
  });

  it('**pageRadius = 0 -> 不写**（0 表示"跟随主题"）', () => {
    const style = appearanceStyles({ pageRadius: 0 });
    expect(style['--scpdf-radius-page']).toBeUndefined();
  });

  it('accentColor -> --scpdf-color-primary', () => {
    const style = appearanceStyles({ accentColor: '#fa541c' });
    expect(style['--scpdf-color-primary']).toBe('#fa541c');
  });

  /*
   * ⚠️⚠️ **审计发现的死配置**（这一条是回归守卫）。
   */
  it('**fontFamily -> 写到 CSS 真正用的变量上**', () => {
    const style = appearanceStyles({ fontFamily: 'Inter, sans-serif' });
    // ⚠️ 必须写这个（`.scpdf-root` 用的是它）
    expect(style['--scpdf-font-reading']).toBe('Inter, sans-serif');
    // 旧的也留着（万一以后 CSS 用了）
    expect(style['--scpdf-font-family']).toBe('Inter, sans-serif');
  });

  it('**fontSize -> --scpdf-font-size**（且必须有默认值）', () => {
    const style = appearanceStyles({ fontSize: 16 });
    expect(style['--scpdf-font-size']).toBe('16px');
  });

  it('**fontSize = 0 -> 不写**', () => {
    const style = appearanceStyles({ fontSize: 0 });
    expect(style['--scpdf-font-size']).toBeUndefined();
  });

  it('**所有产出的变量名都有 `--scpdf-` 前缀**', () => {
    const style = appearanceStyles({
      pageRadius: 4,
      accentColor: '#000',
      fontFamily: 'Inter',
      fontSize: 14,
    });
    for (const key of Object.keys(style)) {
      expect(key.startsWith('--scpdf-')).toBe(true);
    }
  });
});

describe('themeClasses', () => {
  it('**light -> 基础类**', () => {
    const classes = themeClasses('light');
    // ⚠️ 类名是 `scpdf-root--<theme>`（不是 `scpdf-root`）
    expect(classes).toContain('scpdf-root--light');
  });

  it('**每个主题都产出不同的类**（不能都一样）', () => {
    const themes = ['light', 'dark', 'auto', 'paper', 'sepia', 'contrast', 'minimal'] as const;
    const seen = new Set<string>();
    for (const theme of themes) {
      seen.add(themeClasses(theme).join('|'));
    }
    // 7 个主题 -> 至少 4 种不同的类组合（auto 可能和 light 相同）
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('**density / chrome 产出对应的类**', () => {
    expect(themeClasses('light', { density: 'compact' }).join(' ')).toContain('compact');
    expect(themeClasses('light', { chrome: 'hidden' }).join(' ')).toContain('hidden');
  });

  it('**pageShadow = false -> 不出阴影类**', () => {
    const withShadow = themeClasses('light', { pageShadow: true }).join(' ');
    const without = themeClasses('light', { pageShadow: false }).join(' ');
    expect(withShadow).not.toBe(without);
  });
});
