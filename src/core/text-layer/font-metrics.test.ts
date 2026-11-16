// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clearFontMetricsCache,
  guessFontFamily,
  measureAscentRatio,
  measureTextWidth,
} from './font-metrics';

describe('measureAscentRatio', () => {
  it('返回 0~1 之间的比例', () => {
    const ratio = measureAscentRatio('sans-serif');

    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('同一字体重复调用结果一致（缓存）', () => {
    const first = measureAscentRatio('serif');
    const second = measureAscentRatio('serif');

    expect(second).toBe(first);
  });

  it('清缓存后重新测量仍一致', () => {
    const first = measureAscentRatio('monospace');
    clearFontMetricsCache();
    const second = measureAscentRatio('monospace');

    expect(second).toBeCloseTo(first, 5);
  });

  it('空字体族回退到默认值', () => {
    const ratio = measureAscentRatio('');

    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

describe('measureTextWidth', () => {
  it('非空文本 → 宽度 > 0', () => {
    const width = measureTextWidth('Hello World', 'sans-serif', 12);

    expect(width).toBeGreaterThan(0);
  });

  it('空串 → 宽度 0', () => {
    expect(measureTextWidth('', 'sans-serif', 12)).toBe(0);
  });

  it('字号为 0 → 宽度 0', () => {
    expect(measureTextWidth('Hello', 'sans-serif', 0)).toBe(0);
  });

  it('字号越大宽度越大', () => {
    const small = measureTextWidth('Hello', 'sans-serif', 12);
    const large = measureTextWidth('Hello', 'sans-serif', 24);

    expect(large).toBeGreaterThan(small);
  });

  it('重复调用结果一致（缓存）', () => {
    const first = measureTextWidth('Hello', 'sans-serif', 12);
    const second = measureTextWidth('Hello', 'sans-serif', 12);

    expect(second).toBe(first);
  });

  it('带引号的字体族也能测量', () => {
    const width = measureTextWidth('Hello', '"Times New Roman"', 12);

    expect(width).toBeGreaterThan(0);
  });
});

describe('guessFontFamily', () => {
  it('undefined → sans-serif', () => {
    expect(guessFontFamily(undefined)).toBe('sans-serif');
  });

  it('含 mono → monospace', () => {
    expect(guessFontFamily('g_d0_f1_monospace')).toBe('monospace');
    expect(guessFontFamily('CourierNew')).toBe('monospace');
  });

  it('含 sans → sans-serif（优先于 serif 判断）', () => {
    expect(guessFontFamily('ArialSans')).toBe('sans-serif');
  });

  it('含 serif / times → serif', () => {
    expect(guessFontFamily('TimesRoman')).toBe('serif');
    expect(guessFontFamily('g_d0_f1_serif')).toBe('serif');
  });

  it('无法判断 → sans-serif', () => {
    expect(guessFontFamily('g_d0_f1')).toBe('sans-serif');
  });
});
