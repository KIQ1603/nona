import { formatVnd, type QuoteDto } from '@nona/contracts';

/** Read-only presentation of the backend quote. No amount here is calculated in the browser. */
export function OrderSummary({ quote }: { quote: QuoteDto }) {
  const { freeShipping } = quote;
  return (
    <aside className="summary-card" aria-labelledby="summary-title">
      <h2 id="summary-title">Đơn hàng của bạn</h2>
      <ul className="summary-lines">
        {quote.lines.map((l) => (
          <li key={l.id}>
            <div className="thumb-sm">
              {l.image && <img src={l.image.url} alt="" width={56} height={56} loading="lazy" />}
            </div>
            <div>
              <strong>{l.productName}</strong>
              {l.design && <small>Thiết kế riêng</small>}
              <small>
                {l.variantName !== 'Tiêu chuẩn' ? `${l.variantName} · ` : ''}SL {l.quantity}
              </small>
              {l.issue && (
                <small className="issue">
                  Không thể đặt:{' '}
                  {l.issue === 'INSUFFICIENT_STOCK'
                    ? `chỉ còn ${l.availableQuantity}`
                    : l.issue === 'OUT_OF_STOCK'
                      ? 'hết hàng'
                      : l.issue === 'DESIGN_UNAVAILABLE'
                        ? 'thiết kế không còn hiệu lực'
                        : 'ngừng bán'}
                </small>
              )}
            </div>
            <span>{formatVnd(l.lineTotalVnd)}</span>
          </li>
        ))}
      </ul>
      <dl className="summary-totals">
        <div>
          <dt>Tạm tính</dt>
          <dd>{formatVnd(quote.subtotalVnd)}</dd>
        </div>
        {quote.discountVnd > 0 && (
          <div>
            <dt>Giảm giá{quote.coupon ? ` (${quote.coupon.code})` : ''}</dt>
            <dd>−{formatVnd(quote.discountVnd)}</dd>
          </div>
        )}
        <div>
          <dt>Phí vận chuyển{quote.shippingZone ? ` (${quote.shippingZone})` : ''}</dt>
          <dd>{quote.shippingFeeVnd === 0 ? 'Miễn phí' : formatVnd(quote.shippingFeeVnd)}</dd>
        </div>
        <div className="grand">
          <dt>Tổng cộng</dt>
          <dd>{formatVnd(quote.totalVnd)}</dd>
        </div>
      </dl>
      {freeShipping.remainingVnd !== null &&
        freeShipping.remainingVnd > 0 &&
        quote.lines.length > 0 && (
          <p className="free-ship-hint">
            Mua thêm {formatVnd(freeShipping.remainingVnd)} để được miễn phí vận chuyển.
          </p>
        )}
    </aside>
  );
}
