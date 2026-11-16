import { describe, expect, it } from 'vitest';
import type { SelectionAction } from './actions';
import { isBuiltinIcon, mergeSelectionActions } from './actions';

describe('mergeSelectionActions', () => {
  const builtin: SelectionAction[] = [
    { key: 'highlight', icon: 'highlight', order: 10 },
    { key: 'copy', icon: 'copy', order: 20 },
    { key: 'translate', icon: 'translate', order: 30 },
  ];

  it('宿主没传时返回内置动作', () => {
    expect(mergeSelectionActions(builtin, undefined)).toHaveLength(3);
    expect(mergeSelectionActions(builtin, [])).toHaveLength(3);
  });

  it('宿主动作**覆盖**同 key 的内置动作', () => {
    const custom: SelectionAction[] = [{ key: 'translate', icon: 'ask', label: '我的翻译' }];

    const result = mergeSelectionActions(builtin, custom);

    const translate = result.find((a) => a.key === 'translate');
    expect(translate?.label).toBe('我的翻译');
    expect(result).toHaveLength(3);
  });

  it('宿主可以**追加**新动作', () => {
    const custom: SelectionAction[] = [{ key: 'summary', icon: 'explain', order: 5 }];

    const result = mergeSelectionActions(builtin, custom);

    expect(result).toHaveLength(4);
    expect(result[0]?.key).toBe('summary');
  });

  it('按 order 排序（未指定的排后面）', () => {
    const custom: SelectionAction[] = [
      { key: 'a', order: 5 },
      { key: 'b', order: 200 },
    ];

    const result = mergeSelectionActions(builtin, custom);

    expect(result.map((a) => a.key)).toEqual(['a', 'highlight', 'copy', 'translate', 'b']);
  });

  it('不修改入参', () => {
    const custom: SelectionAction[] = [{ key: 'copy' }];
    const builtinSnapshot = JSON.stringify(builtin);

    mergeSelectionActions(builtin, custom);

    expect(JSON.stringify(builtin)).toBe(builtinSnapshot);
    expect(custom).toHaveLength(1);
  });
});

describe('isBuiltinIcon', () => {
  it('内置图标名返回 true', () => {
    for (const name of ['highlight', 'copy', 'translate', 'note', 'ask', 'explain', 'delete']) {
      expect(isBuiltinIcon(name)).toBe(true);
    }
  });

  it('未知图标名返回 false', () => {
    expect(isBuiltinIcon('unknown')).toBe(false);
    expect(isBuiltinIcon('')).toBe(false);
  });
});
