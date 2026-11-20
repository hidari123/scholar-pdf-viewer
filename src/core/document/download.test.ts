// @vitest-environment jsdom
/**
 * `core/document/download` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> `downloadFile` 是**包的根导出**（`src/index.ts`）但**零测试**
 * -> 之前 \`anchor.click()\` 抛错 -> **\`revokeObjectURL\` 永远不会被调** ❌
 *    -> Blob **永久占着内存**（大文件几十 MB）❌
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download';

describe('downloadFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock');
    revokeObjectURL = vi.fn();
    // @ts-expect-error 测试桩
    URL.createObjectURL = createObjectURL;
    // @ts-expect-error 测试桩
    URL.revokeObjectURL = revokeObjectURL;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('创建 Blob URL 并触发下载', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadFile('hello', 'a.txt', 'text/plain');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('**anchor 用完就从 DOM 里移除**', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const before = document.body.childElementCount;
    downloadFile('hello', 'a.txt');
    expect(document.body.childElementCount).toBe(before);
  });

  it('**1 秒后才 revoke**（立刻 revoke 会让下载失败）', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadFile('hello', 'a.txt');

    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('**点击抛错 -> 也会 revoke**（审计发现的内存泄漏）', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });

    expect(() => downloadFile('hello', 'a.txt')).toThrow('click failed');
    // ⚠️ 关键断言：**不会泄漏**
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('**点击抛错 -> anchor 也不会留在 DOM 里**', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });

    const before = document.body.childElementCount;
    expect(() => downloadFile('hello', 'a.txt')).toThrow();
    expect(document.body.childElementCount).toBe(before);
  });

  it('**mimeType 传给 Blob**', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let captured: Blob | undefined;
    // @ts-expect-error 测试桩
    URL.createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:mock';
    });

    downloadFile('x', 'a.bin', 'application/pdf');

    expect(captured?.type).toBe('application/pdf');
  });

  it('**已经是 Blob 就直接用**（不重新包装）', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const original = new Blob(['x'], { type: 'text/plain' });

    downloadFile(original, 'a.txt');

    // Blob 构造函数只被调用一次（就是原本那个）
    // @ts-expect-error 读私有字段
    expect(createObjectURL.mock.calls.length).toBe(1);
  });

  it('**文件名带中文也不报错**', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(() => downloadFile('x', '中文名.txt')).not.toThrow();
  });

  it('**Uint8Array 也能下载**', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(() => downloadFile(new Uint8Array([1, 2, 3]), 'a.bin')).not.toThrow();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
