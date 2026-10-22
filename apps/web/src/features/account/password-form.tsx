'use client';

import { PASSWORD_MIN_LENGTH } from '@nona/contracts';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

export function PasswordForm() {
  const { request } = useCustomer();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      await request('POST', '/me/password', f);
      return true;
    });
    if (ok) {
      setF({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
    }
  };
  return (
    <form className="panel account-form" onSubmit={submit}>
      <h2>Đổi mật khẩu</h2>
      <label className="field">
        <span>Mật khẩu hiện tại</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={f.currentPassword}
          onChange={(e) => setF({ ...f, currentPassword: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Mật khẩu mới</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          value={f.newPassword}
          onChange={(e) => setF({ ...f, newPassword: e.target.value })}
        />
        <small>
          Tối thiểu {PASSWORD_MIN_LENGTH} ký tự. Đổi mật khẩu sẽ đăng xuất các thiết bị khác.
        </small>
      </label>
      <label className="field">
        <span>Nhập lại mật khẩu mới</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={f.confirmPassword}
          onChange={(e) => setF({ ...f, confirmPassword: e.target.value })}
          aria-invalid={f.confirmPassword !== '' && f.confirmPassword !== f.newPassword}
        />
        {f.confirmPassword !== '' && f.confirmPassword !== f.newPassword && (
          <small className="form-error">Mật khẩu nhập lại chưa khớp.</small>
        )}
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn btn-dark"
        type="submit"
        disabled={pending || f.confirmPassword !== f.newPassword}
      >
        Đổi mật khẩu
      </button>
    </form>
  );
}
