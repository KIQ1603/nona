import type { Metadata } from 'next';
import { CheckoutForm } from '@/features/checkout/checkout-form';

export const metadata: Metadata = { title: 'Thanh toán', robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).chon;
  // ?chon=id1,id2 : pay only for these cart lines; nothing = the whole cart
  const ids = (Array.isArray(raw) ? raw[0] : raw)
    ?.split(',')
    .filter((v) => UUID.test(v))
    .slice(0, 100);
  return <CheckoutForm lineIds={ids && ids.length ? ids : undefined} />;
}
