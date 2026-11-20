import { adminAnalyticsSchema, ANALYTICS_RANGES, ORDER_STATUS_LABELS } from '@nona/contracts';
import Link from 'next/link';
import { adminGet } from '@/lib/admin-server';
import { AreaChart, HBars } from '@/features/admin/dashboard/charts';

type Search = Promise<Record<string, string | string[] | undefined>>;
const nf = new Intl.NumberFormat('vi-VN');
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="kpi kpi-green">
      <span className="kpi-label">{label}</span>
      <strong>{nf.format(value)}</strong>
      {note && (
        <div className="kpi-foot">
          <span className="delta flat">{note}</span>
        </div>
      )}
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const raw = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days = (ANALYTICS_RANGES as readonly number[]).includes(raw) ? raw : 30;
  const d = await adminGet(`/admin/analytics?days=${days}`, adminAnalyticsSchema);
  const series = (pick: (p: (typeof d.daily)[number]) => number) =>
    d.daily.map((p) => ({ label: dm(p.date), value: pick(p) }));
  const e = d.engagement;
  const since = d.trackingSince
    ? new Date(d.trackingSince).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Thống kê tương tác</h1>
          <p>
            {since
              ? `Lượt truy cập được ghi từ ${since}; hành động của khách (giỏ hàng, yêu thích, thiết kế, đơn) tính từ dữ liệu có sẵn từ trước.`
              : 'Chưa ghi nhận lượt truy cập nào — số liệu sẽ xuất hiện khi có khách mở trang. Hành động của khách tính từ dữ liệu có sẵn.'}
          </p>
        </div>
        <div className="form-actions">
          {ANALYTICS_RANGES.map((n) => (
            <Link
              key={n}
              className={`btn ${n === days ? 'btn-dark' : 'btn-outline'}`}
              href={`/admin/analytics?days=${n}`}
            >
              {n} ngày
            </Link>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <Tile
          label={`Lượt xem trang (${days} ngày)`}
          value={d.traffic.pageViews + d.traffic.productViews}
        />
        <Tile
          label="Khách truy cập"
          value={d.traffic.visitors}
          note={`Hôm nay: ${nf.format(d.traffic.visitorsToday)}`}
        />
        <Tile label="Lượt xem sản phẩm" value={d.traffic.productViews} />
        <Tile
          label="Đơn hàng"
          value={e.orders}
          note={`${pct(e.orders, d.traffic.visitors)} khách truy cập`}
        />
      </div>

      <div className="dash-grid">
        <section className="admin-card dash-card wide">
          <div className="card-head">
            <div>
              <h2>Khách truy cập mỗi ngày</h2>
              <p className="card-sub">Số người khác nhau mở cửa hàng</p>
            </div>
          </div>
          <AreaChart data={series((p) => p.visitors)} unit=" khách" />
        </section>
        <section className="admin-card dash-card wide">
          <div className="card-head">
            <div>
              <h2>Lượt xem mỗi ngày</h2>
              <p className="card-sub">Tất cả trang, gồm trang sản phẩm</p>
            </div>
          </div>
          <AreaChart data={series((p) => p.pageViews + p.productViews)} unit=" lượt" />
        </section>
      </div>

      <div className="dash-grid">
        <section className="admin-card dash-card">
          <div className="card-head">
            <div>
              <h2>Hành động của khách</h2>
              <p className="card-sub">{days} ngày gần đây · từ dữ liệu cửa hàng</p>
            </div>
          </div>
          <HBars
            rows={[
              { label: 'Tài khoản mới', value: e.newAccounts, text: nf.format(e.newAccounts) },
              { label: 'Thêm vào giỏ hàng', value: e.cartAdds, text: nf.format(e.cartAdds) },
              {
                label: 'Thêm vào yêu thích',
                value: e.wishlistAdds,
                text: nf.format(e.wishlistAdds),
              },
              {
                label: 'Bắt đầu thiết kế riêng',
                value: e.designsStarted,
                text: nf.format(e.designsStarted),
              },
              {
                label: 'Gửi thiết kế để duyệt',
                value: e.designsSubmitted,
                text: nf.format(e.designsSubmitted),
              },
              { label: 'Đặt hàng', value: e.orders, text: nf.format(e.orders) },
            ]}
          />
        </section>
        <section className="admin-card dash-card">
          <div className="card-head">
            <div>
              <h2>Sản phẩm được xem nhiều</h2>
              <p className="card-sub">Theo lượt mở trang sản phẩm</p>
            </div>
          </div>
          <HBars
            rows={d.topProducts.map((p) => ({
              label: p.name ?? p.slug,
              value: p.views,
              text: `${nf.format(p.views)} lượt`,
            }))}
          />
        </section>
        <section className="admin-card dash-card">
          <div className="card-head">
            <div>
              <h2>Trang được xem nhiều</h2>
              <p className="card-sub">Không gồm trang sản phẩm</p>
            </div>
          </div>
          <HBars
            rows={d.topPages.map((p) => ({
              label: p.path,
              value: p.views,
              text: `${nf.format(p.views)} lượt`,
              sub: `${nf.format(p.visitors)} khách`,
            }))}
          />
        </section>
        <section className="admin-card dash-card">
          <div className="card-head">
            <div>
              <h2>Khách đến từ đâu</h2>
              <p className="card-sub">Trang giới thiệu khách vào cửa hàng</p>
            </div>
          </div>
          <HBars
            rows={d.referrers.map((r) => ({
              label: r.host,
              value: r.visits,
              text: `${nf.format(r.visits)} lượt`,
            }))}
          />
        </section>
        <section className="admin-card dash-card">
          <div className="card-head">
            <div>
              <h2>Trạng thái đơn trong kỳ</h2>
              <p className="card-sub">Không gồm đơn nháp</p>
            </div>
          </div>
          <HBars
            rows={d.statusMix.map((s) => ({
              label: ORDER_STATUS_LABELS[s.status],
              value: s.count,
              text: nf.format(s.count),
            }))}
          />
        </section>
      </div>
    </>
  );
}
