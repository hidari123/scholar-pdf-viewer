import { describe, expect, it } from 'vitest';
import { THEME_LABELS, THEMES, themeClasses } from './index';

describe('themeClasses', () => {
  it('主题 → class 名', () => {
    expect(themeClasses('paper')).toEqual(['scpdf-root--paper']);
    expect(themeClasses('dark')).toEqual(['scpdf-root--dark']);
    expect(themeClasses('auto')).toEqual(['scpdf-root--auto']);
  });

  it('没传主题 → 空数组', () => {
    expect(themeClasses(undefined)).toEqual([]);
  });

  it('密度 → class 名', () => {
    expect(themeClasses('light', { density: 'compact' })).toContain('scpdf-root--density-compact');
  });

  it('外壳 → class 名', () => {
    expect(themeClasses('light', { chrome: 'hidden' })).toContain('scpdf-root--chrome-hidden');
    expect(themeClasses('light', { chrome: 'minimal' })).toContain('scpdf-root--chrome-minimal');
  });

  it('关掉页阴影 → class 名', () => {
    expect(themeClasses('light', { pageShadow: false })).toContain('scpdf-root--no-page-shadow');
  });

  it('页圆角为 0 → class 名', () => {
    expect(themeClasses('light', { pageRadius: 0 })).toContain('scpdf-root--page-radius-0');
  });

  it('主题 + 外观可以叠加', () => {
    const classes = themeClasses('sepia', {
      density: 'compact',
      chrome: 'minimal',
      pageShadow: false,
      pageRadius: 0,
    });

    expect(classes).toHaveLength(5);
    expect(classes).toContain('scpdf-root--sepia');
    expect(classes).toContain('scpdf-root--density-compact');
    expect(classes).toContain('scpdf-root--chrome-minimal');
    expect(classes).toContain('scpdf-root--no-page-shadow');
    expect(classes).toContain('scpdf-root--page-radius-0');
  });

  it('`pageShadow: true` 不产生 class（主题自己决定）', () => {
    expect(themeClasses('light', { pageShadow: true })).not.toContain('scpdf-root--no-page-shadow');
  });

  it('`pageRadius` 非 0 不产生 class（用 CSS 变量更灵活）', () => {
    expect(themeClasses('light', { pageRadius: 8 })).not.toContain('scpdf-root--page-radius-0');
  });
});

describe('THEMES', () => {
  it('有 7 套主题（用户确认的清单）', () => {
    expect(THEMES).toHaveLength(7);
  });

  it('包含用户要求的全部主题', () => {
    expect(THEMES).toContain('light');
    expect(THEMES).toContain('dark');
    expect(THEMES).toContain('auto');
    expect(THEMES).toContain('paper');
    expect(THEMES).toContain('sepia');
    expect(THEMES).toContain('contrast');
    expect(THEMES).toContain('minimal');
  });

  it('每套主题都有中文名', () => {
    for (const theme of THEMES) {
      expect(THEME_LABELS[theme]).toBeTruthy();
    }
  });
});
