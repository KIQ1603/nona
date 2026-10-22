'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

export function ForgotForm() {
  const { request } = useCustomer();
  const { pending, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      await run(async () => {
        await request('POST', '/auth/forgot-password', { email });
        return true;
      })
    )
      setSent(true);
  };
  if (sent) {
    return (
      <div className="auth-card">
        <p className="eyebrow">Kiểm tra email</p>
        <h1>Đã gửi hướng dẫn</h1>
        <p className="lead">
          Nếu <strong>{email}</strong> có tài khoản NONA, bạn sẽ nhận được email đặt lại mật khẩu
          trong vài phút. Liên kết có hiệu lực trong 1 giờ.
        </p>
        <p className="switch">
          <Link href="/dang-nhap">Quay lại đăng nhập</Link>
        </p>
      </div>
    );
  }
  return (
    <form className="auth-card account-form" onSubmit={submit}>
      <p className="eyebrow">Quên mật khẩu</p>
      <h1>Đặt lại mật khẩu</h1>
      <p className="lead">
        Nhập email tài khoản, chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu mới.
      </p>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi liên kết'}
      </button>
      <p className="switch">
        <Link href="/dang-nhap">Quay lại đăng nhập</Link>
      </p>
    </form>
  );
}
