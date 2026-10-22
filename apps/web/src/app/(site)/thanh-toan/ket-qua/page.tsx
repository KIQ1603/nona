import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Kết quả thanh toán',
  robots: { index: false },
  referrer: 'no-referrer',
};

/**
 * The payment gateway sends the shopper's browser here. We deliberately ignore the result in the query
 * string: only the order code is taken from the transaction reference, and the order page then shows the
 * state the server verified (IPN/reconciliation). A forged return URL therefore cannot mark anything paid.
 */
export default async function PaymentReturn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ref = Array.isArray(sp.vnp_TxnRef) ? sp.vnp_TxnRef[0] : sp.vnp_TxnRef;
  const code = ref && /^[0-9A-Z]{14}$/.test(ref) ? ref.slice(0, 12) : null;
  redirect(code ? `/don-hang/${code}?tt=1` : '/tai-khoan/don-hang');
}
