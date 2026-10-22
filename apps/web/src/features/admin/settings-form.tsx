'use client';

import { formatVnd, type AdminSettings, type ShippingZone } from '@nona/contracts';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

interface ZoneDraft {
  name: string;
  provinces: string;
  fee: string;
  threshold: string;
}
const toDraft = (z: ShippingZone): ZoneDraft => ({
  name: z.name,
  provinces: z.provinces.join(', '),
  fee: String(z.flatFeeVnd),
  threshold: z.freeShippingThresholdVnd === null ? '' : String(z.freeShippingThresholdVnd),
});
const toZone = (d: ZoneDraft): ShippingZone => ({
  name: d.name.trim(),
  provinces: d.provinces
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean),
  flatFeeVnd: Math.floor(Number(d.fee) || 0),
  freeShippingThresholdVnd: d.threshold.trim() === '' ? null : Math.floor(Number(d.threshold)),
});

export function SettingsForm({ initial }: { initial: AdminSettings }) {
  const { request } = useAdmin();
  const toast = useToast();
  const [settings, setSettings] = useState(initial);
  const [a, setA] = useState({
    enabled: initial.announcement.enabled,
    text: initial.announcement.text,
    linkUrl: initial.announcement.linkUrl ?? '',
  });
  const [threshold, setThreshold] = useState<string>(
    initial.shipping.freeShippingThresholdVnd === null
      ? ''
      : String(initial.shipping.freeShippingThresholdVnd),
  );
  const [fee, setFee] = useState(String(initial.shipping.flatFeeVnd));
  const [zones, setZones] = useState<ZoneDraft[]>(initial.shipping.zones.map(toDraft));
  const [windowMin, setWindowMin] = useState(String(initial.checkout.paymentWindowMinutes));
  const [requirePhone, setRequirePhone] = useState(initial.checkout.requirePhoneVerification);
  const ann = useAction();
  const ship = useAction();
  const chk = useAction();

  const saveAnnouncement = async (e: FormEvent) => {
    e.preventDefault();
    const res = await ann.run(() =>
      request<AdminSettings>('PATCH', '/admin/settings/announcement', {
        version: settings.announcement.version,
        value: { enabled: a.enabled, text: a.text.trim(), linkUrl: a.linkUrl.trim() || null },
      }),
    );
    if (res) {
      setSettings(res);
      toast('Đã lưu thông báo. Cửa hàng cập nhật ngay.');
    }
  };
  const saveShipping = async (e: FormEvent) => {
    e.preventDefault();
    const res = await ship.run(() =>
      request<AdminSettings>('PATCH', '/admin/settings/shipping', {
        version: settings.shipping.version,
        value: {
          freeShippingThresholdVnd: threshold.trim() === '' ? null : Math.floor(Number(threshold)),
          flatFeeVnd: Math.floor(Number(fee) || 0),
          zones: zones.map(toZone),
        },
      }),
    );
    if (res) {
      setSettings(res);
      toast('Đã lưu cấu hình vận chuyển');
    }
  };
  const saveCheckout = async (e: FormEvent) => {
    e.preventDefault();
    const res = await chk.run(() =>
      request<AdminSettings>('PATCH', '/admin/settings/checkout', {
        version: settings.checkout.version,
        value: {
          paymentWindowMinutes: Math.floor(Number(windowMin) || 0),
          requirePhoneVerification: requirePhone,
        },
      }),
    );
    if (res) {
      setSettings(res);
      toast('Đã lưu cấu hình đặt hàng');
    }
  };
  const setZone = (i: number, patch: Partial<ZoneDraft>) =>
    setZones((zs) => zs.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const feeNumber = Math.floor(Number(fee) || 0);
  const thresholdNumber = Math.floor(Number(threshold) || 0);

  return (
    <>
      <form className="admin-card" onSubmit={saveAnnouncement}>
        <h2>Thanh thông báo đầu trang</h2>
        <label className="row-inline field">
          <input
            type="checkbox"
            checked={a.enabled}
            onChange={(e) => setA({ ...a, enabled: e.target.checked })}
          />{' '}
          <span>Hiển thị thanh thông báo</span>
        </label>
        <label className="field">
          <span>Nội dung</span>
          <input
            value={a.text}
            maxLength={160}
            onChange={(e) => setA({ ...a, text: e.target.value })}
            placeholder="VD: Miễn phí vận chuyển cho đơn từ 600.000đ"
          />
          <small>Tối đa 160 ký tự. Văn bản thuần.</small>
        </label>
        <label className="field">
          <span>Liên kết (tùy chọn)</span>
          <input
            value={a.linkUrl}
            maxLength={300}
            onChange={(e) => setA({ ...a, linkUrl: e.target.value })}
            placeholder="/shop hoặc https://…"
          />
          <small>Chỉ cho phép đường dẫn nội bộ (bắt đầu bằng “/”) hoặc https://.</small>
        </label>
        {ann.error && (
          <p className="form-error" role="alert">
            {ann.error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={ann.pending}>
          Lưu thông báo
        </button>
      </form>

      <form className="admin-card" onSubmit={saveShipping}>
        <h2>Phí vận chuyển</h2>
        <div className="form-row">
          <label className="field">
            <span>Phí mặc định (VNĐ)</span>
            <input
              type="number"
              min={0}
              step={1000}
              required
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
            <small>
              Áp dụng khi tỉnh/thành không thuộc vùng nào bên dưới. Nhập 0 để luôn miễn phí.
            </small>
          </label>
          <label className="field">
            <span>Ngưỡng miễn phí mặc định (VNĐ)</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Để trống = không có ưu đãi"
            />
            <small>
              {threshold.trim() === ''
                ? 'Hiện không áp dụng miễn phí vận chuyển.'
                : `Đơn từ ${formatVnd(thresholdNumber)} được miễn phí vận chuyển.`}
            </small>
          </label>
        </div>

        <h3 style={{ margin: '18px 0 8px', fontSize: 16 }}>
          Vùng giao hàng riêng{' '}
          <small style={{ fontWeight: 400, color: 'var(--color-muted)' }}>
            (tùy chọn, tối đa 20)
          </small>
        </h3>
        {zones.length === 0 && (
          <p className="form-note">Chưa có vùng riêng — mọi đơn dùng phí mặc định.</p>
        )}
        {zones.map((z, i) => (
          <fieldset key={i} className="zone-card">
            <legend>Vùng {i + 1}</legend>
            <div className="form-row">
              <label className="field">
                <span>Tên vùng</span>
                <input
                  value={z.name}
                  maxLength={60}
                  required
                  onChange={(e) => setZone(i, { name: e.target.value })}
                  placeholder="VD: Nội thành HCM"
                />
              </label>
              <label className="field">
                <span>Phí vùng (VNĐ)</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  required
                  value={z.fee}
                  onChange={(e) => setZone(i, { fee: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Ngưỡng miễn phí (VNĐ)</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={z.threshold}
                  onChange={(e) => setZone(i, { threshold: e.target.value })}
                  placeholder="Để trống = không có"
                />
              </label>
            </div>
            <label className="field">
              <span>Tỉnh/Thành phố thuộc vùng (cách nhau bằng dấu phẩy)</span>
              <textarea
                required
                value={z.provinces}
                onChange={(e) => setZone(i, { provinces: e.target.value })}
                placeholder="Hồ Chí Minh, Hà Nội"
              />
              <small>Không phân biệt hoa/thường và dấu. Vùng đầu tiên khớp sẽ được dùng.</small>
            </label>
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => setZones((zs) => zs.filter((_, j) => j !== i))}
            >
              Xóa vùng
            </button>
          </fieldset>
        ))}
        {zones.length < 20 && (
          <button
            className="btn btn-outline btn-sm"
            type="button"
            onClick={() =>
              setZones((zs) => [...zs, { name: '', provinces: '', fee: '0', threshold: '' }])
            }
          >
            + Thêm vùng
          </button>
        )}

        <p className="form-note" style={{ marginTop: 14 }}>
          Hệ thống đặt hàng dùng đúng các giá trị này để tính phí: đơn dưới ngưỡng trả{' '}
          {formatVnd(feeNumber)} (hoặc phí của vùng tương ứng). Khách không thể tự thay đổi.
        </p>
        {ship.error && (
          <p className="form-error" role="alert">
            {ship.error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={ship.pending}>
          Lưu cấu hình vận chuyển
        </button>
      </form>

      <form className="admin-card" onSubmit={saveCheckout}>
        <h2>Đặt hàng và thanh toán</h2>
        <label className="row-inline field">
          <input
            type="checkbox"
            checked={requirePhone}
            onChange={(e) => setRequirePhone(e.target.checked)}
          />{' '}
          <span>
            <strong>Bắt buộc xác thực số điện thoại (OTP qua Zalo) trước khi đặt hàng</strong>
            <small style={{ display: 'block' }}>
              Khách phải nhập mã OTP gửi đến số nhận hàng. Tắt mục này nếu chưa cấu hình Zalo ZNS.
            </small>
          </span>
        </label>
        <label className="field">
          <span>Thời gian giữ hàng khi thanh toán (phút)</span>
          <input
            type="number"
            min={5}
            max={1440}
            required
            value={windowMin}
            onChange={(e) => setWindowMin(e.target.value)}
          />
          <small>
            Khách có chừng này thời gian để hoàn tất thanh toán VNPay; quá hạn đơn tự hết hạn và
            hàng được trả về kho. Từ 5 đến 1440 phút.
          </small>
        </label>
        {chk.error && (
          <p className="form-error" role="alert">
            {chk.error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={chk.pending}>
          Lưu
        </button>
      </form>
      <p className="form-note">
        Mã giảm giá được quản lý ở mục{' '}
        <a href="/admin/coupons" style={{ textDecoration: 'underline' }}>
          Mã giảm giá
        </a>
        .
      </p>
    </>
  );
}
