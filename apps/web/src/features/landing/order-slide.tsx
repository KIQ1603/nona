'use client';

import { formatVnd, type ContactSettings, type LandingContent } from '@nona/contracts';
import { useCart } from '@/features/cart/cart-store';
import { hatSVG } from './hat-svg';
import { LeaveLink as Link } from './leave';

const BG_HAT = hatSVG({ straw: ['#fff', '#fff', '#fff'], strap: '#fff', deco: 'band' }, 'bg');
const display = (url: string) => url.replace(/^(mailto:|tel:|https:\/\/)/i, '').replace(/\/$/, '');

/** Final slide: the real cart (backend totals) and a hand-off to the real checkout. */
export function OrderSlide({
  content,
  contact,
  freeShippingThresholdVnd,
  onPickProducts,
}: {
  content: LandingContent['order'];
  contact: ContactSettings;
  freeShippingThresholdVnd: number | null;
  onPickProducts: () => void;
}) {
  const { cart, loading, busy, setQuantity } = useCart();
  const channels = contact.channels.filter((c) => c.enabled);
  const canCheckout = cart.lines.some((l) => l.purchasable);

  return (
    <>
      <div className="lp-bghat" dangerouslySetInnerHTML={{ __html: BG_HAT }} />
      <div className="lp-inner">
        <div className="lp-wrap lp-grid cols-2" style={{ gap: 32 }}>
          <div>
            <div className="lp-eyebrow" data-a>
              {content.eyebrow}
            </div>
            <h2 className="lp-h2 lp-fd" data-a>
              {content.titleTop}
              {content.titleTop && <br />}
              <em>{content.titleAccent}</em> {content.titleBottom}
            </h2>
            <p className="lp-lead" data-a>
              {content.text}
              {freeShippingThresholdVnd !== null &&
                ` Miễn phí vận chuyển cho đơn từ ${formatVnd(freeShippingThresholdVnd)}.`}
            </p>
            <div className="lp-infos" data-a>
              {contact.address && (
                <div>
                  <span className="ic">📍</span>
                  {contact.address}
                </div>
              )}
              {channels.length > 0 && (
                <div>
                  <span className="ic">📞</span>
                  <span>
                    {channels.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ' · '}
                        <a
                          href={c.url}
                          rel="noopener noreferrer"
                          target={c.url.startsWith('https://') ? '_blank' : undefined}
                          style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
                          title={display(c.url)}
                        >
                          {c.label}
                        </a>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {contact.hours && (
                <div>
                  <span className="ic">🕗</span>
                  {contact.hours}
                </div>
              )}
            </div>
          </div>

          <div className="lp-ordercard" data-a="right">
            <h3>Đơn hàng của bạn</h3>
            <div className="lp-lines">
              {loading ? (
                <div className="lp-empty">Đang tải giỏ hàng…</div>
              ) : cart.lines.length === 0 ? (
                <div className="lp-empty">
                  Giỏ hàng đang trống.
                  <br />
                  <button type="button" onClick={onPickProducts}>
                    Chọn mẫu nón yêu thích →
                  </button>
                </div>
              ) : (
                cart.lines.map((l) => (
                  <div className="lp-line-row" key={l.id}>
                    <span className="thumb">{l.image && <img src={l.image.url} alt="" />}</span>
                    <div className="info">
                      <div className="name">{l.productName}</div>
                      <div className="sub">
                        {l.variantName !== 'Tiêu chuẩn' && `${l.variantName} · `}
                        {formatVnd(l.unitPriceVnd)}
                        {l.design && ' · Thiết kế riêng'}
                      </div>
                      {l.issue && <div className="note">Không thể đặt hàng dòng này</div>}
                    </div>
                    <div className="lp-qty">
                      <button
                        type="button"
                        className="lp-qbtn"
                        aria-label="Giảm"
                        disabled={busy}
                        onClick={() => setQuantity(l.id, l.quantity - 1)}
                      >
                        −
                      </button>
                      <span>{l.quantity}</span>
                      <button
                        type="button"
                        className="lp-qbtn"
                        aria-label="Tăng"
                        disabled={busy || !l.purchasable}
                        onClick={() => setQuantity(l.id, l.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cart.lines.length > 0 && (
              <div className="lp-total">
                <span>Tạm tính</span>
                <strong>{formatVnd(cart.subtotalVnd)}</strong>
              </div>
            )}
            <Link
              className={`lp-btn lp-btn-p${canCheckout ? '' : ' disabled'}`}
              href={canCheckout ? '/thanh-toan' : '#'}
              aria-disabled={!canCheckout}
              onClick={(e) => !canCheckout && e.preventDefault()}
            >
              Tiến hành thanh toán
            </Link>
            <Link className="lp-btn lp-btn-g" href="/shop">
              Xem toàn bộ cửa hàng
            </Link>
          </div>
        </div>
      </div>
      <div className="lp-copyright">
        © {new Date().getFullYear()} NONA · LÀM BẰNG TAY, GỬI BẰNG TÂM
      </div>
    </>
  );
}
