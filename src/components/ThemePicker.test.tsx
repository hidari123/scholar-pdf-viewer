// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemePicker } from './ThemePicker';

/*
 * ⚠️⚠️ **主题的色块要能区分开**（实测踩到的坑，用户反馈：
 * "主题的下拉框里高对比色和暗色的展示的前面框的颜色是一样的
 *  极简和亮色也是一样的 需要区分开"）。
 *
 * -> 之前色块只画**一个纯背景色** ❌
 * -> 但这些主题的差别**本来就不在背景色上**（背景差 1~2%）
 *    - `light` #ffffff vs `minimal` #fafafa ❌ 肉眼分不出
 *    - `dark` #1f2933 vs `contrast` #000000 ❌ 太像
 *    - `paper` #f5f0e6 vs `sepia` #f4ecd8 ❌ 几乎一样
 *
 * -> 修法：画成**迷你预览卡**（上半 = 主色调，下半 = 背景色）
 * -> 颜色靠**CSS 变量**（不在 TS 里再抄一份）
 */
describe('ThemePicker 的色块', () => {
  it('**每个色块都带主题自己的 class**（这样才能拿到那个主题的 CSS 变量）', () => {
    render(<ThemePicker onThemeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '主题' }));

    const swatches = document.querySelectorAll('.scpdf-theme-picker__swatch');
    expect(swatches.length).toBe(7);

    const classes = [...swatches].map((s) => [...s.classList].join(' '));
    for (const theme of ['light', 'dark', 'auto', 'paper', 'sepia', 'contrast', 'minimal']) {
      expect(classes.some((c) => c.includes(`scpdf-root--${theme}`))).toBe(true);
    }
  });

  /*
   * ⚠️ **每个主题都要有名字**（用户反馈："色块分不清"）
   *
   * -> 只有 16px 的色块 ✅ -> 看不出是哪个主题 ✅ ❌
   * -> -> 名字在色块**下面**
   */
  it('每个主题的色块下面都有名字', () => {
    render(<ThemePicker onThemeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '主题' }));

    const names = [...document.querySelectorAll('.scpdf-theme-picker__swatch-name')].map(
      (n) => n.textContent?.trim() ?? '',
    );
    expect(names.length).toBe(7);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('**每个色块都有主色调条 + 背景**', () => {
    render(<ThemePicker onThemeChange={vi.fn()} />);
    screen.getByRole('button', { name: '主题' }).click();

    for (const swatch of document.querySelectorAll('.scpdf-theme-picker__swatch')) {
      expect(swatch.querySelector('.scpdf-theme-picker__swatch-bar')).not.toBeNull();
      expect(swatch.querySelector('.scpdf-theme-picker__swatch-bg')).not.toBeNull();
    }
  });

  it('**色块不再只有一个纯背景**（那样看起来都一样）', () => {
    render(<ThemePicker onThemeChange={vi.fn()} />);
    screen.getByRole('button', { name: '主题' }).click();

    for (const swatch of document.querySelectorAll<HTMLElement>('.scpdf-theme-picker__swatch')) {
      // ⚠️ 之前是 `background: <某色>` ❌ -> 现在背景在**子元素**上 ✅
      expect(swatch.style.background).toBe('');
      expect(swatch.children.length).toBe(2);
    }
  });
});
