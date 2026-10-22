import {
  adminDashboardSchema,
  adminProductListResponseSchema,
  DESIGN_STATUS_LABELS,
  formatVnd,
  ORDER_STATUS_LABELS,
  type AdminDashboard,
  type DesignStatus,
  type OrderStatus,
} from '@nona/contracts';
import Link from 'next/link';
import { shortVnd } from '@/lib/short-vnd';
import { ApiError } from '@/lib/api-client';
import { adminGet } from '@/lib/admin-server';
import { AreaChart, BarChart, Donut, HBars, Sparkline } from '@/features/admin/dashboard/charts';
import { MonthlyOrdersChart, RevenuePanel } from '@/features/admin/dashboard/revenue-panel';

const STATUS_COLOR: Record<string, string> = {
  PENDING_PAYMENT: '#e3b865',
  PAID: '#3a7fb5',
  CONFIRMED: '#9a8650',
  PROCESSING: '#2f6b9a',
  READY_TO_SHIP: '#17806f',
  SHIPPING: '#7a56b8',
  COMPLETED: '#2f8a4f',
  CANCELLED: '#c0553f',
  CANCELLATION_REQUESTED: '#d98a2b',
  PAYMENT_FAILED: '#a53a2c',
  EXPIRED: '#9aa09b',
  REFUND_PENDING: '#d9772b',
  PARTIALLY_REFUNDED: '#c27b3d',
  REFUNDED: '#8a8f8b',
  DRAFT: '#b9b9b0',
};
const DESIGN_COLOR: Record<string, string> = {
  APPROVED: '#2f8a4f',
  SUBMITTED: '#e3b865',
  REVISION_REQUIRED: '#c0553f',
  ARCHIVED: '#9aa09b',
  DRAFT: '#b9b9b0',
};
const PAYMENT_LABEL: Record<string, string> = { COD: 'Thanh toán khi nhận (COD)', VNPAY: 'VNPay' };

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const nf = new Intl.NumberFormat('vi-VN');

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="delta flat">— so với tháng trước</span>;
  if (prev === 0) return <span className="delta up">▲ mới trong tháng</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <span className={`delta ${cls}`}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} {Math.abs(pct)}% so với tháng trước
    </span>
  );
}

function Kpi({
  label,
  value,
  children,
  spark,
  tone = 'green',
}: {
  label: string;
  value: string;
  children: React.ReactNode;
  spark?: number[];
  tone?: 'green' | 'red' | 'gold';
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-label">{label}</span>
      <strong>{value}</strong>
      <div className="kpi-foot">
        {children}
        {spark && (
          <Sparkline
            values={spark}
            color={tone === 'red' ? '#b5442a' : tone === 'gold' ? '#c8923a' : '#1f3d2b'}
          />
        )}
      </div>
    </div>
  );
}

