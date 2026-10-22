import { z } from 'zod';
import { adminGet } from '@/lib/admin-server';

const statusSchema = z.object({
  outbox: z.object({ pending: z.number(), dead: z.number(), oldestPendingSeconds: z.number() }),
  payments: z.object({ pending: z.number(), stalePending: z.number() }),
  refunds: z.object({ pending: z.number(), needsManual: z.number(), failed: z.number() }),
  orders: z.record(z.number()),
  reservations: z.object({ active: z.number() }),
  alerts: z.array(
    z.object({ severity: z.enum(['critical', 'warning']), code: z.string(), message: z.string() }),
  ),
  generatedAt: z.string(),
});

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const s = await adminGet('/admin/system', statusSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hệ thống</h1>
          <p>
            Tình trạng hàng đợi, thanh toán và hoàn tiền · cập nhật{' '}
            {new Date(s.generatedAt).toLocaleTimeString('vi-VN')}
          </p>
        </div>
      </div>
      {s.alerts.length === 0 ? (
        <p className="alert ok" role="status">
          Mọi thứ đang hoạt động bình thường.
        </p>
      ) : (
        s.alerts.map((a) => (
          <p key={a.code} className={`alert ${a.severity}`} role="alert">
            <strong>{a.severity === 'critical' ? 'Nghiêm trọng: ' : 'Cảnh báo: '}</strong>
            {a.message}
          </p>
        ))
      )}
      <div className="admin-grid" style={{ marginTop: 18 }}>
        <div className="stat">
          <strong>{s.outbox.pending}</strong>
          <span>
            Email chờ gửi
            {s.outbox.pending > 0
              ? ` (cũ nhất ${Math.round(s.outbox.oldestPendingSeconds / 60)} phút)`
              : ''}
          </span>
        </div>
        <div className="stat">
          <strong>{s.outbox.dead}</strong>
          <span>Email thất bại hẳn (dead-letter)</span>
        </div>
        <div className="stat">
          <strong>{s.payments.pending}</strong>
          <span>Thanh toán online đang chờ</span>
        </div>
        <div className="stat">
          <strong>{s.refunds.pending}</strong>
          <span>Hoàn tiền chờ xác nhận ({s.refunds.needsManual} cần xử lý tay)</span>
        </div>
        <div className="stat">
          <strong>{s.reservations.active}</strong>
          <span>Giữ chỗ đang hiệu lực</span>
        </div>
      </div>
      <div className="admin-card" style={{ marginTop: 18 }}>
        <h2>Đơn hàng theo trạng thái</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <tbody>
              {Object.entries(s.orders).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
              {Object.keys(s.orders).length === 0 && (
                <tr>
                  <td>Chưa có đơn hàng.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="form-note" style={{ marginTop: 18 }}>
        Số liệu cho hệ thống giám sát: <code>GET /v1/internal/metrics</code> (Prometheus, cần{' '}
        <code>INTERNAL_API_TOKEN</code>). Xem hướng dẫn xử lý trong <code>docs/runbooks/</code>.
      </p>
    </>
  );
}
