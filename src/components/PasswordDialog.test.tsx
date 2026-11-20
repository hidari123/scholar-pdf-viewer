// @vitest-environment jsdom
/**
 * `components/PasswordDialog` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> **零单元测试、零 E2E** ❌
 * -> 它是**加密文档唯一的入口** -> 宿主最常接的回调之一 ❌
 * -> 里面有一条**安全要求**："关闭时清空密码（不留敏感信息在内存里）" ❌
 *   -> 没人验证它 -> 以后改坏了**密码会留在内存里** ❌
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PasswordDialog } from './PasswordDialog';

describe('PasswordDialog', () => {
  it('**open = false 时不渲染**', () => {
    render(<PasswordDialog open={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('**open = true 时渲染对话框**', () => {
    render(<PasswordDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('**空密码不提交**（宿主传的是真密码，不能是空串）', () => {
    const onSubmit = vi.fn();
    render(<PasswordDialog open onSubmit={onSubmit} onCancel={vi.fn()} />);

    const button = screen.getByRole('button', { name: /确定|确认|提交|submit|ok/i });
    fireEvent.click(button);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('**填了密码就提交**', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PasswordDialog open onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(
      document.querySelector('.scpdf-dialog__input') as HTMLInputElement,
      'secret123',
    );
    const button = screen.getByRole('button', { name: /确定|确认|提交|submit|ok/i });
    await user.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('secret123');
  });

  it('**按 Enter 也提交**', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PasswordDialog open onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = document.querySelector('.scpdf-dialog__input') as HTMLInputElement;
    await user.type(input, 'secret123{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('secret123');
  });

  it('**点取消调 onCancel**', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<PasswordDialog open onSubmit={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /取消|cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('**密码错误时显示提示**', () => {
    render(<PasswordDialog open wrongPassword onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // 错误提示要有 role="alert"（读屏软件会念出来）
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('**没传 wrongPassword 时不显示错误提示**', () => {
    render(<PasswordDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('**重新打开时清空上次的密码**（安全要求）', () => {
    const { rerender } = render(<PasswordDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const input =
      screen.getByLabelText(/密码|password/i) ??
      (document.querySelector('.scpdf-dialog__input') as HTMLInputElement as HTMLInputElement);
    fireEvent.change(input, { target: { value: 'secret' } });
    expect(input.value).toBe('secret');

    // 关闭
    rerender(<PasswordDialog open={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // 再打开
    rerender(<PasswordDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const reopened =
      screen.getByLabelText(/密码|password/i) ??
      (document.querySelector('.scpdf-dialog__input') as HTMLInputElement as HTMLInputElement);
    expect(reopened.value).toBe('');
  });

  it('**输入框是密码类型**（别在屏幕上明文显示）', () => {
    render(<PasswordDialog open onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const input =
      screen.getByLabelText(/密码|password/i) ??
      (document.querySelector('.scpdf-dialog__input') as HTMLInputElement as HTMLInputElement);
    expect(input.type).toBe('password');
  });
});
