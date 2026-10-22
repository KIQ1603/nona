'use client';

import {
  addressListSchema,
  formatVnd,
  orderSchema,
  quoteSchema,
  type AddressDto,
  type QuoteDto,
} from '@nona/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { useCart } from '@/features/cart/cart-store';
import { ApiError } from '@/lib/api-client';
import { describeApiError, useCustomer } from '@/lib/customer-client';
import { CheckoutPhone } from './checkout-phone';
import { OrderSummary } from './order-summary';

const blankAddress = { fullName: '', phone: '', line1: '', ward: '', district: '', province: '' };
type Notice = { kind: 'info' | 'error'; text: string; items?: string[] };
type Method = 'COD' | 'VNPAY';

export function CheckoutForm({ lineIds }: { lineIds?: string[] }) {
  const router = useRouter();
  const { request, status, user } = useCustomer();
  const { cart, refresh: refreshCart } = useCart();
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [saved, setSaved] = useState<AddressDto[]>([]);
  const [addressId, setAddressId] = useState<string | 'new'>('new');
  const [address, setAddress] = useState(blankAddress);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<Method>('COD');
  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [phoneOk, setPhoneOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const attempt = useRef<{ hash: string; key: string } | null>(null);

  const useSaved = status === 'user' && addressId !== 'new';
  const province =
    (useSaved ? saved.find((a) => a.id === addressId)?.province : address.province)?.trim() ?? '';

  const loadQuote = useCallback(async () => {
    try {
      setQuote(
        quoteSchema.parse(
          await request('POST', '/checkout/quote', {
            ...(province ? { province } : {}),
            ...(lineIds ? { lineIds } : {}),
          }),
        ),
      );
    } catch (e) {
      setNotice({ kind: 'error', text: describeApiError(e) });
    }
  }, [request, province, lineIds]);

  // Re-quote whenever the cart or the destination changes, so every amount shown comes from the server.
  useEffect(() => {
    if (status === 'loading') return;
    const timer = window.setTimeout(() => void loadQuote(), 350);
    return () => window.clearTimeout(timer);
  }, [status, cart.itemCount, cart.subtotalVnd, loadQuote]);

  useEffect(() => {
    if (status !== 'user') return;
    request('GET', '/me/addresses')
      .then((raw) => {
        const items = addressListSchema.parse(raw).items;
        setSaved(items);
        setAddressId(items.find((a) => a.isDefault)?.id ?? items[0]?.id ?? 'new');
      })
      .catch(() => undefined);
  }, [status, request]);

  if (status === 'loading' || !quote)
    return (
      <div className="checkout-page" role="status">
        <p>Đang tải…</p>
      </div>
    );
  if (quote.lines.length === 0 && !submitting) {
    return (
      <div className="checkout-page">
        <EmptyState title="Giỏ hàng đang trống">
          <p>Hãy chọn vài chiếc nón trước khi thanh toán nhé.</p>
          <Link className="btn btn-dark" href="/shop">
            Đến cửa hàng
          </Link>
        </EmptyState>
      </div>
    );
  }

  const set = (k: keyof typeof blankAddress, v: string) => setAddress({ ...address, [k]: v });

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponBusy(true);
    setCouponMessage(null);
    try {
      await request('POST', '/cart/coupon', { code: couponInput });
      setCouponInput('');
      await loadQuote();
    } catch (e) {
      setCouponMessage(describeApiError(e));
    } finally {
      setCouponBusy(false);
    }
  };
  const removeCoupon = async () => {
    setCouponBusy(true);
    try {
      await request('DELETE', '/cart/coupon');
      setCouponMessage(null);
      await loadQuote();
    } finally {
      setCouponBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !quote.canCheckout) return;
    const payload = {
      ...(useSaved ? { addressId } : { shippingAddress: address }),
      ...(status === 'user' ? {} : { contactEmail: email }),
      ...(note.trim() ? { customerNote: note.trim() } : {}),
      paymentMethod: method,
      ...(lineIds ? { lineIds } : {}),
      expectedTotalVnd: quote.totalVnd,
    };
    // Same payload => same key, so a retry after a network error can never create a second order.
    const hash = JSON.stringify(payload);
    if (attempt.current?.hash !== hash) attempt.current = { hash, key: crypto.randomUUID() };

    setSubmitting(true);
    setNotice(null);
    try {
      const raw = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': attempt.current.key,
          ...(user ? { 'x-csrf-token': user.csrfToken } : {}),
        },
        body: hash,
      }).catch(() => {
        throw new ApiError(
          0,
          'NETWORK_ERROR',
          'Mất kết nối. Đơn hàng chưa được gửi — bạn có thể bấm đặt hàng lại một cách an toàn.',
        );
      });
      const body = await raw.json().catch(() => null);
      if (!raw.ok)
        throw Object.assign(
          new ApiError(
            raw.status,
            body?.error?.code ?? 'INTERNAL_ERROR',
            body?.error?.message ?? 'Không thể đặt hàng.',
          ),
          { details: body?.error?.details },
        );
      const order = orderSchema.parse(body);
      await refreshCart();
      if (order.paymentUrl) {
        window.location.assign(order.paymentUrl); // hand over to the payment gateway
        return;
      }
      router.push(`/don-hang/${order.code}?moi=1`);
    } catch (error) {
      const err = error as ApiError & {
        details?: {
          currentTotalVnd?: number;
          couponIssue?: { message: string } | null;
          items?: { productName: string; reason: string; available: number }[];
        };
      };
      if (err.code === 'PRICE_CHANGED') {
        await loadQuote();
        setNotice({
          kind: 'info',
          text: `Giá, phí vận chuyển hoặc ưu đãi đã thay đổi. Tổng mới: ${formatVnd(err.details?.currentTotalVnd ?? 0)}.${err.details?.couponIssue ? ` ${err.details.couponIssue.message}` : ''} Vui lòng kiểm tra rồi bấm đặt hàng lần nữa.`,
        });
      } else if (err.code === 'INVENTORY_INSUFFICIENT') {
        await Promise.all([loadQuote(), refreshCart()]);
        setNotice({
          kind: 'error',
          text: 'Một số sản phẩm không còn đủ số lượng:',
          items: err.details?.items?.map(
            (i) =>
              `${i.productName}: ${i.reason === 'UNAVAILABLE' ? 'ngừng bán' : i.available === 0 ? 'đã hết hàng' : `chỉ còn ${i.available}`}`,
          ),
        });
      } else {
        setNotice({ kind: 'error', text: describeApiError(error) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkout-page">
      <h1>Thanh toán</h1>
      <form className="checkout-grid account-form" onSubmit={submit}>
        <div>
          {status !== 'user' && (
            <p className="panel-note">
              Đã có tài khoản? <Link href="/dang-nhap?next=/thanh-toan">Đăng nhập</Link> để dùng địa
              chỉ đã lưu. Bạn cũng có thể đặt hàng không cần tài khoản.
            </p>
          )}
          <section className="panel">
            <h2>Thông tin giao hàng</h2>
            {status !== 'user' && (
              <label className="field">
                <span>Email nhận xác nhận đơn hàng</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {status === 'user' && saved.length > 0 && (
              <fieldset className="address-choice">
                <legend className="sr-only">Chọn địa chỉ</legend>
                {saved.map((a) => (
                  <label key={a.id} className={`choice${addressId === a.id ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name="addr"
                      checked={addressId === a.id}
                      onChange={() => setAddressId(a.id)}
                    />
                    <span>
                      <strong>{a.fullName}</strong> · {a.phone}
                      <br />
                      {a.line1}, {a.ward}, {a.district}, {a.province}
                    </span>
                  </label>
                ))}
                <label className={`choice${addressId === 'new' ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="addr"
                    checked={addressId === 'new'}
                    onChange={() => setAddressId('new')}
                  />
                  <span>Giao đến địa chỉ khác</span>
                </label>
              </fieldset>
            )}
            {!useSaved && (
              <>
                <div className="form-grid">
                  <label className="field">
                    <span>Họ tên người nhận</span>
                    <input
                      autoComplete="name"
                      required
                      maxLength={100}
                      value={address.fullName}
                      onChange={(e) => set('fullName', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Số điện thoại</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      value={address.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="0901234567"
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Số nhà, đường</span>
                  <input
                    autoComplete="address-line1"
                    required
                    maxLength={200}
                    value={address.line1}
                    onChange={(e) => set('line1', e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Phường/Xã</span>
                    <input
                      required
                      maxLength={100}
                      value={address.ward}
                      onChange={(e) => set('ward', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Quận/Huyện</span>
                    <input
                      required
                      maxLength={100}
                      value={address.district}
                      onChange={(e) => set('district', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Tỉnh/Thành phố</span>
                    <input
                      required
                      maxLength={100}
                      value={address.province}
                      onChange={(e) => set('province', e.target.value)}
                    />
                    <small>Phí vận chuyển có thể thay đổi theo khu vực.</small>
                  </label>
                </div>
              </>
            )}
            {quote.phoneVerificationRequired && (
              <CheckoutPhone
                phone={
                  useSaved ? (saved.find((a) => a.id === addressId)?.phone ?? '') : address.phone
                }
                onVerified={setPhoneOk}
              />
            )}
            <label className="field">
              <span>Ghi chú cho cửa hàng (tùy chọn)</span>
              <textarea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </section>

          <section className="panel">
            <h2>Phương thức thanh toán</h2>
            <fieldset className="address-choice">
              <legend className="sr-only">Chọn phương thức thanh toán</legend>
              <label className={`choice${method === 'COD' ? ' on' : ''}`}>
                <input
                  type="radio"
                  name="method"
                  checked={method === 'COD'}
                  onChange={() => setMethod('COD')}
                />
                <span>
                  <strong>Thanh toán khi nhận hàng (COD)</strong>
                  <br />
                  Bạn trả tiền mặt cho nhân viên giao hàng.
                </span>
              </label>
              <label className={`choice${method === 'VNPAY' ? ' on' : ''}`}>
                <input
                  type="radio"
                  name="method"
                  checked={method === 'VNPAY'}
                  onChange={() => setMethod('VNPAY')}
                />
                <span>
                  <strong>Thanh toán trực tuyến qua VNPay</strong>
                  <br />
                  Thẻ ATM nội địa, thẻ quốc tế hoặc QR. Hàng được giữ cho bạn trong thời gian thanh
                  toán.
                </span>
              </label>
            </fieldset>
          </section>
        </div>

        <div className="checkout-side">
          <section className="panel coupon-box" aria-labelledby="coupon-title">
            <h2 id="coupon-title" style={{ fontSize: 17, margin: '0 0 10px' }}>
              Mã giảm giá
            </h2>
            {quote.coupon ? (
              <div className="coupon-applied">
                <span>
                  <strong>{quote.coupon.code}</strong>
                  {quote.coupon.description ? ` — ${quote.coupon.description}` : ''}
                </span>
                <button
                  className="link-button"
                  type="button"
                  disabled={couponBusy}
                  onClick={removeCoupon}
                >
                  Bỏ mã
                </button>
              </div>
            ) : (
              <div className="coupon-row">
                <input
                  aria-label="Mã giảm giá"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  maxLength={32}
                  placeholder="Nhập mã"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void applyCoupon();
                    }
                  }}
                />
                <button
                  className="btn btn-outline-site btn-sm-site"
                  type="button"
                  disabled={couponBusy || !couponInput.trim()}
                  onClick={applyCoupon}
                >
                  Áp dụng
                </button>
              </div>
            )}
            {(couponMessage || quote.couponIssue) && (
              <p className="form-error" role="alert" style={{ marginTop: 10 }}>
                {couponMessage ?? quote.couponIssue?.message}
              </p>
            )}
          </section>

          <OrderSummary quote={quote} />
          {notice && (
            <div className={`form-${notice.kind === 'error' ? 'error' : 'note'}`} role="alert">
              {notice.text}
              {notice.items && (
                <ul>
                  {notice.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
              {notice.kind === 'error' && notice.items && (
                <p>
                  <Link href="/gio-hang">Cập nhật giỏ hàng →</Link>
                </p>
              )}
            </div>
          )}
          {!quote.canCheckout && quote.blockers.length > 0 && (
            <div className="form-error" role="alert">
              <ul>
                {quote.blockers.map((b) => (
                  <li key={b.code + (b.lineId ?? '')}>{b.message}</li>
                ))}
              </ul>
              <p>
                <Link href="/gio-hang">Quay lại giỏ hàng →</Link>
              </p>
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={
              submitting || !quote.canCheckout || (quote.phoneVerificationRequired && !phoneOk)
            }
          >
            {submitting
              ? 'Đang xử lý…'
              : method === 'VNPAY'
                ? `Thanh toán · ${formatVnd(quote.totalVnd)}`
                : `Đặt hàng · ${formatVnd(quote.totalVnd)}`}
          </button>
          {quote.phoneVerificationRequired && !phoneOk && (
            <small className="fine-print phone-need">
              Hãy xác thực số điện thoại nhận hàng để đặt hàng.
            </small>
          )}
          <small className="fine-print">
            Bằng việc đặt hàng, bạn đồng ý để NONA liên hệ giao hàng theo thông tin trên.
          </small>
        </div>
      </form>
    </div>
  );
}
