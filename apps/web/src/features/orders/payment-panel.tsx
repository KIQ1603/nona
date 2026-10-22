'use client';

import { formatVnd, paymentSessionSchema } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

function useCountdown(expiresAt: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () =>
      setLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  return left;
}

/**
 * Shown while an online order waits for payment. After coming back from the gateway the server may not have
 * received the provider's confirmation yet, so we poll the authoritative order (never trusting the redirect).
 */
export function PaymentPanel({
  code,
  expiresAt,
  lastAttemptFailed,
  returning,
  totalVnd,
}: {
  code: string;
  expiresAt: string | null;
  lastAttemptFailed: boolean;
  returning: boolean;
  totalVnd: number;
}) {
  const router = useRouter();
  const { request } = useCustomer();
  const { pending, error, run } = useAction();
  const left = useCountdown(expiresAt);
  const polls = useRef(0);
  const expired = left !== null && left <= 0;

  useEffect(() => {
    if (!returning || lastAttemptFailed || expired) return;
    const t = window.setInterval(() => {
      if (polls.current++ >= 20) return window.clearInterval(t); // ~60 seconds
      router.refresh();
    }, 3000);
    return () => window.clearInterval(t);
  }, [returning, lastAttemptFailed, expired, router]);

  const pay = async () => {
    const session = await run(async () =>
      paymentSessionSchema.parse(
        await request(
          'POST',
          '/payments/vnpay',
          { orderCode: code },
          { idempotencyKey: crypto.randomUUID() },
        ),
      ),
    );
    if (session) window.location.assign(session.paymentUrl);
  };
  const mm =
    left === null
      ? ''
      : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;

  return (
    <section className="panel pay-panel" aria-live="polite">
      {returning && !lastAttemptFailed && !expired ? (
        <>
          <h2>Đang xác nhận thanh toán…</h2>
          <p>
            Chúng tôi đang chờ ngân hàng xác nhận. Trang sẽ tự cập nhật — bạn không cần làm gì thêm.
          </p>
        </>
      ) : (
        <>
          <h2>
            {expired
              ? 'Đã hết thời gian thanh toán'
              : lastAttemptFailed
                ? 'Thanh toán chưa thành công'
                : 'Hoàn tất thanh toán'}
          </h2>
          {expired ? (
            <p>
              Hàng không còn được giữ cho đơn này. Nếu bạn đã thanh toán, hệ thống sẽ tự hoàn tiền
              hoặc xác nhận đơn. Nếu chưa, hãy đặt hàng lại.
            </p>
          ) : (
            <>
              <p>
                {lastAttemptFailed ? 'Giao dịch vừa rồi chưa thành công, bạn có thể thử lại. ' : ''}
                Hàng được giữ cho bạn{mm ? ` trong ${mm}` : ''}. Số tiền cần thanh toán:{' '}
                <strong>{formatVnd(totalVnd)}</strong>.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" type="button" disabled={pending} onClick={pay}>
                {pending
                  ? 'Đang chuyển…'
                  : lastAttemptFailed
                    ? 'Thử thanh toán lại'
                    : 'Thanh toán ngay'}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
