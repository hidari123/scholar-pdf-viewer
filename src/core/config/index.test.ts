/**
 * 统一配置的测试。
 *
 * 用户需求：
 * > "需要万物可配置 比如说图标、高亮颜色等很多功能都要能支持宿主自主配置。"
 */

import { describe, expect, it } from 'vitest';
import { mergeConfig, resolveConfigValue } from './index';

describe('resolveConfigValue（优先级）', () => {
  it('**单独的 prop 优先**（已有代码行为不变）', () => {
    expect(resolveConfigValue('dark', 'paper')).toBe('dark');
  });

  it('**单独的 prop 是 undefined → 用 config 的**', () => {
    expect(resolveConfigValue(undefined, 'paper')).toBe('paper');
  });

  it('**两个都没有 → undefined**（走默认值）', () => {
    expect(resolveConfigValue(undefined, undefined)).toBeUndefined();
  });

  it('**单独 prop 是 falsy 值也算"有值"**（不能被 config 覆盖）', () => {
    // ⚠️ 主题传 'light'（falsy？不是，但要保证逻辑一致）
    // → 用 0 / '' / false 测
    expect(resolveConfigValue(false, true)).toBe(false);
    expect(resolveConfigValue(0, 100)).toBe(0);
    expect(resolveConfigValue('', 'x')).toBe('');
  });
});

describe('mergeConfig（统一配置）', () => {
  it('**config 里的值生效**', () => {
    const merged = mergeConfig({ theme: 'paper', highlightPalette: { yellow: '#ffd54a' } }, {});

    expect(merged.theme).toBe('paper');
    expect(merged.highlightPalette).toEqual({ yellow: '#ffd54a' });
  });

  it('**单独 prop 覆盖 config**', () => {
    const merged = mergeConfig({ theme: 'paper' }, { theme: 'dark' });
    expect(merged.theme).toBe('dark');
  });

  it('**config 为 undefined → 全用单独 prop**（向后兼容）', () => {
    const merged = mergeConfig(undefined, { theme: 'sepia', locale: 'en' });

    expect(merged.theme).toBe('sepia');
    expect(merged.locale).toBe('en');
  });

  it('**两种都没给 → 用包的内置默认**', () => {
    const merged = mergeConfig(undefined, {});
    expect(merged.theme).toBeUndefined();
    /*
     * ⚠️ **语言不再默认 'zh'** → 按**浏览器语言**推断。
     * → 用户需求："语言和高亮色都是包需要内置的" ✅
     * → 英文环境 → 'en'；中文环境 → 'zh' ✅
     */
    expect(['zh', 'en']).toContain(merged.locale);
    // ⚠️ **高亮色板必须有内置默认**（宿主不传也能用）
    expect(merged.highlightPalette).toBeDefined();
    expect(Object.keys(merged.highlightPalette ?? {}).length).toBeGreaterThan(0);
  });

  it('**图标 / 色板 / 语言 / 动作 都能配**', () => {
    const icon = { type: 'svg' } as never;
    const merged = mergeConfig(
      {
        icons: { upload: icon },
        highlightPalette: { red: '#f00' },
        locale: 'ja',
        locales: { ja: { 'page.of': '{page} ページ' } },
        selectionActions: [{ key: 'x' }],
        annotationToolbar: [{ command: 'bold', label: 'B' }],
        toolbar: { showSearch: false },
        features: { keyboard: false },
      },
      {},
    );

    expect(merged.icons?.upload).toBe(icon);
    expect(merged.highlightPalette).toEqual({ red: '#f00' });
    expect(merged.locale).toBe('ja');
    expect(merged.locales?.ja).toBeTruthy();
    expect(merged.selectionActions).toHaveLength(1);
    expect(merged.annotationToolbar).toHaveLength(1);
    expect(merged.toolbar?.showSearch).toBe(false);
    expect(merged.features?.keyboard).toBe(false);
  });

  /*
   * ⚠️ **打印纸张 / 边距**（审计发现的：之前**写死 A4**）。
   */

  it('**config 里能配打印纸张**', () => {
    const merged = mergeConfig({ printPaper: 'Letter' }, {});
    expect(merged.printPaper).toBe('Letter');
  });

  it('**单独 prop 覆盖 config 的打印纸张**', () => {
    const merged = mergeConfig({ printPaper: 'Letter' }, { printPaper: 'Legal' });
    expect(merged.printPaper).toBe('Legal');
  });

  it('**config 里能配打印边距**', () => {
    const merged = mergeConfig({ printMargin: { top: 20 } }, {});
    expect(merged.printMargin).toEqual({ top: 20 });
  });

  it('**不配 -> undefined**（用 usePrint 的默认边距）', () => {
    const merged = mergeConfig(undefined, {});
    expect(merged.printPaper).toBeUndefined();
    expect(merged.printMargin).toBeUndefined();
  });
});

/*
 * ⚠️ **默认高亮色**（用户需求："如果没有选择颜色
 * 也按照默认颜色来展示高亮 不必每次都选择颜色"✅）。
 */
describe('默认高亮色', () => {
  it('**不传时用色板的第一个颜色**', () => {
    const merged = mergeConfig({}, {});
    const paletteKeys = Object.keys(merged.highlightPalette ?? {});
    expect(merged.defaultHighlightColor).toBe(paletteKeys[0]);
  });

  it('**宿主可以指定默认色**', () => {
    const merged = mergeConfig({}, { defaultHighlightColor: 'green' });
    expect(merged.defaultHighlightColor).toBe('green');
  });

  it('**prop 优先于 config**', () => {
    const merged = mergeConfig({ defaultHighlightColor: 'red' }, { defaultHighlightColor: 'blue' });
    expect(merged.defaultHighlightColor).toBe('blue');
  });

  it('**色板换了，默认色跟着换**（没指定时）', () => {
    const merged = mergeConfig({}, { highlightPalette: { my: '#123456' } });
    expect(merged.defaultHighlightColor).toBe('my');
  });
});

/*
 * ⚠️ **`features.themePicker` 必须能被宿主用**（审核发现的真 bug）。
 *
 * -> 代码里一直在读 `features?.themePicker` ✅
 * -> 但 `Features` 接口**没声明它** ❌
 * -> -> 宿主写 `features={{ themePicker: false }}` **TS 报错** ❌
 * -> -> "不显示主题按钮"这个能力**用不了** ❌
 */
describe('features.themePicker', () => {
  it('**类型上存在**（宿主能传）', () => {
    const merged = mergeConfig({}, { features: { themePicker: false } });
    expect(merged.features?.themePicker).toBe(false);
  });

  it('**默认不传 -> undefined（= 显示）**', () => {
    const merged = mergeConfig({}, {});
    expect(merged.features?.themePicker).toBeUndefined();
  });

  it('**单独 prop 优先于 config**', () => {
    // ⚠️ **签名是 (config, props)** ✅ -> 单独 prop 优先 ✅
    const merged = mergeConfig(
      { features: { themePicker: false } },
      { features: { themePicker: true } },
    );
    expect(merged.features?.themePicker).toBe(true);
  });
});
