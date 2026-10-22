'use client';

import { PASSWORD_MIN_LENGTH } from '@nona/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

export function ResetForm({ token }: { token: string }) {
  const { request } = useCustomer();
  const { pending, error, run } = useAction();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      await run(async () => {
        await request('POST', '/auth/reset-password', {
          token,
          newPassword: password,
          confirmPassword: confirm,
        });
        return true;
      })
    )
      setDone(true);
  };
  if (done) {
    return (
      <div className="auth-card">
        <p className="eyebrow">Hoàn tất</p>
        <h1>Đã đổi mật khẩu</h1>
        <p className="lead">
          Bạn đã được đăng xuất khỏi mọi thiết bị. Hãy đăng nhập bằng mật khẩu mới.
        </p>
        <Link className="btn btn-primary btn-block" href="/dang-nhap">
          Đăng nhập
        </Link>
      </div>
    );
  }
  return (
    <form className="auth-card account-form" onSubmit={submit}>
      <p className="eyebrow">Mật khẩu mới</p>
      <h1>Đặt lại mật khẩu</h1>
      <label className="field">
        <span>Mật khẩu mới</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={200}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <small>Tối thiểu {PASSWORD_MIN_LENGTH} ký tự.</small>
      </label>
      <label className="field">
        <span>Nhập lại mật khẩu mới</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          maxLength={200}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={confirm !== '' && confirm !== password}
        />
        {confirm !== '' && confirm !== password && (
          <small className="form-error">Mật khẩu nhập lại chưa khớp.</small>
        )}
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error} <Link href="/quen-mat-khau">Yêu cầu liên kết mới</Link>
        </p>
      )}
      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={pending || confirm !== password}
      >
        {pending ? 'Đang lưu…' : 'Đổi mật khẩu'}
      </button>
    </form>
  );
}
