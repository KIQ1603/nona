'use client';

import {
  challengeSentSchema,
  classifyIdentifier,
  OTP_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@nona/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/features/account/use-action';
import { usePhoneProof } from '@/features/account/use-phone-proof';
import { useCustomer } from '@/lib/customer-client';

/**
 * Forgot password. One field for email or mobile number: an email gets a reset link, a mobile number gets
 * an SMS code that is entered here together with the new password (typed twice).
 */
export function ForgotForm() {
  const { request } = useCustomer();
  const proof = usePhoneProof();
  const ask = useAction();
  const finish = useAction();
  const [identifier, setIdentifier] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [phone, setPhone] = useState<{
    token: string;
    destination: string;
    devCode?: string;
    firebase?: boolean;
  } | null>(null);
  const [f, setF] = useState({ code: '', password: '', confirm: '' });
  const [done, setDone] = useState(false);

  const id = classifyIdentifier(identifier);
  const typed = identifier.trim() !== '';
  const mismatch = f.confirm !== '' && f.confirm !== f.password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (id.kind === 'INVALID') return;
    await ask.run(async () => {
      const res = await request<Record<string, unknown>>('POST', '/auth/forgot-password', {
        identifier,
      });
      if (id.kind === 'PHONE') {
        const s = challengeSentSchema.parse(res);
        // Firebase texts the number from this browser (it does so whether or not an account exists)
        if (s.provider === 'firebase') await proof.send(id.value);
        setPhone({
          token: s.token,
          destination: s.destination,
          devCode: s.devCode,
          firebase: s.provider === 'firebase',
        });
      } else setEmailSent(true);
    });
  };

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (!phone || mismatch) return;
    const ok = await finish.run(async () => {
      await request('POST', '/auth/reset-password/phone', {
        token: phone.token,
        ...(phone.firebase ? { idToken: await proof.confirm(f.code) } : { code: f.code }),
        newPassword: f.password,
        confirmPassword: f.confirm,
      });
      return true;
    });
    if (ok) setDone(true);
  };

  if (done)
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

  if (emailSent)
    return (
      <div className="auth-card">
        <p className="eyebrow">Kiểm tra email</p>
        <h1>Đã gửi hướng dẫn</h1>
        <p className="lead">
          Nếu <strong>{identifier}</strong> có tài khoản NONA, bạn sẽ nhận được email đặt lại mật
          khẩu trong vài phút. Liên kết có hiệu lực trong 1 giờ.
        </p>
        <p className="switch">
          <Link href="/dang-nhap">Quay lại đăng nhập</Link>
        </p>
      </div>
    );

  if (phone)
    return (
      <form className="auth-card account-form" onSubmit={reset}>
        <div ref={proof.holder} />
        <p className="eyebrow">Quên mật khẩu</p>
        <h1>Nhập mã và mật khẩu mới</h1>
        <p className="lead">
          Nếu số <strong>{phone.destination}</strong> có tài khoản NONA, một mã {OTP_LENGTH} số vừa
          được gửi qua SMS (hiệu lực 5 phút).
        </p>
        {phone.devCode && (
          <p className="phone-dev" role="note">
            Chế độ thử (chưa gửi tin thật): mã là <strong>{phone.devCode}</strong>
          </p>
        )}
        <label className="field">
          <span>Mã xác thực</span>
          <input
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={OTP_LENGTH}
            placeholder={'• '.repeat(OTP_LENGTH).trim()}
            value={f.code}
            onChange={(e) =>
              setF({ ...f, code: e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH) })
            }
          />
        </label>
        <label className="field">
          <span>Mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={200}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
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
            value={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.value })}
            aria-invalid={mismatch}
          />
          {mismatch && <small className="form-error">Mật khẩu nhập lại chưa khớp.</small>}
        </label>
        {finish.error && (
          <p className="form-error" role="alert">
            {finish.error}
          </p>
        )}
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={finish.pending || f.code.length !== OTP_LENGTH || mismatch}
        >
          {finish.pending ? 'Đang lưu…' : 'Đổi mật khẩu'}
        </button>
        <p className="switch">
          <Link href="/dang-nhap">Quay lại đăng nhập</Link>
        </p>
      </form>
    );

  return (
    <form className="auth-card account-form" onSubmit={submit}>
      <div ref={proof.holder} />
      <p className="eyebrow">Quên mật khẩu</p>
      <h1>Đặt lại mật khẩu</h1>
      <p className="lead">
        Nhập email hoặc số điện thoại của tài khoản. Email nhận liên kết đặt lại, số điện thoại nhận
        mã qua SMS.
      </p>
      <label className="field">
        <span>Email hoặc số điện thoại</span>
        <input
          type="text"
          inputMode="email"
          autoComplete="username"
          required
          maxLength={254}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          aria-invalid={typed && id.kind === 'INVALID'}
        />
        {typed && id.kind === 'INVALID' && <small className="form-error">{id.reason}</small>}
        {typed && id.kind === 'EMAIL' && <small>Chúng tôi gửi liên kết đặt lại qua email.</small>}
        {typed && id.kind === 'PHONE' && <small>Chúng tôi gửi mã xác thực qua SMS.</small>}
      </label>
      {ask.error && (
        <p className="form-error" role="alert">
          {ask.error}
        </p>
      )}
      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={ask.pending || id.kind === 'INVALID' || proof.firebase === undefined}
      >
        {ask.pending ? 'Đang gửi…' : id.kind === 'PHONE' ? 'Gửi mã' : 'Gửi liên kết'}
      </button>
      <p className="switch">
        <Link href="/dang-nhap">Quay lại đăng nhập</Link>
      </p>
    </form>
  );
}
