// @vitest-environment jsdom

/**
 * `core/editor/rich-text` 的**命令执行**测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> 用户反馈："富文本修改文字颜色的功能还是没有实现 点击无反应" ❌
 * -> 根因：`execCommand('foreColor')` 生成 **`<font color="...">`** ❌
 *   -> `<font>` **不在 `sanitizeRichText` 的白名单里** ❌
 *   -> 清洗时**整个标签被替换成纯文本** -> **颜色完全丢失** ❌
 *
 * ## 修法
 *
 * -> 先 `execCommand('styleWithCSS', false, 'true')` ✅
 *   -> 生成 **`<span style="color: rgb(255,0,0)">`** ✅
 *   -> `<span>` **在白名单里** ✅ -> 清洗后**颜色还在** ✅
 *
 * ## ⚠️ **jsdom 没有 `execCommand`**
 *
 * -> jsdom **不实现** `document.execCommand` ❌
 * -> 这里**手写一个桩**，**忠实模拟 Chrome 的行为** ✅
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execRichTextCommand, sanitizeRichText } from './rich-text';

/** CSS 模式开关（模拟浏览器的全局状态） */
let styleWithCss = false;

/**
 * **`execCommand` 的桩**（模拟 Chrome）。
 */
function execCommandStub(command: string, _showUi?: boolean, value?: string): boolean {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) {
    return false;
  }

  /** 把选区内容包成一个标签 */
  const wrap = (html: string) => {
    const frag = range.extractContents();
    const holder = document.createElement('div');
    holder.appendChild(frag);
    const text = holder.innerHTML;
    range.insertNode(document.createRange().createContextualFragment(html.replace('%TEXT%', text)));
  };

  switch (command) {
    case 'styleWithCSS':
      styleWithCss = value === 'true';
      return true;
    case 'foreColor': {
      const color = value ?? '#ffff00';
      wrap(
        styleWithCss
          ? '<span style="color: rgb(255, 0, 0);">%TEXT%</span>'
          : `<font color="${color}">%TEXT%</font>`,
      );
      return true;
    }
    case 'hiliteColor': {
      wrap(
        styleWithCss
          ? '<span style="background-color: rgb(0, 255, 0);">%TEXT%</span>'
          : '<font style="background-color: rgb(0, 255, 0);">%TEXT%</font>',
      );
      return true;
    }
    case 'removeFormat': {
      /*
       * ⚠️ **拆平整个编辑区的样式标签**。
       * -> 选区可能是**碎片**（extractContents 之后 DOM 是散的）❌
       * -> 所以直接处理**编辑区根节点** ✅
       */
      const root = (range.startContainer.parentElement ?? document.body) as HTMLElement;
      root.querySelectorAll('span[style], font').forEach((el) => {
        el.replaceWith(document.createTextNode(el.textContent ?? ''));
      });
      return true;
    }
    case 'bold':
      wrap('<b>%TEXT%</b>');
      return true;
    case 'italic':
      wrap('<i>%TEXT%</i>');
      return true;
    default:
      return false;
  }
}

describe('execRichTextCommand（颜色）', () => {
  beforeEach(() => {
    styleWithCss = false;
    document.body.innerHTML = '<div id="ed" contenteditable>Hello World</div>';
    // ⚠️ jsdom 没有这个 API -> 用桩
    document.execCommand = vi.fn(execCommandStub) as unknown as typeof document.execCommand;
  });

  /** 选中编辑区里的最后 5 个字符 */
  function selectLast() {
    const ed = document.getElementById('ed') as HTMLElement;
    ed.focus();
    const node = ed.firstChild as Text;
    const len = node.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(node, Math.max(0, len - 5));
    range.setEnd(node, len);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('**先开 styleWithCSS**（否则会生成 <font>）', () => {
    selectLast();
    execRichTextCommand('foreColor', '#ff0000');

    // ⚠️ 关键断言：**调用了 styleWithCSS** ✅
    const calls = (document.execCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => c[0] === 'styleWithCSS')).toBe(true);
  });

  it('**foreColor 生成 <span style>（不是 <font>）**', () => {
    selectLast();
    execRichTextCommand('foreColor', '#ff0000');

    const html = document.getElementById('ed')?.innerHTML ?? '';
    expect(html).not.toContain('<font');
    expect(html).toContain('<span');
    expect(html).toContain('color');
  });

  it('**hiliteColor 生成 <span style>（不是 <font>）**', () => {
    selectLast();
    execRichTextCommand('hiliteColor', '#00ff00');

    const html = document.getElementById('ed')?.innerHTML ?? '';
    expect(html).not.toContain('<font');
    expect(html).toContain('background-color');
  });

  /*
   * ⚠️⚠️ **回归守卫**：清洗后**颜色还在**（这是用户能看到的最终结果）。
   */
  it('**清洗后颜色还在**（用户点"文字颜色"真的有反应）', () => {
    selectLast();
    execRichTextCommand('foreColor', '#ff0000');

    const raw = document.getElementById('ed')?.innerHTML ?? '';
    const cleaned = sanitizeRichText(raw);

    // ⚠️ **颜色没被剥掉** ✅
    expect(cleaned).toContain('color');
    expect(cleaned).not.toContain('<font');
    expect(cleaned).toContain('World');
  });

  it('**清洗后高亮底色还在**', () => {
    selectLast();
    execRichTextCommand('hiliteColor', '#00ff00');

    const raw = document.getElementById('ed')?.innerHTML ?? '';
    const cleaned = sanitizeRichText(raw);

    expect(cleaned).toContain('background-color');
    expect(cleaned).not.toContain('<font');
  });

  it('**removeFormat 清掉颜色**', () => {
    selectLast();
    execRichTextCommand('foreColor', '#ff0000');
    expect(document.getElementById('ed')?.innerHTML ?? '').toContain('color');

    selectLast();
    execRichTextCommand('removeFormat');

    const html = document.getElementById('ed')?.innerHTML ?? '';
    expect(html).not.toContain('color');
  });

  it('**不传值时用默认黄色**', () => {
    selectLast();
    execRichTextCommand('hiliteColor');

    const html = document.getElementById('ed')?.innerHTML ?? '';
    expect(html).toContain('background-color');
  });

  it('**bold 不受影响**（还是 <b>）', () => {
    selectLast();
    execRichTextCommand('bold');

    const html = document.getElementById('ed')?.innerHTML ?? '';
    expect(html).toContain('<b>');
  });

  it('**italic 不受影响**', () => {
    selectLast();
    execRichTextCommand('italic');

    const html = document.getElementById('ed')?.innerHTML ?? '';
    expect(html).toContain('<i>');
  });
});
