'use client';

import { formatVnd } from '@nona/contracts';
import { useState } from 'react';

interface Tx {
  txnRef: string;
  amountVnd: number;
  orderInfo: string;
  status: string;
}

export function SimulatorPage({ tx }: { tx: Tx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (outcome: 'SUCCESS' | 'FAILED') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/vnpay/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txnRef: tx.txnRef, outcome }),
      });
      const body = (await res.json()) as { returnUrl?: string };
      if (!res.ok || !body.returnUrl) throw new Error('Không thể hoàn tất giao dịch giả lập.');
      window.location.href = body.returnUrl; // exactly what the real gateway does: send the browser back
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" role="region" aria-labelledby="sim-title">
        <p className="eyebrow">Môi trường thử nghiệm</p>
        <h1 id="sim-title">VNPay (giả lập)</h1>
        <p className="lead">
          Đây là trang thanh toán giả lập dùng khi phát triển. Không có tiền thật nào được chuyển.
        </p>
        <dl className="summary-totals" style={{ marginBottom: 18 }}>
          <div>
            <dt>Nội dung</dt>
            <dd>{tx.orderInfo}</dd>
          </div>
          <div>
            <dt>Mã giao dịch</dt>
            <dd>{tx.txnRef}</dd>
          </div>
          <div className="grand">
            <dt>Số tiền</dt>
            <dd>{formatVnd(tx.amountVnd)}</dd>
          </div>
        </dl>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={busy || tx.status !== 'PENDING'}
            onClick={() => decide('SUCCESS')}
          >
            Thanh toán thành công
          </button>
          <button
            className="btn btn-outline-site btn-block"
            type="button"
            disabled={busy || tx.status !== 'PENDING'}
            onClick={() => decide('FAILED')}
          >
            Hủy / thanh toán thất bại
          </button>
        </div>
        {tx.status !== 'PENDING' && (
          <p className="fine-print">Giao dịch này đã được xử lý ({tx.status}).</p>
        )}
      </div>
    </div>
  );
}
