/**
 * `core/theme/direction` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> 之前**完全没有 RTL 支持** ❌
 *   -> 阿拉伯语 / 希伯来语的宿主**没法用** ❌
 *   -> 界面还是从左往右 ❌
 *   -> **上一页 / 下一页的箭头方向也是反的** ❌
 *
 * -> 这是**纯函数**（零 DOM）-> 可以直接测
 */

import { describe, expect, it } from 'vitest';
import { isRtlLocale, resolveDirection } from './direction';

describe('isRtlLocale', () => {
  it('**阿拉伯语系 -> true**', () => {
    for (const locale of ['ar', 'ar-EG', 'ar-SA', 'AR', 'fa', 'fa-IR', 'ur', 'ur-PK']) {
      expect(isRtlLocale(locale)).toBe(true);
    }
  });

  it('**希伯来语 -> true**', () => {
    expect(isRtlLocale('he')).toBe(true);
    expect(isRtlLocale('he-IL')).toBe(true);
  });

  it('**内置语言里没有 RTL 的 -> false**', () => {
    for (const locale of ['zh', 'zh-CN', 'en', 'en-US', 'ja', 'fr', 'de', 'es']) {
      expect(isRtlLocale(locale)).toBe(false);
    }
  });

  it('**默认是 LTR 的语言不误判**（az / pa 容易搞错）', () => {
    // ⚠️ 阿塞拜疆语 / 旁遮普语 **默认是 LTR** ❌ -> 不能列进 RTL 名单
    expect(isRtlLocale('az')).toBe(false);
    expect(isRtlLocale('pa')).toBe(false);
  });

  it('**空 / undefined -> false**', () => {
    expect(isRtlLocale('')).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });

  it('**大小写和分隔符都不影响**', () => {
    expect(isRtlLocale('AR')).toBe(isRtlLocale('ar'));
    expect(isRtlLocale('ar_EG')).toBe(isRtlLocale('ar-EG'));
  });
});

describe('resolveDirection', () => {
  it('**宿主显式传 -> 最高优先级**', () => {
    // locale 是阿拉伯语，但宿主显式说 ltr -> 用 ltr
    expect(resolveDirection('ltr', 'ar')).toBe('ltr');
    // locale 是英文，但宿主显式说 rtl -> 用 rtl
    expect(resolveDirection('rtl', 'en')).toBe('rtl');
  });

  it('**没传 -> 看 locale**', () => {
    expect(resolveDirection(undefined, 'ar')).toBe('rtl');
    expect(resolveDirection(undefined, 'zh-CN')).toBe('ltr');
  });

  it('**没有 locale 时 -> 看宿主页面的 dir**', () => {
    expect(resolveDirection(undefined, undefined, 'rtl')).toBe('rtl');
    expect(resolveDirection(undefined, undefined, 'ltr')).toBe('ltr');
  });

  it('**locale 是 LTR 语言时 -> 页面 dir 不影响**（跟着语言走）', () => {
    /*
     * ⚠️ **这里很容易想反**（实测踩到的）：
     * -> 宿主页面 \`dir="rtl"\`（阿拉伯语站点），组件 \`locale="en"\` ❌
     *   -> 如果按页面的 \`dir\` 走 -> **英文按钮全反了** ❌
     *   -> 组件的语言**是显式选的** -> 应该**跟着语言走**
     */
    expect(resolveDirection(undefined, 'en', 'rtl')).toBe('ltr');
    expect(resolveDirection(undefined, 'zh-CN', 'rtl')).toBe('ltr');
  });

  it('**都没有 -> ltr**', () => {
    expect(resolveDirection(undefined, undefined)).toBe('ltr');
    expect(resolveDirection(undefined, undefined, undefined)).toBe('ltr');
  });

  it('**locale 的优先级高于页面的 dir**', () => {
    /*
     * ⚠️ 这里有个容易想反的点：
     *
     * -> 宿主页面 \`dir="rtl"\`（比如阿拉伯语站点），但组件的 \`locale\` 是**英文** ❌
     *   -> 组件界面应该**保持 LTR**（英文界面从左往右）
     *   -> 否则英文按钮全反了 ❌
     * -> 反过来：locale 是阿拉伯语，页面 \`dir="ltr"\` -> 组件应该 **rtl**
     */
    expect(resolveDirection(undefined, 'en', 'rtl')).toBe('ltr');
    expect(resolveDirection(undefined, 'ar', 'ltr')).toBe('rtl');
  });

  it('**显式传永远赢**（哪怕其它两个都说相反）', () => {
    expect(resolveDirection('ltr', 'ar', 'rtl')).toBe('ltr');
    expect(resolveDirection('rtl', 'en', 'ltr')).toBe('rtl');
  });
});
