'use client';

import type { AdminDashboard } from '@nona/contracts';
import { useState } from 'react';
import { BarChart, type BarPoint } from './charts';

type Range = 'day' | 'week' | 'month';
const TABS: { id: Range; label: string }[] = [
  { id: 'day', label: '30 ngày' },
  { id: 'week', label: '12 tuần' },
  { id: 'month', label: '12 tháng' },
];

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Revenue bars with a switch between days, weeks and months. */
export function RevenuePanel({ data }: { data: AdminDashboard }) {
  const [range, setRange] = useState<Range>('day');
  const points: BarPoint[] =
    range === 'day'
      ? data.daily.map((d) => ({
          label: dm(d.date),
          value: d.revenueVnd,
          hint: `${d.orders} đơn`,
        }))
      : range === 'week'
        ? data.weekly.map((w) => ({
            label: `Tuần ${dm(w.start)}`,
            value: w.revenueVnd,
            hint: `${w.orders} đơn`,
          }))
        : data.monthly.map((m) => ({
            label: `T${m.month.slice(5, 7)}/${m.month.slice(2, 4)}`,
            value: m.revenueVnd,
            hint: `${m.orders} đơn`,
          }));
  const sum = points.reduce((s, p) => s + p.value, 0);
  const orders = (
    range === 'day' ? data.daily : range === 'week' ? data.weekly : data.monthly
  ).reduce((s, p) => s + p.orders, 0);

  return (
    <section className="admin-card dash-card">
      <div className="card-head">
        <div>
          <h2>Doanh thu</h2>
          <p className="card-sub">
            {orders} đơn có doanh thu · không tính đơn hủy, hết hạn hoặc chưa thanh toán
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Khoảng thời gian">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={range === t.id}
              className={range === t.id ? 'on' : ''}
              onClick={() => setRange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <BarChart data={points} key={range} />
      <p className="chart-total">
        Tổng trong kỳ: <strong>{new Intl.NumberFormat('vi-VN').format(sum)} ₫</strong>
      </p>
    </section>
  );
}

/** Orders per month (counts, not money) — a client component so the formatters can be passed down. */
export function MonthlyOrdersChart({ data }: { data: AdminDashboard['monthly'] }) {
  return (
    <BarChart
      height={200}
      format={(n) => String(n)}
      full={(n) => `${n} đơn`}
      data={data.map((m) => ({
        label: `T${m.month.slice(5, 7)}`,
        value: m.orders,
        hint: `${m.designs} thiết kế`,
      }))}
    />
  );
}
