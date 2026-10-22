'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@nona/contracts';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

export function AuthForm({ kind, next }: { kind: 'login' | 'register'; next: string }) {
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useCustomer();
  const { pending, error, run } = useAction();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [confirm, setConfirm] = useState('');
  const register = kind === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (register && confirm !== form.password) return;
    const me = await run(() =>
      signIn(kind, register ? form : { email: form.email, password: form.password }),
    );
    if (me) {
      toast(
        register ? `Chào mừng ${me.fullName} đến với NONA` : `Chào mừng trở lại, ${me.fullName}`,
      );
      router.replace(next);
      router.refresh();
    }
  };

  const query = next === '/tai-khoan' ? '' : `?next=${encodeURIComponent(next)}`;
  return (
    <form className="auth-card account-form" onSubmit={submit} aria-labelledby="auth-title">
      <p className="eyebrow">{register ? 'Tham gia NONA' : 'Chào mừng trở lại'}</p>
      <h1 id="auth-title">{register ? 'Tạo tài khoản' : 'Đăng nhập'}</h1>
      <p className="lead">
        {register
          ? 'Lưu giỏ hàng, địa chỉ và sản phẩm yêu thích trên mọi thiết bị.'
          : 'Giỏ hàng bạn đang chọn sẽ được giữ lại khi đăng nhập.'}
      </p>
      {register && (
        <label className="field">
          <span>Họ và tên</span>
          <input
            name="fullName"
            autoComplete="name"
            required
            maxLength={100}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
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
          autoComplete={register ? 'new-password' : 'current-password'}
          required
          minLength={register ? PASSWORD_MIN_LENGTH : 1}
          maxLength={200}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {register && <small>Tối thiểu {PASSWORD_MIN_LENGTH} ký tự.</small>}
        {!register && (
          <small>
            <Link href="/quen-mat-khau">Quên mật khẩu?</Link>
          </small>
        )}
      </label>
      {register && (
        <label className="field">
          <span>Nhập lại mật khẩu</span>
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            maxLength={200}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={confirm !== '' && confirm !== form.password}
          />
          {confirm !== '' && confirm !== form.password && (
            <small className="form-error">Mật khẩu nhập lại chưa khớp.</small>
          )}
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={pending || (register && confirm !== form.password)}
      >
        {pending ? 'Vui lòng đợi…' : register ? 'Tạo tài khoản' : 'Đăng nhập'}
      </button>
      <p className="switch">
        {register ? (
          <>
            Đã có tài khoản? <Link href={`/dang-nhap${query}`}>Đăng nhập</Link>
          </>
        ) : (
          <>
            Chưa có tài khoản? <Link href={`/dang-ky${query}`}>Đăng ký</Link>
          </>
        )}
      </p>
    </form>
  );
}
