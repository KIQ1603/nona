'use client';

import {
  challengeSentSchema,
  classifyIdentifier,
  meSchema,
  OTP_LENGTH,
  PASSWORD_MIN_LENGTH,
  type ChallengeSent,
} from '@nona/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { usePhoneProof } from '@/features/account/use-phone-proof';
import { useCustomer } from '@/lib/customer-client';
import { GoogleButton } from './google-button';

/**
 * Sign-up in two steps. Step 1: name, ONE field for email or mobile number (the form works out which and the
 * server sends the code there), password typed twice. Step 2: the code. The account only exists after it.
 */
export function RegisterForm({
  next,
  google = true,
  notice,
}: {
  next: string;
  google?: boolean;
  notice?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { request, setUser } = useCustomer();
  const proof = usePhoneProof();
  const begin = useAction();
  const check = useAction();
  const resend = useAction();
  const [f, setF] = useState({ fullName: '', identifier: '', password: '', confirm: '' });
  const [sent, setSent] = useState<ChallengeSent | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const id = classifyIdentifier(f.identifier);
  const typed = f.identifier.trim() !== '';
  const mismatch = f.confirm !== '' && f.confirm !== f.password;

  /** Shows step 2. With Firebase the code is texted by Firebase from this browser, not by our server. */
  const accept = async (raw: unknown) => {
    const s = challengeSentSchema.parse(raw);
    if (s.provider === 'firebase' && id.kind === 'PHONE') await proof.send(id.value);
    setSent(s);
    setCode('');
    setWait(s.resendAfterSeconds);
    toast(
      s.channel === 'EMAIL'
        ? `Đã gửi mã xác thực đến ${s.destination}`
        : `Đã gửi mã xác thực qua SMS đến ${s.destination}`,
      'success',
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (id.kind === 'INVALID' || mismatch) return;
    await begin.run(async () => {
      await accept(
        await request('POST', '/auth/register/start', {
          fullName: f.fullName,
          identifier: f.identifier,
          password: f.password,
          confirmPassword: f.confirm,
        }),
      );
    });
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!sent) return;
    const me = await check.run(async () =>
      meSchema.parse(
        sent.provider === 'firebase'
          ? await request('POST', '/auth/register/verify-firebase', {
              token: sent.token,
              idToken: await proof.confirm(code),
            })
          : await request('POST', '/auth/register/verify', { token: sent.token, code }),
      ),
    );
    if (me) {
      setUser(me);
      toast(`Chào mừng ${me.fullName} đến với NONA`, 'success');
      router.replace(next);
      router.refresh();
    }
  };

  const again = async () => {
    if (!sent) return;
    await resend.run(async () => {
      await accept(await request('POST', '/auth/register/resend', { token: sent.token }));
    });
  };

  const query = next === '/tai-khoan' ? '' : `?next=${encodeURIComponent(next)}`;

  if (sent)
    return (
      <form className="auth-card account-form" onSubmit={verify} aria-labelledby="auth-title">
        <div ref={proof.holder} />
        <p className="eyebrow">Bước 2/2</p>
        <h1 id="auth-title">Xác thực {sent.channel === 'EMAIL' ? 'email' : 'số điện thoại'}</h1>
        <p className="lead">
          Chúng tôi đã gửi mã {OTP_LENGTH} số{' '}
          {sent.channel === 'EMAIL' ? 'đến email' : 'qua SMS đến'}{' '}
          <strong>{sent.destination}</strong>. Mã có hiệu lực{' '}
          {Math.round(sent.expiresInSeconds / 60)} phút. Tài khoản chỉ được tạo sau khi bạn nhập
          đúng mã.
        </p>
        {sent.devCode && (
          <p className="phone-dev" role="note">
            Chế độ thử (chưa gửi tin thật): mã là <strong>{sent.devCode}</strong>
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
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
          />
        </label>
        {(check.error || resend.error) && (
          <p className="form-error" role="alert">
            {check.error ?? resend.error}
          </p>
        )}
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={check.pending || code.length !== OTP_LENGTH}
        >
          {check.pending ? 'Đang kiểm tra…' : 'Xác nhận và tạo tài khoản'}
        </button>
        <div className="phone-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-outline-site"
            disabled={wait > 0 || resend.pending}
            onClick={() => void again()}
          >
            {wait > 0 ? `Gửi lại sau ${wait}s` : 'Gửi lại mã'}
          </button>
          <button type="button" className="btn btn-outline-site" onClick={() => setSent(null)}>
            Sửa thông tin
          </button>
        </div>
      </form>
    );

  return (
    <form className="auth-card account-form" onSubmit={submit} aria-labelledby="auth-title">
      <div ref={proof.holder} />
      <p className="eyebrow">Tham gia NONA</p>
      <h1 id="auth-title">Tạo tài khoản</h1>
      <p className="lead">Lưu giỏ hàng, địa chỉ và sản phẩm yêu thích trên mọi thiết bị.</p>
      {notice && (
        <p className="form-error" role="alert">
          {notice}
        </p>
      )}
      <label className="field">
        <span>Họ và tên</span>
        <input
          name="fullName"
          autoComplete="name"
          required
          maxLength={100}
          value={f.fullName}
          onChange={(e) => setF({ ...f, fullName: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Email hoặc số điện thoại</span>
        <input
          name="identifier"
          type="text"
          inputMode="email"
          autoComplete="username"
          required
          maxLength={254}
          value={f.identifier}
          onChange={(e) => setF({ ...f, identifier: e.target.value })}
          aria-invalid={typed && id.kind === 'INVALID'}
        />
        {typed && id.kind === 'INVALID' && <small className="form-error">{id.reason}</small>}
        {typed && id.kind === 'EMAIL' && <small>Mã xác thực sẽ được gửi đến email này.</small>}
        {typed && id.kind === 'PHONE' && <small>Mã xác thực sẽ được gửi qua SMS đến số này.</small>}
        {!typed && <small>Nhập email hoặc số di động Việt Nam, hệ thống tự nhận biết.</small>}
      </label>
      <label className="field">
        <span>Mật khẩu</span>
        <input
          name="password"
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
        <span>Nhập lại mật khẩu</span>
        <input
          name="confirmPassword"
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
      {begin.error && (
        <p className="form-error" role="alert">
          {begin.error}
        </p>
      )}
      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={
          begin.pending || id.kind === 'INVALID' || mismatch || proof.firebase === undefined
        }
      >
        {begin.pending ? 'Đang gửi mã…' : 'Gửi mã xác thực'}
      </button>
      {google && <GoogleButton next={next} />}
      <p className="switch">
        Đã có tài khoản? <Link href={`/dang-nhap${query}`}>Đăng nhập</Link>
      </p>
    </form>
  );
}
