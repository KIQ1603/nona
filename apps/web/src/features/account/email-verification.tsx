'use client';

import { OTP_LENGTH } from '@nona/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

interface Status {
  email: string;
  verified: boolean;
}
interface Sent {
  resendAfterSeconds: number;
  devCode?: string;
}

/** Confirms the account's email address with a code sent to it. */
export function EmailVerification() {
  const { request } = useCustomer();
  const toast = useToast();
  const load = useAction();
  const ask = useAction();
  const check = useAction();
  const [status, setStatus] = useState<Status | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    void load.run(async () => setStatus(await request<Status>('GET', '/me/email')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const sendCode = async () => {
    const res = await ask.run(() => request<Sent>('POST', '/me/email/otp', {}));
    if (res) {
      setSent(res);
      setCode('');
      setWait(res.resendAfterSeconds);
      toast('Đã gửi mã xác thực đến email của bạn', 'success');
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    const res = await check.run(() => request<Status>('POST', '/me/email/verify', { code }));
    if (res) {
      setStatus(res);
      setSent(null);
      toast('Đã xác thực email', 'success');
    }
  };

  return (
    <section className="panel account-form" aria-labelledby="email-title">
      <h2 id="email-title">Xác thực email</h2>
      {!status ? (
        <p>{load.error ?? 'Đang tải…'}</p>
      ) : status.verified ? (
        <p className="phone-ok">
          <span className="phone-badge">✓ Đã xác thực</span> <strong>{status.email}</strong>
        </p>
      ) : !sent ? (
        <>
          <p className="phone-lead">
            Email <strong>{status.email}</strong> chưa được xác thực. Chúng tôi gửi mã {OTP_LENGTH}{' '}
            số đến email này (mã cũng có trong thư chào mừng khi bạn đăng ký).
          </p>
          {ask.error && (
            <p className="form-error" role="alert">
              {ask.error}
            </p>
          )}
          <button
            className="btn btn-dark"
            type="button"
            disabled={ask.pending}
            onClick={() => void sendCode()}
          >
            {ask.pending ? 'Đang gửi…' : 'Gửi mã xác thực'}
          </button>
          <p className="phone-lead" style={{ marginTop: 14 }}>
            Đã có mã trong thư? Nhập bên dưới.
          </p>
          <form onSubmit={verify}>
            <label className="field">
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Mã xác thực email"
                maxLength={OTP_LENGTH}
                placeholder={'• '.repeat(OTP_LENGTH).trim()}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              />
            </label>
            {check.error && (
              <p className="form-error" role="alert">
                {check.error}
              </p>
            )}
            <button
              className="btn btn-dark"
              type="submit"
              disabled={check.pending || code.length !== OTP_LENGTH}
            >
              {check.pending ? 'Đang kiểm tra…' : 'Xác nhận'}
            </button>
          </form>
        </>
      ) : (
        <form onSubmit={verify}>
          <p className="phone-lead">
            Mã đã được gửi đến <strong>{status.email}</strong>. Mã có hiệu lực 10 phút.
          </p>
          {sent.devCode && (
            <p className="phone-dev" role="note">
              Chế độ thử (chưa gửi email thật): mã là <strong>{sent.devCode}</strong>
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
          {check.error && (
            <p className="form-error" role="alert">
              {check.error}
            </p>
          )}
          <div className="phone-actions">
            <button
              className="btn btn-dark"
              type="submit"
              disabled={check.pending || code.length !== OTP_LENGTH}
            >
              {check.pending ? 'Đang kiểm tra…' : 'Xác nhận'}
            </button>
            <button
              type="button"
              className="btn btn-outline-site"
              disabled={wait > 0 || ask.pending}
              onClick={() => void sendCode()}
            >
              {wait > 0 ? `Gửi lại sau ${wait}s` : 'Gửi lại mã'}
            </button>
          </div>
          {ask.error && (
            <p className="form-error" role="alert">
              {ask.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
