import { z } from 'zod';

const money = z.number().int();
const count = z.number().int();

/** Admin overview: every figure is computed by the backend from orders, designs and stock. */
export const adminDashboardSchema = z.object({
  generatedAt: z.string(),
  kpis: z.object({
    revenueTodayVnd: money,
    revenueMonthVnd: money,
    revenuePrevMonthVnd: money,
    ordersMonth: count,
    ordersPrevMonth: count,
    averageOrderVnd: money,
    designsMonth: count,
    designsPrevMonth: count,
    awaitingAction: count,
    lowStock: count,
    customers: count,
  }),
  /** Last 30 days, one point per day (zero-filled). */
  daily: z.array(z.object({ date: z.string(), revenueVnd: money, orders: count, designs: count })),
  /** Last 12 ISO weeks (Monday start). */
  weekly: z.array(z.object({ start: z.string(), revenueVnd: money, orders: count })),
  /** Last 12 months. */
  monthly: z.array(
    z.object({ month: z.string(), revenueVnd: money, orders: count, designs: count }),
  ),
  statusBreakdown: z.array(z.object({ status: z.string(), count })),
  paymentMix: z.array(z.object({ method: z.string(), orders: count, revenueVnd: money })),
  topProducts: z.array(
    z.object({ name: z.string(), quantity: count, revenueVnd: money, custom: count }),
  ),
  designs: z.object({
    totalMonth: count,
    orderedMonth: count,
    byStatus: z.array(z.object({ status: z.string(), count })),
  }),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
