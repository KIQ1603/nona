import { describe, expect, it } from 'vitest';
import { renderEmail } from './templates';

const ctx = { webOrigin: 'https://nona.vn/' };
const order = {
  orderCode: 'AB12CD34EF56',
  customerName: 'Nguyễn <b>A</b>',
  paymentMethod: 'COD',
  items: [{ name: 'Nón "Sen"', variant: 'Size M', quantity: 2, lineTotalVnd: 780_000 }],
  subtotalVnd: 780_000,
  discountVnd: 0,
  shippingFeeVnd: 0,
  totalVnd: 780_000,
  address: {
    fullName: 'A',
    phone: '0901234567',
    line1: '1 <script>x</script>',
    ward: 'w',
    district: 'd',
    province: 'p',
  },
};

describe('renderEmail', () => {
  it('renders the order confirmation with the grouped code, totals and a tracking link', () => {
    const m = renderEmail('order.placed', order, ctx)!;
    expect(m.subject).toContain('AB12-CD34-EF56');
    expect(m.text).toContain('780.000đ');
    expect(m.text).toContain('Miễn phí');
    expect(m.text).toContain('https://nona.vn/don-hang/AB12CD34EF56');
  });
  it('escapes every dynamic value in HTML', () => {
    const html = renderEmail('order.placed', order, ctx)!.html;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>A</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Nón &quot;Sen&quot;');
  });
  it('renders status updates and ignores statuses that need no email', () => {
    expect(
      renderEmail(
        'order.status_changed',
        {
          orderCode: 'AB12CD34EF56',
          customerName: 'A',
          status: 'SHIPPING',
          carrier: 'GHN',
          trackingCode: 'X1',
        },
        ctx,
      )!.text,
    ).toContain('mã vận đơn X1');
    expect(
      renderEmail(
        'order.status_changed',
        { orderCode: 'AB12CD34EF56', customerName: 'A', status: 'CANCELLED', reason: 'Hết hàng' },
        ctx,
      )!.text,
    ).toContain('Lý do: Hết hàng');
    expect(
      renderEmail(
        'order.status_changed',
        { orderCode: 'AB12CD34EF56', customerName: 'A', status: 'PROCESSING' },
        ctx,
      ),
    ).toBeNull();
  });
  it('renders the password reset link under the configured origin only', () => {
    const m = renderEmail(
      'auth.password_reset',
      { fullName: 'A', resetPath: '/dat-lai-mat-khau?token=abc' },
      ctx,
    )!;
    expect(m.text).toContain('https://nona.vn/dat-lai-mat-khau?token=abc');
  });
  it('returns null for unknown event types', () => {
    expect(renderEmail('nope', {}, ctx)).toBeNull();
  });
  it('renders the sign-up, email-code and password-changed notices', () => {
    const w = renderEmail(
      'auth.welcome',
      { fullName: 'Lan <i>', code: '123456', ttlMinutes: 10 },
      ctx,
    )!;
    expect(w.subject).toContain('Đăng ký thành công');
    expect(w.text).toContain('123456');
    expect(w.html).not.toContain('<i>');
    const o = renderEmail(
      'auth.email_otp',
      { fullName: 'Lan', code: '654321', ttlMinutes: 10 },
      ctx,
    )!;
    expect(o.subject).toContain('654321');
    const c = renderEmail('auth.password_changed', { fullName: 'Lan', how: 'reset' }, ctx)!;
    expect(c.text).toContain('đặt lại');
    expect(c.text).toContain('https://nona.vn/quen-mat-khau');
    expect(renderEmail('auth.welcome', { fullName: 'Lan' }, ctx)!.text).not.toContain(
      'Mã xác thực',
    );
  });
});
