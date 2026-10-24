'use client';

import {
  normalizeVnMobile,
  OTP_LENGTH,
  phoneOtpSentSchema,
  type PhoneOtpSent,
} from '@nona/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { usePhoneProof } from '@/features/account/use-phone-proof';
import { useCustomer } from '@/lib/customer-client';

/**
 * Confirms the phone number that will receive the order with a one-time code (Zalo or SMS), right under the
 * delivery details. Works for guests and signed-in customers; reports whether the number is verified.
 */
export function CheckoutPhone({
  phone,
  onVerified,
}: {
  phone: string;
  onVerified: (verified: boolean) => void;
}) {
  const { request } = useCustomer();
  const proof = usePhoneProof();
  const toast = useToast();
  const ask = useAction();
  const check = useAction();
  const normalized = normalizeVnMobile(phone);
  const [verified, setVerified] = useState(false);
  const [sent, setSent] = useState<PhoneOtpSent | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);

  // Whenever the number changes, ask the server whether it is already confirmed for this buyer.
  useEffect(() => {
    setSent(null);
    setCode('');
    if (!normalized) {
      setVerified(false);
      onVerified(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      request<{ verified: boolean }>(
        'GET',
        `/checkout/phone?phone=${encodeURIComponent(normalized)}`,
      )
        .then((r) => {
          if (cancelled) return;
          setVerified(r.verified);
          onVerified(r.verified);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  if (!normalized)
    return (
      <p className="phone-hint">
        Nhập số di động hợp lệ (đầu số 03, 05, 07, 08, 09) để xác thực bằng mã OTP.
      </p>
    );

  if (verified)
    return (
      <p className="phone-ok">
        <span className="phone-badge">✓ Đã xác thực</span> Số {phone.trim()} sẽ nhận thông báo đơn
        hàng.
      </p>
    );

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    const res = await ask.run(async (): Promise<PhoneOtpSent> => {
      if (proof.firebase) {
        await proof.send(normalized);
        return { phone: phone.trim(), expiresInSeconds: 0, resendAfterSeconds: 60 };
      }
      return phoneOtpSentSchema.parse(
        await request('POST', '/checkout/phone/otp', { phone: normalized }),
      );
    });
    if (res) {
      setSent(res);
      setCode('');
      setWait(res.resendAfterSeconds);
      toast(`Đã gửi mã đến số ${res.phone}`, 'success');
    }
  };
  const verify = async () => {
    const res = await check.run(async () =>
      proof.firebase
        ? request<{ verified: boolean }>('POST', '/checkout/phone/firebase', {
            idToken: await proof.confirm(code),
          })
        : request<{ verified: boolean }>('POST', '/checkout/phone/verify', { code }),
    );
    if (res?.verified) {
      setVerified(true);
      onVerified(true);
      toast('Đã xác thực số điện thoại', 'success');
    }
  };

  return (
    <div className="phone-box" role="group" aria-label="Xác thực số điện thoại">
      <div ref={proof.holder} />
      <p className="phone-warn">
        <strong>Cần xác thực số điện thoại</strong> trước khi đặt hàng. Chúng tôi gửi mã{' '}
        {OTP_LENGTH} số bằng tin nhắn.
      </p>
      {!sent ? (
        <button
          type="button"
          className="btn btn-dark"
          disabled={ask.pending || proof.firebase === undefined}
          onClick={() => void sendCode()}
        >
          {ask.pending ? 'Đang gửi…' : 'Gửi mã xác thực'}
        </button>
      ) : (
        <>
          {sent.devCode && (
            <p className="phone-dev" role="note">
              Chế độ thử (chưa gửi tin thật): mã là <strong>{sent.devCode}</strong>
            </p>
          )}
          <div className="phone-row">
            <input
              className="otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Mã xác thực"
              maxLength={OTP_LENGTH}
              placeholder={'• '.repeat(OTP_LENGTH).trim()}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (code.length === OTP_LENGTH) void verify();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-dark"
              disabled={check.pending || code.length !== OTP_LENGTH}
              onClick={() => void verify()}
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
          {check.error && (
            <p className="form-error" role="alert">
              {check.error}
            </p>
          )}
        </>
      )}
      {ask.error && (
        <p className="form-error" role="alert">
          {ask.error}
        </p>
      )}
    </div>
  );
}