async function load(): Promise<AdminDashboard | null> {
  try {
    return await adminGet('/admin/dashboard', adminDashboardSchema);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** Staff without order access only see the catalogue summary. */
async function CatalogOnly() {
  const count = async (status: string) =>
    (await adminGet(`/admin/products?status=${status}&pageSize=1`, adminProductListResponseSchema))
      .meta.total;
  const [published, draft, archived] = await Promise.all([
    count('PUBLISHED'),
    count('DRAFT'),
    count('ARCHIVED'),
  ]);
  return (
    <div className="admin-grid">
      <Link className="stat" href="/admin/products?status=PUBLISHED">
        <strong>{published}</strong>
        <span>Đang bán</span>
      </Link>
      <Link className="stat" href="/admin/products?status=DRAFT">
        <strong>{draft}</strong>
        <span>Bản nháp</span>
      </Link>
      <Link className="stat" href="/admin/products?status=ARCHIVED">
        <strong>{archived}</strong>
        <span>Lưu trữ</span>
      </Link>
    </div>
  );
}

export default async function DashboardPage() {
  const d = await load();
  const k = d?.kpis;
  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tổng quan</h1>
          <p>{today} · số liệu cập nhật mỗi lần mở trang</p>
        </div>
        <div className="form-actions">
          <Link className="btn btn-outline" href="/admin/orders">
            Xem đơn hàng
          </Link>
        </div>
      </div>

      {!d || !k ? (
        <CatalogOnly />
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Doanh thu tháng này"
              value={`${formatVnd(k.revenueMonthVnd)}`}
              spark={d.daily.map((x) => x.revenueVnd)}
            >
              <Delta now={k.revenueMonthVnd} prev={k.revenuePrevMonthVnd} />
            </Kpi>
            <Kpi
              label="Đơn hàng tháng này"
              value={nf.format(k.ordersMonth)}
              spark={d.daily.map((x) => x.orders)}
              tone="gold"
            >
              <Delta now={k.ordersMonth} prev={k.ordersPrevMonth} />
            </Kpi>
            <Kpi label="Giá trị trung bình / đơn" value={formatVnd(k.averageOrderVnd)}>
              <span className="delta flat">Hôm nay: {formatVnd(k.revenueTodayVnd)}</span>
            </Kpi>
            <Kpi
              label="Lượt thiết kế riêng (tháng)"
              value={nf.format(k.designsMonth)}
              spark={d.daily.map((x) => x.designs)}
              tone="red"
            >
              <Delta now={k.designsMonth} prev={k.designsPrevMonth} />
            </Kpi>
          </div>

          <div className="attention">
            <Link href="/admin/orders" className={k.awaitingAction ? 'warn' : ''}>
              <b>{k.awaitingAction}</b>
              <span>đơn cần xử lý</span>
            </Link>
            <Link href="/admin/products" className={k.lowStock ? 'warn' : ''}>
              <b>{k.lowStock}</b>
              <span>màu/size sắp hết hàng</span>
            </Link>
            <Link href="/admin/designs">
              <b>{d.designs.orderedMonth}</b>
              <span>thiết kế đã đặt hàng (tháng)</span>
            </Link>
            <div>
              <b>{nf.format(k.customers)}</b>
              <span>khách có tài khoản</span>
            </div>
          </div>

          <RevenuePanel data={d} />

          <div className="dash-grid">
            <section className="admin-card dash-card">
              <div className="card-head">
                <div>
                  <h2>Trạng thái đơn hàng</h2>
                  <p className="card-sub">30 ngày gần đây</p>
                </div>
              </div>
              <Donut
                centre="đơn"
                slices={d.statusBreakdown.map((s) => ({
                  label: ORDER_STATUS_LABELS[s.status as OrderStatus] ?? s.status,
                  value: s.count,
                  color: STATUS_COLOR[s.status] ?? '#9aa09b',
                }))}
              />
            </section>

            <section className="admin-card dash-card">
              <div className="card-head">
                <div>
                  <h2>Lượt thiết kế riêng</h2>
                  <p className="card-sub">Số thiết kế khách gửi mỗi ngày, 30 ngày gần đây</p>
                </div>
              </div>
              <AreaChart
                unit="thiết kế"
                data={d.daily.map((x) => ({ label: dm(x.date), value: x.designs }))}
              />
            </section>

            <section className="admin-card dash-card">
              <div className="card-head">
                <div>
                  <h2>Sản phẩm bán chạy</h2>
                  <p className="card-sub">Theo doanh thu, 30 ngày gần đây</p>
                </div>
              </div>
              <HBars
                rows={d.topProducts.map((p) => ({
                  label: p.name,
                  value: p.revenueVnd,
                  text: shortVnd(p.revenueVnd),
                  sub: `${p.quantity} sản phẩm${p.custom ? ` · ${p.custom} thiết kế riêng` : ''}`,
                }))}
              />
            </section>

            <section className="admin-card dash-card">
              <div className="card-head">
                <div>
                  <h2>Thiết kế theo trạng thái</h2>
                  <p className="card-sub">Phiên bản thiết kế đã gửi, 30 ngày gần đây</p>
                </div>
              </div>
              <Donut
                centre="thiết kế"
                slices={d.designs.byStatus.map((s) => ({
                  label: DESIGN_STATUS_LABELS[s.status as DesignStatus] ?? s.status,
                  value: s.count,
                  color: DESIGN_COLOR[s.status] ?? '#9aa09b',
                }))}
              />
            </section>

            <section className="admin-card dash-card wide">
              <div className="card-head">
                <div>
                  <h2>Đơn hàng và thiết kế theo tháng</h2>
                  <p className="card-sub">Số đơn có doanh thu trong 12 tháng gần đây</p>
                </div>
              </div>
              <MonthlyOrdersChart data={d.monthly} />
            </section>

            <section className="admin-card dash-card">
              <div className="card-head">
                <div>
                  <h2>Hình thức thanh toán</h2>
                  <p className="card-sub">Đơn có doanh thu, 30 ngày gần đây</p>
                </div>
              </div>
              <Donut
                centre="đơn"
                slices={d.paymentMix.map((p, i) => ({
                  label: `${PAYMENT_LABEL[p.method] ?? p.method} · ${shortVnd(p.revenueVnd)}`,
                  value: p.orders,
                  color: ['#1f3d2b', '#e3b865', '#b5442a'][i % 3]!,
                }))}
              />
            </section>
          </div>
        </>
      )}
    </>
  );
}
