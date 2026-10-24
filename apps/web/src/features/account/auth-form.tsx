'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';
import { GoogleButton } from './google-button';

/** Sign in with email or mobile number + password (or Google). Sign-up is `RegisterForm`. */
export function AuthForm({
  next,
  google = true,
  notice,
}: {
  next: string;
  /** Show "continue with Google" (the API has it configured). */
  google?: boolean;
  /** A message to show first, e.g. why a Google sign-in was refused. */
  notice?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useCustomer();
  const { pending, error, run } = useAction();
  const [form, setForm] = useState({ email: '', password: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const me = await run(() => signIn('login', form));
    if (me) {
      toast(`Chào mừng trở lại, ${me.fullName}`);
      router.replace(next);
      router.refresh();
    }
  };

  const query = next === '/tai-khoan' ? '' : `?next=${encodeURIComponent(next)}`;
  return (
    <form className="auth-card account-form" onSubmit={submit} aria-labelledby="auth-title">
      <p className="eyebrow">Chào mừng trở lại</p>
      <h1 id="auth-title">Đăng nhập</h1>
      <p className="lead">Giỏ hàng bạn đang chọn sẽ được giữ lại khi đăng nhập.</p>
      {notice && (
        <p className="form-error" role="alert">
          {notice}
        </p>
      )}
      <label className="field">
        <span>Email hoặc số điện thoại</span>
        <input
          name="email"
          type="text"
          inputMode="email"
          autoComplete="username"
          required
          maxLength={254}
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Mật khẩu</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <small>
          <Link href="/quen-mat-khau">Quên mật khẩu?</Link>
        </small>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
        {pending ? 'Vui lòng đợi…' : 'Đăng nhập'}
      </button>
      {google && <GoogleButton next={next} />}
      <p className="switch">
        Chưa có tài khoản? <Link href={`/dang-ky${query}`}>Đăng ký</Link>
      </p>
    </form>
  );
}
