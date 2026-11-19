import { describe, expect, it } from 'vitest';
import { buildHighlightActions, HIGHLIGHT_ACTION_KEYS } from './highlight-actions';

describe('buildHighlightActions', () => {
  const all = {
    onHighlightComment: () => undefined,
    onHighlightUpdate: () => undefined,
    onHighlightRemove: () => undefined,
    onHighlightCopy: () => undefined,
  };

  /*
   * ⚠️ **用户要求的顺序**：
   * ```
   * 添加批注 / 选择高亮颜色 / 复制 / 删除
   * ```
   */
  it('**4 个按钮，顺序是：添加批注 / 选择高亮颜色 / 复制 / 删除**', () => {
    const actions = buildHighlightActions('h1', '文字', all);

    expect(actions.map((a) => a.key)).toEqual([
      HIGHLIGHT_ACTION_KEYS.comment,
      HIGHLIGHT_ACTION_KEYS.color,
      HIGHLIGHT_ACTION_KEYS.copy,
      HIGHLIGHT_ACTION_KEYS.remove,
    ]);
  });

  it('**标签是中文**（添加批注 / 选择高亮颜色 / 复制 / 删除）', () => {
    const actions = buildHighlightActions('h1', '文字', all);

    expect(actions.map((a) => a.label)).toEqual(['添加批注', '选择高亮颜色', '复制', '删除']);
  });

  it('**没传 `onHighlightComment` → 不显示"添加批注"**', () => {
    const actions = buildHighlightActions('h1', '文字', {
      ...all,
      onHighlightComment: undefined,
    });

    expect(actions.some((a) => a.key === HIGHLIGHT_ACTION_KEYS.comment)).toBe(false);
    expect(actions).toHaveLength(3);
  });

  it('**没传 `onHighlightUpdate` → 不显示"选择高亮颜色"**', () => {
    const actions = buildHighlightActions('h1', '文字', {
      ...all,
      onHighlightUpdate: undefined,
    });

    expect(actions.some((a) => a.key === HIGHLIGHT_ACTION_KEYS.color)).toBe(false);
  });

  it('**没传 `onHighlightRemove` → 不显示"删除"**', () => {
    const actions = buildHighlightActions('h1', '文字', {
      ...all,
      onHighlightRemove: undefined,
    });

    expect(actions.some((a) => a.key === HIGHLIGHT_ACTION_KEYS.remove)).toBe(false);
  });

  it('**复制永远显示**（内置实现）', () => {
    const actions = buildHighlightActions('h1', '文字', {});

    expect(actions).toHaveLength(1);
    expect(actions[0]?.key).toBe(HIGHLIGHT_ACTION_KEYS.copy);
  });

  it('**添加批注 → 抛 `onHighlightComment(id)`**', () => {
    let called: string | null = null;
    const actions = buildHighlightActions('h123', '文字', {
      ...all,
      onHighlightComment: (id) => {
        called = id;
      },
    });

    actions[0]?.onSelect?.({
      text: '文字',
      position: null,
      event: {} as never,
    });

    expect(called).toBe('h123');
  });

  it('**删除 → 抛 `onHighlightRemove(id)`**', () => {
    let called: string | null = null;
    const actions = buildHighlightActions('h123', '文字', {
      ...all,
      onHighlightRemove: (id) => {
        called = id;
      },
    });

    const remove = actions.find((a) => a.key === HIGHLIGHT_ACTION_KEYS.remove);
    remove?.onSelect?.({ text: '文字', position: null, event: {} as never });

    expect(called).toBe('h123');
  });

  it('**复制 → 优先用宿主的 `onHighlightCopy`**', () => {
    let copied: string | null = null;
    const actions = buildHighlightActions('h1', '要复制的文字', {
      ...all,
      onHighlightCopy: (text) => {
        copied = text;
      },
    });

    const copy = actions.find((a) => a.key === HIGHLIGHT_ACTION_KEYS.copy);
    copy?.onSelect?.({
      text: '要复制的文字',
      position: null,
      event: {} as never,
    });

    expect(copied).toBe('要复制的文字');
  });
});
