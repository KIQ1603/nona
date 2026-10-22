'use client';

import { mfaConfirmedSchema, mfaSetupSchema, type MeDto } from '@nona/contracts';
import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useAdmin } from '@/lib/admin-client';

/** Two-factor (TOTP) enrolment and management for the signed-in staff member. */
export function SecurityPanel({ me, setupMode = false }: { me: MeDto; setupMode?: boolean }) {
  const { request } = useAdmin();
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [enabled, setEnabled] = useState(me.mfaEnabled);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    QRCode.toString(setup.otpauthUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(
      (svg) => !cancelled && setQr(svg),
    );
    return () => {
      cancelled = true;
    };
  }, [setup]);

  const begin = async () => {
    const s = await run(async () => mfaSetupSchema.parse(await request('POST', '/me/mfa/setup')));
    if (s) setSetup(s);
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(async () =>
      mfaConfirmedSchema.parse(await request('POST', '/me/mfa/confirm', { code })),
    );
    if (res) {
      setRecovery(res.recoveryCodes);
      setEnabled(true);
      setSetup(null);
      setCode('');
    }
  };
  const disable = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      await request('POST', '/me/mfa/disable', { code });
      return true;
    });
    if (ok) {
      setEnabled(false);
      setCode('');
      router.refresh();
    }
  };

  return (
    <div className="admin-card">
      <h2>Xác thực hai lớp (TOTP)</h2>
      {setupMode && !enabled && (
        <p className="form-note">
          Chính sách bảo mật yêu cầu nhân viên bật xác thực hai lớp trước khi dùng khu vực quản trị.
        </p>
      )}

      {recovery && (
        <div role="status">
          <p className="form-note">
            <strong>Đã bật xác thực hai lớp.</strong> Hãy lưu 10 mã khôi phục dưới đây ở nơi an toàn
            — mỗi mã dùng được một lần khi mất điện thoại. Chúng sẽ{' '}
            <strong>không hiển thị lại</strong>.
          </p>
          <ul className="recovery-grid">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setRecovery(null);
              router.replace('/admin');
              router.refresh();
            }}
          >
            Tôi đã lưu mã — tiếp tục
          </button>
        </div>
      )}

      {!recovery && enabled && (
        <form onSubmit={disable}>
          <p>
            <span className="pill pill-published">Đang bật</span> Tài khoản {me.email} được bảo vệ
            bằng mã xác thực.
          </p>
          <label className="field">
            <span>Nhập mã hiện tại để tắt</span>
            <input
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={24}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-outline" type="submit" disabled={pending || !code}>
            Tắt xác thực hai lớp
          </button>
        </form>
      )}

      {!recovery && !enabled && !setup && (
        <>
          <p>
            Thêm một lớp bảo vệ: sau khi nhập mật khẩu, bạn cần mã 6 số từ ứng dụng xác thực (Google
            Authenticator, Authy, 1Password…).
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="button" disabled={pending} onClick={begin}>
            Bắt đầu thiết lập
          </button>
        </>
      )}

      {!recovery && !enabled && setup && (
        <form onSubmit={confirm}>
          <p>
            <strong>1.</strong> Quét mã QR bằng ứng dụng xác thực (hoặc nhập khóa thủ công).
          </p>
          <div
            className="qr-box"
            aria-label="Mã QR thiết lập"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p style={{ marginTop: 12 }}>Khóa thủ công:</p>
          <p className="secret-text">{setup.secret}</p>
          <p>
            <strong>2.</strong> Nhập mã 6 số hiển thị trong ứng dụng để xác nhận.
          </p>
          <label className="field">
            <span>Mã xác thực</span>
            <input
              value={code}
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            Xác nhận và bật
          </button>
        </form>
      )}
    </div>
  );
}
