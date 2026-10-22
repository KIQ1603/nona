import { Inject, Injectable } from '@nestjs/common';
import type { AdminDashboard } from '@nona/contracts';
import { DatabaseService } from '../../../platform/database/database.service';
import { availableQtySql } from '../../inventory/infrastructure/availability';

/** Orders whose money counts as revenue: paid or being fulfilled, not cancelled/refunded/unpaid. */
const REVENUE = `('PAID','CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPING','COMPLETED','PARTIALLY_REFUNDED')`;
/** Orders that need staff to do something next. */
const ACTIONABLE = `('PAID','CONFIRMED','PROCESSING','READY_TO_SHIP','CANCELLATION_REQUESTED','REFUND_PENDING')`;
const TZ = 'Asia/Ho_Chi_Minh';
const LOW_STOCK = 5;

const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DashboardService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async overview(): Promise<AdminDashboard> {
    const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) =>
      this.db.query<T>(sql, p).then((r) => r.rows);

    const [kpi] = await q(
      `SELECT
         COALESCE(SUM(total_vnd) FILTER (WHERE status IN ${REVENUE} AND (created_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date), 0) AS rev_today,
         COALESCE(SUM(total_vnd) FILTER (WHERE status IN ${REVENUE} AND date_trunc('month', created_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}')), 0) AS rev_month,
         COALESCE(SUM(total_vnd) FILTER (WHERE status IN ${REVENUE} AND date_trunc('month', created_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '1 month'), 0) AS rev_prev,
         COUNT(*) FILTER (WHERE status IN ${REVENUE} AND date_trunc('month', created_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}')) AS ord_month,
         COUNT(*) FILTER (WHERE status IN ${REVENUE} AND date_trunc('month', created_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '1 month') AS ord_prev,
         COUNT(*) FILTER (WHERE status IN ${ACTIONABLE}) AS awaiting
       FROM orders`,
    );
    const [dz] = await q(
      `SELECT
         COUNT(*) FILTER (WHERE date_trunc('month', submitted_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}')) AS d_month,
         COUNT(*) FILTER (WHERE date_trunc('month', submitted_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '1 month') AS d_prev
       FROM custom_design_versions WHERE submitted_at IS NOT NULL`,
    );
    const [stock] = await q(
      `SELECT COUNT(*) AS n FROM (
         SELECT ${availableQtySql('v')} AS available
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.is_active AND p.status = 'PUBLISHED') s WHERE available <= ${LOW_STOCK}`,
    );
    const [cust] = await q(`SELECT COUNT(*) AS n FROM users WHERE role = 'CUSTOMER'`);

    const daily = await q(
      `WITH days AS (
         SELECT d::date AS day FROM generate_series(
           (now() AT TIME ZONE '${TZ}')::date - 29, (now() AT TIME ZONE '${TZ}')::date, interval '1 day') d)
       SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
              COALESCE((SELECT SUM(total_vnd) FROM orders o WHERE o.status IN ${REVENUE} AND (o.created_at AT TIME ZONE '${TZ}')::date = days.day), 0) AS revenue,
              (SELECT COUNT(*) FROM orders o WHERE o.status IN ${REVENUE} AND (o.created_at AT TIME ZONE '${TZ}')::date = days.day) AS orders,
              (SELECT COUNT(*) FROM custom_design_versions v WHERE v.submitted_at IS NOT NULL AND (v.submitted_at AT TIME ZONE '${TZ}')::date = days.day) AS designs
       FROM days ORDER BY days.day`,
    );
    const weekly = await q(
      `WITH weeks AS (
         SELECT w::date AS start FROM generate_series(
           date_trunc('week', now() AT TIME ZONE '${TZ}')::date - 77, date_trunc('week', now() AT TIME ZONE '${TZ}')::date, interval '1 week') w)
       SELECT to_char(weeks.start, 'YYYY-MM-DD') AS start,
              COALESCE((SELECT SUM(total_vnd) FROM orders o WHERE o.status IN ${REVENUE} AND date_trunc('week', o.created_at AT TIME ZONE '${TZ}')::date = weeks.start), 0) AS revenue,
              (SELECT COUNT(*) FROM orders o WHERE o.status IN ${REVENUE} AND date_trunc('week', o.created_at AT TIME ZONE '${TZ}')::date = weeks.start) AS orders
       FROM weeks ORDER BY weeks.start`,
    );
    const monthly = await q(
      `WITH months AS (
         SELECT m::date AS start FROM generate_series(
           date_trunc('month', now() AT TIME ZONE '${TZ}')::date - interval '11 months', date_trunc('month', now() AT TIME ZONE '${TZ}')::date, interval '1 month') m)
       SELECT to_char(months.start, 'YYYY-MM') AS month,
              COALESCE((SELECT SUM(total_vnd) FROM orders o WHERE o.status IN ${REVENUE} AND date_trunc('month', o.created_at AT TIME ZONE '${TZ}')::date = months.start), 0) AS revenue,
              (SELECT COUNT(*) FROM orders o WHERE o.status IN ${REVENUE} AND date_trunc('month', o.created_at AT TIME ZONE '${TZ}')::date = months.start) AS orders,
              (SELECT COUNT(*) FROM custom_design_versions v WHERE v.submitted_at IS NOT NULL AND date_trunc('month', v.submitted_at AT TIME ZONE '${TZ}')::date = months.start) AS designs
       FROM months ORDER BY months.start`,
    );
    const statuses = await q(
      `SELECT status, COUNT(*) AS n FROM orders WHERE created_at >= now() - interval '30 days' GROUP BY status ORDER BY n DESC`,
    );
    const payments = await q(
      `SELECT payment_method AS method, COUNT(*) AS orders, COALESCE(SUM(total_vnd), 0) AS revenue
       FROM orders WHERE status IN ${REVENUE} AND created_at >= now() - interval '30 days' GROUP BY payment_method ORDER BY orders DESC`,
    );
    const top = await q(
      `SELECT i.product_name AS name, SUM(i.quantity) AS qty, SUM(i.line_total_vnd) AS revenue,
              COUNT(*) FILTER (WHERE i.design_version_id IS NOT NULL) AS custom
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status IN ${REVENUE} AND o.created_at >= now() - interval '30 days'
       GROUP BY i.product_name ORDER BY revenue DESC LIMIT 5`,
    );
    const designStatus = await q(
      `SELECT status, COUNT(*) AS n FROM custom_design_versions
       WHERE submitted_at >= now() - interval '30 days' GROUP BY status ORDER BY n DESC`,
    );
    const [ordered] = await q(
      `SELECT COUNT(DISTINCT i.design_version_id) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.design_version_id IS NOT NULL AND date_trunc('month', o.created_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}')`,
    );

    const ordersMonth = num(kpi!.ord_month);
    return {
      generatedAt: new Date().toISOString(),
      kpis: {
        revenueTodayVnd: num(kpi!.rev_today),
        revenueMonthVnd: num(kpi!.rev_month),
        revenuePrevMonthVnd: num(kpi!.rev_prev),
        ordersMonth,
        ordersPrevMonth: num(kpi!.ord_prev),
        averageOrderVnd: ordersMonth ? Math.round(num(kpi!.rev_month) / ordersMonth) : 0,
        designsMonth: num(dz!.d_month),
        designsPrevMonth: num(dz!.d_prev),
        awaitingAction: num(kpi!.awaiting),
        lowStock: num(stock!.n),
        customers: num(cust!.n),
      },
      daily: daily.map((r) => ({
        date: String(r.date),
        revenueVnd: num(r.revenue),
        orders: num(r.orders),
        designs: num(r.designs),
      })),
      weekly: weekly.map((r) => ({
        start: String(r.start),
        revenueVnd: num(r.revenue),
        orders: num(r.orders),
      })),
      monthly: monthly.map((r) => ({
        month: String(r.month),
        revenueVnd: num(r.revenue),
        orders: num(r.orders),
        designs: num(r.designs),
      })),
      statusBreakdown: statuses.map((r) => ({ status: String(r.status), count: num(r.n) })),
      paymentMix: payments.map((r) => ({
        method: String(r.method),
        orders: num(r.orders),
        revenueVnd: num(r.revenue),
      })),
      topProducts: top.map((r) => ({
        name: String(r.name),
        quantity: num(r.qty),
        revenueVnd: num(r.revenue),
        custom: num(r.custom),
      })),
      designs: {
        totalMonth: num(dz!.d_month),
        orderedMonth: num(ordered!.n),
        byStatus: designStatus.map((r) => ({ status: String(r.status), count: num(r.n) })),
      },
    };
  }
}
