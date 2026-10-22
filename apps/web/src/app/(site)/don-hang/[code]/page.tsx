import { orderSchema } from '@nona/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderView } from '@/features/orders/order-view';
import { authHeaders } from '@/lib/admin-server';
import { API_URL } from '@/lib/env';

export const metadata: Metadata = { title: 'Đơn hàng', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ moi?: string; tt?: string }>;
}) {
  const { code } = await params;
  const res = await fetch(`${API_URL}/v1/orders/${encodeURIComponent(code)}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 404) notFound();
  if (res.status === 429)
    throw new Error('Bạn tra cứu quá nhiều lần. Vui lòng thử lại sau ít phút.');
  if (!res.ok) throw new Error('Không thể tải đơn hàng.');
  const order = orderSchema.parse(await res.json());
  const sp = await searchParams;
  return <OrderView order={order} justPlaced={sp.moi === '1'} returning={sp.tt === '1'} />;
}
