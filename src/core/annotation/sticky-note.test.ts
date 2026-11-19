import { describe, expect, it } from 'vitest';
import { STICKY_NOTE_OFFSET, stickyNotePosition } from './sticky-note';

describe('stickyNotePosition', () => {
  const pageSize = { width: 1408, height: 1824 };

  it('**默认放在高亮的右上角**（WPS 的做法）', () => {
    const pos = stickyNotePosition(
      { id: 'n1', highlightId: 'h1', content: '批注' },
      { left: 100, top: 200, width: 300, height: 24 },
      pageSize,
    );

    expect(pos).not.toBeNull();
    expect(pos?.left).toBe(100 + 300 + STICKY_NOTE_OFFSET.x);
    expect(pos?.top).toBe(200 + STICKY_NOTE_OFFSET.y);
  });

  it('宿主指定了位置 → 用它（归一化 → 页内 px）', () => {
    const pos = stickyNotePosition(
      { id: 'n1', highlightId: 'h1', content: '批注', position: { x: 0.5, y: 0.25 } },
      { left: 100, top: 200, width: 300, height: 24 },
      pageSize,
    );

    expect(pos?.left).toBe(0.5 * pageSize.width);
    expect(pos?.top).toBe(0.25 * pageSize.height);
  });

  it('**没有锚点 → null**（画不出来）', () => {
    const pos = stickyNotePosition(
      { id: 'n1', highlightId: 'h1', content: '批注' },
      null,
      pageSize,
    );

    expect(pos).toBeNull();
  });

  it('没有锚点**但指定了位置** → 也能画', () => {
    const pos = stickyNotePosition(
      { id: 'n1', highlightId: 'h1', content: '批注', position: { x: 0.1, y: 0.2 } },
      null,
      pageSize,
    );

    expect(pos).not.toBeNull();
    expect(pos?.left).toBeCloseTo(140.8);
  });
});
