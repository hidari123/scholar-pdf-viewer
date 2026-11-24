/**
 * 工具栏的**按下态**（用户需求：
 * "点了加粗之后 加粗按钮没加深颜色 别的按钮一样 看不出点击了"）。
 */

import { describe, expect, it } from 'vitest';
import type { ToolbarStateEditor } from './toolbar-state';
import { computeToolbarActiveState } from './toolbar-state';

/** 造一个假的编辑器 */
function makeEditor(overrides: Partial<ToolbarStateEditor> = {}): ToolbarStateEditor {
  return {
    isActive: () => false,
    can: () => false,
    canUndo: () => false,
    canRedo: () => false,
    ...overrides,
  };
}

describe('computeToolbarActiveState', () => {
  it('**编辑器还没挂载 -> 全部不激活**', () => {
    const states = computeToolbarActiveState(['bold', 'italic'], null);
    expect(states).toEqual([
      { command: 'bold', active: false, disabled: false, hasSelection: true },
      { command: 'italic', active: false, disabled: false, hasSelection: true },
    ]);
  });

  it('**结果和命令列表一一对应、顺序一致**', () => {
    const commands = ['bold', 'italic', 'underline', 'createLink'];
    const states = computeToolbarActiveState(commands, makeEditor());
    expect(states.map((s) => s.command)).toEqual(commands);
  });

  it('**选区是加粗 -> 加粗按钮激活**', () => {
    const editor = makeEditor({
      isActive: (name) => name === 'bold',
      hasSelection: () => true,
    });
    const states = computeToolbarActiveState(['bold', 'italic'], editor);
    expect(states[0]?.active).toBe(true);
    expect(states[1]?.active).toBe(false);
  });

  it('**每个格式命令都有对应的检查**', () => {
    const editor = makeEditor({ isActive: () => true });
    const commands = [
      'bold',
      'italic',
      'underline',
      'strikeThrough',
      'hiliteColor',
      'foreColor',
      'createLink',
      'insertUnorderedList',
      'insertOrderedList',
      'formatBlock',
    ];
    const states = computeToolbarActiveState(commands, editor);
    // 除"清除格式"外，所有格式命令都应该能激活
    for (const s of states) {
      expect(s.active).toBe(true);
    }
  });

  /*
   * ⚠️⚠️ **没选文字 -> 只有"清除格式"置灰**（用户第 27 轮的更正）：
   *
   * > "没选字时格式按钮置灰这个你修错了 应该是没选字的时候清除格式按钮置灰
   * >  其他的还是可以用的"
   * >
   * > "其余按钮都是可以点击的"
   */
  it('**没选文字 -> 只有"清除格式"置灰**', () => {
    const editor = makeEditor({ hasSelection: () => false });
    const states = computeToolbarActiveState(
      ['removeFormat', 'bold', 'foreColor', 'hiliteColor'],
      editor,
    );
    // 只有"清除格式"置灰 ✅
    expect(states[0]?.disabled, 'removeFormat').toBe(true);
    expect(states[0]?.hasSelection, 'removeFormat').toBe(false);
    // 其余按钮**永远可用** ✅
    for (const s of states.slice(1)) {
      expect(s.disabled, s.command).toBe(false);
    }
  });

  it('**选了文字 -> 清除格式恢复可用**', () => {
    const editor = makeEditor({ hasSelection: () => true });
    const states = computeToolbarActiveState(['removeFormat', 'bold'], editor);
    for (const s of states) {
      expect(s.disabled, s.command).toBe(false);
      expect(s.hasSelection, s.command).toBe(true);
    }
  });

  it('**加粗/颜色/高亮等按钮：有没有选区都可用**', () => {
    const noSel = computeToolbarActiveState(
      ['bold', 'italic', 'underline', 'strikeThrough', 'foreColor', 'hiliteColor'],
      makeEditor({ hasSelection: () => false }),
    );
    const withSel = computeToolbarActiveState(
      ['bold', 'italic', 'underline', 'strikeThrough', 'foreColor', 'hiliteColor'],
      makeEditor({ hasSelection: () => true }),
    );
    for (const s of noSel) {
      expect(s.disabled, s.command).toBe(false);
    }
    for (const s of withSel) {
      expect(s.disabled, s.command).toBe(false);
    }
  });

  it('**撤销/重做按现有逻辑**（刚进去没有历史 -> 置灰）', () => {
    const states = computeToolbarActiveState(
      ['undo', 'redo'],
      makeEditor({ canUndo: () => false, canRedo: () => false }),
    );
    expect(states[0]?.disabled).toBe(true);
    expect(states[1]?.disabled).toBe(true);
  });

  it('**撤销/重做不受"有没有选区"影响**', () => {
    const editor = makeEditor({
      hasSelection: () => false,
      canUndo: () => true,
      canRedo: () => true,
    });
    const states = computeToolbarActiveState(['undo', 'redo'], editor);
    expect(states[0]?.disabled).toBe(false);
    expect(states[1]?.disabled).toBe(false);
  });

  it('**hasSelection 抛异常 -> 当成"有选区"**（不误伤）', () => {
    const editor = makeEditor({
      hasSelection: () => {
        throw new Error('还没准备好');
      },
    });
    const states = computeToolbarActiveState(['removeFormat'], editor);
    expect(states[0]?.disabled).toBe(false);
    expect(states[0]?.hasSelection).toBe(true);
  });

  it('**列表类命令不受"有没有选区"影响**（列表不需要选文字）', () => {
    const editor = makeEditor({ hasSelection: () => false });
    const states = computeToolbarActiveState(
      ['insertUnorderedList', 'insertOrderedList', 'createLink'],
      editor,
    );
    for (const s of states) {
      expect(s.disabled, s.command).toBe(false);
    }
  });

  it('**编辑器不提供 hasSelection -> 默认当成"有选区"**（不误伤老宿主）', () => {
    const states = computeToolbarActiveState(['removeFormat'], makeEditor());
    expect(states[0]?.disabled).toBe(false);
    expect(states[0]?.hasSelection).toBe(true);
  });

  it('**"清除格式"永远不激活**（它不是一种格式）', () => {
    const editor = makeEditor({ isActive: () => true });
    const states = computeToolbarActiveState(['removeFormat'], editor);
    expect(states[0]?.active).toBe(false);
  });

  it('**撤销：不能撤销时 disabled**', () => {
    const states = computeToolbarActiveState(['undo'], makeEditor({ canUndo: () => false }));
    expect(states[0]?.disabled).toBe(true);
    expect(states[0]?.active).toBe(false);
  });

  it('**撤销：能撤销时不禁用**', () => {
    const states = computeToolbarActiveState(['undo'], makeEditor({ canUndo: () => true }));
    expect(states[0]?.disabled).toBe(false);
  });

  it('**重做：同上**', () => {
    const states = computeToolbarActiveState(['redo'], makeEditor({ canRedo: () => true }));
    expect(states[0]?.disabled).toBe(false);
  });

  it('**编辑器抛异常时 -> 当成没激活（不炸）**', () => {
    const editor = makeEditor({
      isActive: () => {
        throw new Error('还没准备好');
      },
    });
    const states = computeToolbarActiveState(['bold'], editor);
    expect(states[0]?.active).toBe(false);
  });

  it('**can() 抛异常时 -> 当成不能撤销（不炸）**', () => {
    const editor = makeEditor({
      canUndo: () => {
        throw new Error('还没准备好');
      },
    });
    const states = computeToolbarActiveState(['undo'], editor);
    expect(states[0]?.disabled).toBe(true);
  });

  it('**没有 canUndo 时退回 can()**', () => {
    const editor: ToolbarStateEditor = {
      isActive: () => false,
      can: () => true,
    };
    const states = computeToolbarActiveState(['undo'], editor);
    expect(states[0]?.disabled).toBe(false);
  });
});
