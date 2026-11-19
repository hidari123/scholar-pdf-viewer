/**
 * i18n 的测试。
 *
 * 用户的诉求："页面要支持多种语言，先配置中英文，
 * 这个可以宿主通过固定json进行添加 要给出接口"
 */

import { describe, expect, it } from 'vitest';
import {
  buildLocaleTable,
  EN_MESSAGES,
  isLocaleSupported,
  MESSAGES,
  resolveMessage,
  ZH_MESSAGES,
} from './messages';

describe('i18n 文案', () => {
  it('**中英文内置**（开箱即用）', () => {
    expect(MESSAGES.zh).toBe(ZH_MESSAGES);
    expect(MESSAGES.en).toBe(EN_MESSAGES);
    expect(resolveMessage('zh', 'page.of', undefined, { page: 1, total: 3 })).toBe('第 1 / 3 页');
    expect(resolveMessage('en', 'page.of', undefined, { page: 1, total: 3 })).toBe('Page 1 of 3');
  });

  it('**占位符替换**', () => {
    expect(resolveMessage('zh', 'search.count', undefined, { count: 42 })).toBe('42 个结果');
    expect(resolveMessage('en', 'search.count', undefined, { count: 42 })).toBe('42 results');
    expect(resolveMessage('zh', 'load.progress', undefined, { percent: 50 })).toBe('已加载 50%');
  });

  it('**宿主能通过 JSON 添加语言**', () => {
    const locales = {
      ja: {
        'load.loading': 'ドキュメントを読み込み中…',
        'page.of': '{page} / {total} ページ',
      },
    };

    // 宿主写的 → 用宿主的
    expect(resolveMessage('ja', 'load.loading', undefined, undefined, locales)).toBe(
      'ドキュメントを読み込み中…',
    );
    expect(resolveMessage('ja', 'page.of', undefined, { page: 2, total: 5 }, locales)).toBe(
      '2 / 5 ページ',
    );
  });

  it('**宿主语言没写全 → 回退到内置**（不用写全 26 条）', () => {
    const locales = { ja: { 'load.loading': '読み込み中…' } };

    // 没写的 → 回退到内置英文
    expect(resolveMessage('ja', 'search.placeholder', undefined, undefined, locales)).toBe(
      'Search document',
    );
    expect(resolveMessage('ja', 'outline.title', undefined, undefined, locales)).toBe('Outline');
  });

  it('**回退到英文而不是中文**（避免中英混杂）', () => {
    const locales = { ja: { 'load.loading': '読み込み中…' } };
    const text = resolveMessage('ja', 'search.placeholder', undefined, undefined, locales);

    expect(text).toBe('Search document');
    expect(text).not.toMatch(/[一-龥]/);
  });

  it('**单条覆盖优先级最高**', () => {
    const locales = { ja: { 'load.loading': '読み込み中…' } };
    const overrides = { 'load.loading': '单独的覆盖' };

    expect(resolveMessage('ja', 'load.loading', overrides, undefined, locales)).toBe('单独的覆盖');
  });

  it('**完全没注册的语言 → 回退英文**（不崩）', () => {
    expect(resolveMessage('xx', 'search.placeholder')).toBe('Search document');
    expect(resolveMessage('xx', 'search.placeholder', undefined, undefined, { ja: {} })).toBe(
      'Search document',
    );
  });

  it('**buildLocaleTable 合并内置和宿主的**', () => {
    const table = buildLocaleTable({ ja: { 'load.loading': '…' } });

    expect(table.zh).toBe(ZH_MESSAGES);
    expect(table.en).toBe(EN_MESSAGES);
    expect(table.ja?.['load.loading']).toBe('…');
  });

  it('**isLocaleSupported 判断语言是否可用**', () => {
    expect(isLocaleSupported('zh')).toBe(true);
    expect(isLocaleSupported('en')).toBe(true);
    expect(isLocaleSupported('ja')).toBe(false);
    expect(isLocaleSupported('ja', { ja: {} })).toBe(true);
  });

  it('**内置中英文的 key 完全一致**（不然会漏）', () => {
    expect(Object.keys(ZH_MESSAGES).sort()).toEqual(Object.keys(EN_MESSAGES).sort());
  });
});
