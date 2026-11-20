import { Inject, Injectable } from '@nestjs/common';
import {
  ORDER_STATUSES,
  type AdminAnalytics,
  type AdminUserList,
  type TrackEventInput,
} from '@nona/contracts';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';

const TZ = 'Asia/Ho_Chi_Minh';
const REVENUE = `('PAID','CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPING','COMPLETED','PARTIALLY_REFUNDED')`;
const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

const PRODUCT_PATH = /^\/san-pham\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
/** Paths that are not storefront traffic. */
const IGNORED = /^\/(admin|api|_next|media|dev)(\/|$)/;

/** Per-key sliding window; in-memory is enough for one API replica (same trade-off as LoginThrottle). */
class Window {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly ms: number,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.ms)) this.hits.delete(k);
    }
    return true;
  }
}

@Injectable()
export class AnalyticsService {
  private readonly perVisitor = new Window(60, 60_000);
  private readonly perIp = new Window(240, 60_000);

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Stores one anonymous view. Returns false when ignored (admin/API paths, own-site referrer, rate limit). */
  async record(input: TrackEventInput, ip: string | undefined): Promise<boolean> {
    if (IGNORED.test(input.path)) return false;
    if (!this.perIp.allow(ip ?? 'unknown') || !this.perVisitor.allow(input.visitorId)) return false;
    const product = PRODUCT_PATH.exec(input.path)?.[1] ?? null;
    await this.db.query(
      `INSERT INTO analytics_events (visitor_id, kind, path, product_slug, referrer_host)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.visitorId,
        product ? 'PRODUCT_VIEW' : 'PAGE_VIEW',
        input.path,
        product,
        this.referrerHost(input.referrer),
      ],
    );
    return true;
  }

  /** Host of an external referrer; the shop's own pages are not a "source". */
  private referrerHost(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
      const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
      const own = new URL(this.env.WEB_ORIGIN).hostname.replace(/^www\./, '').toLowerCase();
      return host && host !== own ? host.slice(0, 120) : null;
    } catch {
      return null;
    }
  }

  async report(days: number): Promise<AdminAnalytics> {
    const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) =>
      this.db.query<T>(sql, p).then((r) => r.rows);
    const local = (col: string) => `(${col} AT TIME ZONE '${TZ}')::date`;
    const from = `((now() AT TIME ZONE '${TZ}')::date - ($1::int - 1))`;
    const inRange = (col: string) => `${local(col)} >= ${from}`;

    const [t] = await q(
      `SELECT count(*) AS views,
              count(DISTINCT visitor_id) AS visitors,
              count(*) FILTER (WHERE kind = 'PRODUCT_VIEW') AS product_views,
              count(DISTINCT visitor_id) FILTER (WHERE ${local('occurred_at')} = (now() AT TIME ZONE '${TZ}')::date) AS today,
              (SELECT min(occurred_at) FROM analytics_events) AS since
       FROM analytics_events WHERE ${inRange('occurred_at')}`,
      [days],
    );
    const daily = await q(
      `WITH days AS (
         SELECT d::date AS day FROM generate_series(${from}, (now() AT TIME ZONE '${TZ}')::date, interval '1 day') d),
       ev AS (SELECT ${local('occurred_at')} AS day, count(*) AS views, count(DISTINCT visitor_id) AS visitors,
                     count(*) FILTER (WHERE kind = 'PRODUCT_VIEW') AS products
              FROM analytics_events WHERE ${inRange('occurred_at')} GROUP BY 1),
       acc AS (SELECT ${local('created_at')} AS day, count(*) AS n FROM users WHERE role = 'CUSTOMER' AND ${inRange('created_at')} GROUP BY 1),
       cart AS (SELECT ${local('created_at')} AS day, count(*) AS n FROM cart_items WHERE ${inRange('created_at')} GROUP BY 1),
       wish AS (SELECT ${local('created_at')} AS day, count(*) AS n FROM wishlist_items WHERE ${inRange('created_at')} GROUP BY 1),
       des AS (SELECT ${local('created_at')} AS day, count(*) AS n FROM custom_designs WHERE ${inRange('created_at')} GROUP BY 1),
       ord AS (SELECT ${local('created_at')} AS day, count(*) AS n FROM orders WHERE status <> 'DRAFT' AND ${inRange('created_at')} GROUP BY 1)
       SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
              COALESCE(ev.views, 0) AS views, COALESCE(ev.visitors, 0) AS visitors, COALESCE(ev.products, 0) AS products,
              COALESCE(acc.n, 0) AS accounts, COALESCE(cart.n, 0) AS carts, COALESCE(wish.n, 0) AS wishes,
              COALESCE(des.n, 0) AS designs, COALESCE(ord.n, 0) AS orders
       FROM days LEFT JOIN ev USING (day) LEFT JOIN acc USING (day) LEFT JOIN cart USING (day)
            LEFT JOIN wish USING (day) LEFT JOIN des USING (day) LEFT JOIN ord USING (day)
       ORDER BY days.day`,
      [days],
    );
    const topPages = await q(
      `SELECT path, count(*) AS views, count(DISTINCT visitor_id) AS visitors
       FROM analytics_events WHERE ${inRange('occurred_at')} AND kind = 'PAGE_VIEW'
       GROUP BY path ORDER BY views DESC, path LIMIT 10`,
      [days],
    );
    const topProducts = await q(
      `SELECT e.product_slug AS slug, p.name, count(*) AS views
       FROM analytics_events e LEFT JOIN products p ON p.slug = e.product_slug
       WHERE ${inRange('e.occurred_at')} AND e.kind = 'PRODUCT_VIEW'
       GROUP BY e.product_slug, p.name ORDER BY views DESC, slug LIMIT 10`,
      [days],
    );
    const referrers = await q(
      `SELECT referrer_host AS host, count(*) AS visits
       FROM analytics_events WHERE ${inRange('occurred_at')} AND referrer_host IS NOT NULL
       GROUP BY referrer_host ORDER BY visits DESC, host LIMIT 8`,
      [days],
    );
    const [eng] = await q(
      `SELECT
         (SELECT count(*) FROM users WHERE role = 'CUSTOMER' AND ${inRange('created_at')}) AS accounts,
         (SELECT count(*) FROM cart_items WHERE ${inRange('created_at')}) AS carts,
         (SELECT count(*) FROM wishlist_items WHERE ${inRange('created_at')}) AS wishes,
         (SELECT count(*) FROM custom_designs WHERE ${inRange('created_at')}) AS started,
         (SELECT count(*) FROM custom_design_versions WHERE submitted_at IS NOT NULL AND ${inRange('submitted_at')}) AS submitted,
         (SELECT count(*) FROM orders WHERE status <> 'DRAFT' AND ${inRange('created_at')}) AS orders`,
      [days],
    );
    const mix = await q(
      `SELECT status, count(*) AS n FROM orders WHERE status <> 'DRAFT' AND ${inRange('created_at')} GROUP BY status`,
      [days],
    );
    const known = new Set<string>(ORDER_STATUSES);

    return {
      generatedAt: new Date().toISOString(),
      days,
      trackingSince: iso(t?.since),
      traffic: {
        pageViews: num(t?.views),
        visitors: num(t?.visitors),
        productViews: num(t?.product_views),
        visitorsToday: num(t?.today),
      },
      daily: daily.map((r) => ({
        date: String(r.date),
        pageViews: num(r.views),
        visitors: num(r.visitors),
        productViews: num(r.products),
        newAccounts: num(r.accounts),
        cartAdds: num(r.carts),
        wishlistAdds: num(r.wishes),
        designs: num(r.designs),
        orders: num(r.orders),
      })),
      topPages: topPages.map((r) => ({
        path: String(r.path),
        views: num(r.views),
        visitors: num(r.visitors),
      })),
      topProducts: topProducts.map((r) => ({
        slug: String(r.slug),
        name: r.name ? String(r.name) : null,
        views: num(r.views),
      })),
      referrers: referrers.map((r) => ({ host: String(r.host), visits: num(r.visits) })),
      engagement: {
        newAccounts: num(eng?.accounts),
        cartAdds: num(eng?.carts),
        wishlistAdds: num(eng?.wishes),
        designsStarted: num(eng?.started),
        designsSubmitted: num(eng?.submitted),
        orders: num(eng?.orders),
      },
      statusMix: mix
        .filter((r) => known.has(String(r.status)))
        .map((r) => ({
          status: String(r.status) as AdminAnalytics['statusMix'][number]['status'],
          count: num(r.n),
        })),
    };
  }

  async users(input: {
    q?: string;
    role?: 'CUSTOMER' | 'STAFF';
    status?: 'ACTIVE' | 'DISABLED';
    page: number;
    pageSize: number;
  }): Promise<AdminUserList> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (input.q) {
      params.push(`%${input.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(
        `(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`,
      );
    }
    if (input.role)
      where.push(input.role === 'CUSTOMER' ? `u.role = 'CUSTOMER'` : `u.role <> 'CUSTOMER'`);
    if (input.status) {
      params.push(input.status);
      where.push(`u.status = $${params.length}`);
    }
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = params.length + 1;
    const rows = await this.db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.created_at, u.last_login_at,
              (u.email_verified_at IS NOT NULL) AS email_verified, (u.phone_verified_at IS NOT NULL) AS phone_verified,
              EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'google') AS has_google,
              (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
              (SELECT count(*) FROM orders o WHERE o.user_id = u.id AND o.status <> 'DRAFT') AS orders,
              COALESCE((SELECT sum(o.total_vnd) FROM orders o WHERE o.user_id = u.id AND o.status IN ${REVENUE}), 0) AS spent,
              (SELECT count(*) FROM wishlist_items w WHERE w.user_id = u.id) AS wishlist,
              (SELECT count(*) FROM custom_designs d WHERE d.user_id = u.id) AS designs,
              count(*) OVER () AS total
       FROM users u ${cond}
       ORDER BY u.created_at DESC, u.id
       LIMIT $${limit} OFFSET $${limit + 1}`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize],
    );
    const [s] = (
      await this.db.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE role = 'CUSTOMER') AS customers,
                count(*) FILTER (WHERE role <> 'CUSTOMER') AS staff,
                count(*) FILTER (WHERE status = 'DISABLED') AS disabled,
                count(*) FILTER (WHERE date_trunc('month', created_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}')) AS new_month,
                count(*) FILTER (WHERE last_login_at >= now() - interval '30 days') AS active
         FROM users`,
      )
    ).rows;
    const total = num((rows.rows[0] as { total?: unknown } | undefined)?.total);
    return {
      items: rows.rows.map((r) => {
        return {
          id: String(r.id),
          fullName: String(r.full_name),
          email: r.email ? String(r.email) : null,
          phone: r.phone ? String(r.phone) : null,
          role: String(r.role),
          status: String(r.status),
          google: Boolean(r.has_google),
          emailVerified: Boolean(r.email_verified),
          phoneVerified: Boolean(r.phone_verified),
          createdAt: iso(r.created_at)!,
          lastLoginAt: iso(r.last_login_at),
          lastSeenAt: iso(r.last_seen),
          orders: num(r.orders),
          spentVnd: num(r.spent),
          wishlist: num(r.wishlist),
          designs: num(r.designs),
        };
      }),
      summary: {
        total: num(s?.total),
        customers: num(s?.customers),
        staff: num(s?.staff),
        disabled: num(s?.disabled),
        newThisMonth: num(s?.new_month),
        activeLast30Days: num(s?.active),
      },
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
      },
    };
  }
}
