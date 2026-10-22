import { adminOrderDetailSchema } from '@nona/contracts';
import { notFound } from 'next/navigation';
import { OrderDetail } from '@/features/admin/order-detail';
import { adminGet } from '@/lib/admin-server';
import { ApiError } from '@/lib/api-client';

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await adminGet(`/admin/orders/${id}`, adminOrderDetailSchema).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  // re-mount when the design approvals change, so the page never shows a stale "waiting for design" state
  return <OrderDetail key={`${order.version}-${order.pendingDesigns.length}`} initial={order} />;
}
