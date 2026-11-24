// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { findStickyNoteIcon, STICKY_NOTE_ICON_CLASS } from './anchor';

/*
 * ⚠️⚠️ **锚点查找要支持"合并组"**（实测踩到的坑，用户反馈：
 * "如果同一位置两个批注 那么第一个批注点击之后展示位置正常
 *  第二个批注详情点击之后还是会出现在pdf的首页位置"）。
 *
 * -> 同一位置的多个批注**合并成一个图标** ✅
 * -> 那个图标上只有 `data-note-id={first.id}`（第一条）❌
 * -> 选**第二条** -> 精确匹配**找不到** ❌
 * -> -> 锚点**保持旧值** ❌ -> 面板停在**首页** ❌
 */

/** 造一个"合并组"的图标（带整组的 id） */
function makeGroupIcon(ids: string[]): HTMLElement {
  const el = document.createElement('button');
  el.className = STICKY_NOTE_ICON_CLASS;
  el.setAttribute('data-note-id', ids[0] ?? '');
  el.setAttribute('data-note-ids', ids.join(','));
  return el;
}

/** 造一个"普通"的图标（只有自己的 id） */
function makeSingleIcon(id: string): HTMLElement {
  const el = document.createElement('button');
  el.className = STICKY_NOTE_ICON_CLASS;
  el.setAttribute('data-note-id', id);
  return el;
}

describe('findStickyNoteIcon', () => {
  it('**没有容器 / 没有 id -> null**', () => {
    expect(findStickyNoteIcon(null, 'a')).toBeNull();
    const container = document.createElement('div');
    expect(findStickyNoteIcon(container, null)).toBeNull();
    expect(findStickyNoteIcon(container, '')).toBeNull();
  });

  it('**普通便签 -> 按 data-note-id 找到**', () => {
    const container = document.createElement('div');
    const icon = makeSingleIcon('note-1');
    container.appendChild(icon);
    expect(findStickyNoteIcon(container, 'note-1')).toBe(icon);
  });

  it('⚠️⚠️ **合并组的【第二条】也能找到**（用户报的核心 bug）', () => {
    const container = document.createElement('div');
    const icon = makeGroupIcon(['note-a', 'note-b']);
    container.appendChild(icon);

    // 第一条 ✅
    expect(findStickyNoteIcon(container, 'note-a')).toBe(icon);
    // ⚠️ **第二条**（之前找不到 ❌ -> 面板停在旧位置 -> 出现在首页 ❌）
    expect(findStickyNoteIcon(container, 'note-b')).toBe(icon);
  });

  it('**合并组里有 3 条 -> 每条都能找到**', () => {
    const container = document.createElement('div');
    const icon = makeGroupIcon(['a', 'b', 'c']);
    container.appendChild(icon);
    for (const id of ['a', 'b', 'c']) {
      expect(findStickyNoteIcon(container, id)).toBe(icon);
    }
  });

  it('**找不到的 id -> null**', () => {
    const container = document.createElement('div');
    container.appendChild(makeGroupIcon(['a', 'b']));
    expect(findStickyNoteIcon(container, 'zzz')).toBeNull();
  });

  it('**id 里有特殊字符也不会出问题**', () => {
    const container = document.createElement('div');
    const icon = makeSingleIcon('note "quoted" & <tag>');
    container.appendChild(icon);
    expect(findStickyNoteIcon(container, 'note "quoted" & <tag>')).toBe(icon);
  });

  it('**优先找合并组**（data-note-ids）', () => {
    const container = document.createElement('div');
    const group = makeGroupIcon(['a', 'b']);
    // 另有一个同 id 的普通图标（不该抢）
    const single = makeSingleIcon('b');
    container.appendChild(single);
    container.appendChild(group);
    expect(findStickyNoteIcon(container, 'b')).toBe(group);
  });
});
