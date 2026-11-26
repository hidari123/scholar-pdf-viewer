// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Messages } from '../i18n/messages';
import { SelectionPopover } from './SelectionPopover';

/**
 * 浮层的容器矩形（视口坐标）。
 */
const CONTAINER = { left: 0, top: 0, right: 1000, bottom: 800 };

/**
 * 渲染一个浮层。
 *
 * @param open 是否显示
 * @param actions 动作列表
 */
function renderPopover(
  open: boolean,
  actions: {
    key: string;
    label?: string;
    messageKey?: keyof Messages;
    onSelect?: () => void;
  }[] = [],
  locale: 'zh' | 'en' = 'zh',
) {
  return render(
    <SelectionPopover
      open={open}
      selectionRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
      containerRect={CONTAINER}
      anchorRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
      actions={actions}
      locale={locale}
    />,
  );
}

describe('SelectionPopover（审核补测）', () => {
  /*
   * ⚠️ **`messageKey` 跟着语言走**（用户反馈："选区浮层 title 中英混杂"）
   *
   * -> 宿主自定义动作 ✅ 传 `label: '翻译'` ✅ -> **永远是中文** ✅ ❌
   * -> -> 传 `messageKey`  -> **按当前语言解析**
   */
  it('**messageKey 跟着语言走**  ', () => {
    const { unmount } = renderPopover(
      true,
      [{ key: 'ask2', label: '翻译', messageKey: 'selection.actionTranslate', onSelect: () => {} }],
      'zh',
    );
    expect(screen.getByRole('button', { name: '翻译' })).toBeTruthy();
    unmount();

    renderPopover(
      true,
      [{ key: 'ask2', label: '翻译', messageKey: 'selection.actionTranslate', onSelect: () => {} }],
      'en',
    );
    expect(screen.getByRole('button', { name: 'Translate' })).toBeTruthy();
  });

  /*
   * ⚠️ **没传 messageKey -> 退回 label**
   */
  it('**没传 messageKey 就用 label**  ', () => {
    renderPopover(true, [{ key: 'x', label: '我的动作', onSelect: () => {} }]);
    expect(screen.getByRole('button', { name: '我的动作' })).toBeTruthy();
  });
  it('**关闭时不渲染**', () => {
    const { container } = renderPopover(false);
    expect(container.querySelector('.scpdf-selection-popover')).toBeNull();
  });

  it('**打开时渲染**', () => {
    /*
     * ⚠️ **必须至少有一个动作**
     * -> 没有动作 -> 组件返回 `null`  （不渲染空浮层）
     */
    const { container } = renderPopover(true, [{ key: 'a', label: 'A', onSelect: () => {} }]);
    expect(container.querySelector('.scpdf-selection-popover')).not.toBeNull();
  });

  it('**没有动作时不渲染**（不显示空浮层）', () => {
    const { container } = renderPopover(true, []);
    expect(container.querySelector('.scpdf-selection-popover')).toBeNull();
  });

  it('**有 anchorRect 时不依赖选区矩形**', () => {
    /*
     * ⚠️ **`anchorRect` 优先**
     * -> 点高亮块时**浏览器里没有选区**  -> 但浮层要出
     * -> -> 所以 `selectionRect` 为 null 也能渲染
     */
    const { container } = render(
      <SelectionPopover
        open
        selectionRect={null}
        containerRect={CONTAINER}
        anchorRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
        actions={[{ key: 'a', label: 'A', onSelect: () => {} }]}
        locale="zh"
      />,
    );
    expect(container.querySelector('.scpdf-selection-popover')).not.toBeNull();
  });

  it('**动作会渲染出来**（用 aria-label 找）', () => {
    renderPopover(true, [{ key: 'highlight', label: '高亮' }]);
    // ⚠️ **文案在 `aria-label` / `title` 上**  （不是文本节点）
    expect(screen.getByRole('button', { name: '高亮' })).toBeTruthy();
  });

  it('**点动作会调 onAction**', () => {
    /*
     * ⚠️ **组件只调 `onAction`**  （带整个 action 对象）
     * -> `action.onSelect` 是**包在 `PdfViewer` 里**调的
     *    （因为要带"当前选区的文字 / 归一化位置"）
     */
    const onAction = vi.fn();
    render(
      <SelectionPopover
        open
        selectionRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
        containerRect={CONTAINER}
        anchorRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
        actions={[{ key: 'highlight', label: '高亮' }]}
        onAction={onAction}
        locale="zh"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '高亮' }));
    expect(onAction).toHaveBeenCalled();
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({ key: 'highlight' });
  });

  it('**分组之间有分隔线**', () => {
    const { container } = renderPopover(true, [
      { key: 'a', label: 'A', onSelect: () => {} },
      { key: 'b', label: 'B', onSelect: () => {} },
    ]);
    // 没有分组 -> 不该有分隔线
    expect(container.querySelectorAll('.scpdf-selection-popover__divider').length).toBe(0);
  });

  it('**Esc 会关闭**', () => {
    const onClose = vi.fn();
    render(
      <SelectionPopover
        open
        selectionRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
        containerRect={CONTAINER}
        anchorRect={{ left: 100, top: 100, right: 200, bottom: 120 }}
        actions={[{ key: 'a', label: 'A', onSelect: () => {} }]}
        onClose={onClose}
        locale="zh"
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
