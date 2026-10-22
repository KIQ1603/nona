'use client';

import {
  OTP_LENGTH,
  phoneOtpSentSchema,
  phoneStatusSchema,
  type PhoneOtpSent,
  type PhoneStatus,
} from '@nona/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

/** Phone number of the account, verified with a one-time code sent over Zalo. */
export function PhoneVerification() {
  const { request } = useCustomer();
  const toast = useToast();
  const load = useAction();
  const ask = useAction();
  const check = useAction();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<PhoneOtpSent | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    void load.run(async () => {
      setStatus(phoneStatusSchema.parse(await request('GET', '/me/phone')));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    const res = await ask.run(async () =>
      phoneOtpSentSchema.parse(await request('POST', '/me/phone/otp', { phone })),
    );
    if (res) {
      setSent(res);
      setCode('');
      setWait(res.resendAfterSeconds);
      toast(`Đã gửi mã đến Zalo của số ${res.phone}`);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    const res = await check.run(async () =>
      phoneStatusSchema.parse(await request('POST', '/me/phone/verify', { code })),
    );
    if (res) {
      setStatus(res);
      setSent(null);
      setChanging(false);
      setPhone('');
      toast('Đã xác thực số điện thoại');
    }
  };
  const remove = async () => {
    if (!window.confirm('Gỡ số điện thoại khỏi tài khoản?')) return;
    const res = await load.run(async () =>
      phoneStatusSchema.parse(await request('DELETE', '/me/phone')),
    );
    if (res) {
      setStatus(res);
      toast('Đã gỡ số điện thoại');
    }
  };

  const showVerified = status?.verified && !changing && !sent;

  return (
    <section className="panel account-form" aria-labelledby="phone-title">
      <h2 id="phone-title">Số điện thoại</h2>
      {!status ? (
        <p>{load.error ?? 'Đang tải…'}</p>
      ) : showVerified ? (
        <>
          <p className="phone-ok">
            <span className="phone-badge">✓ Đã xác thực</span> <strong>{status.phone}</strong>
          </p>
          <div className="phone-actions">
            <button
              type="button"
              className="btn btn-outline-site"
              onClick={() => setChanging(true)}
            >
              Đổi số
            </button>
            <button type="button" className="btn btn-outline-site" onClick={() => void remove()}>
              Gỡ số
            </button>
          </div>
        </>
      ) : !sent ? (
        <form onSubmit={sendCode}>
          <p className="phone-lead">
            Xác thực số điện thoại để nhận thông báo đơn hàng và giữ tài khoản an toàn. Mã gồm{' '}
            {OTP_LENGTH} chữ số sẽ được gửi qua Zalo.
          </p>
          <label className="field">
            <span>Số điện thoại</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={16}
              placeholder="0912 345 678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <small>Số phải đang dùng Zalo.</small>
          </label>
          {ask.error && (
            <p className="form-error" role="alert">
              {ask.error}
            </p>
          )}
          <div className="phone-actions">
            <button className="btn btn-dark" type="submit" disabled={ask.pending || !phone.trim()}>
              {ask.pending ? 'Đang gửi…' : 'Gửi mã xác thực'}
            </button>
            {changing && (
              <button
                type="button"
                className="btn btn-outline-site"
                onClick={() => setChanging(false)}
              >
                Hủy
              </button>
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="phone-lead">
            Chúng tôi đã gửi mã đến Zalo của số <strong>{sent.phone}</strong>. Mã có hiệu lực{' '}
            {Math.round(sent.expiresInSeconds / 60)} phút.
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
              pattern={`[0-9]{${OTP_LENGTH}}`}
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
            <button type="button" className="btn btn-outline-site" onClick={() => setSent(null)}>
              Đổi số khác
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
