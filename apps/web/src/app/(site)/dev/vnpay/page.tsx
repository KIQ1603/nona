import { notFound } from 'next/navigation';
import { SimulatorPage } from '@/features/checkout/vnpay-simulator';
import { API_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VNPay (giả lập)', robots: { index: false, follow: false } };

/** Development-only stand-in for VNPay's hosted page. 404s unless the API runs with PAYMENTS_MODE=simulator. */
export default async function VnpaySimulator({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp))
    if (typeof v === 'string' && k.startsWith('vnp_')) params.set(k, v);
  const res = await fetch(`${API_URL}/v1/dev/vnpay/transaction?${params}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res || !res.ok) notFound(); // disabled in production, or not a valid simulated payment URL
  const tx = (await res.json()) as {
    txnRef: string;
    amountVnd: number;
    orderInfo: string;
    status: string;
  };
  return <SimulatorPage tx={tx} />;
}
