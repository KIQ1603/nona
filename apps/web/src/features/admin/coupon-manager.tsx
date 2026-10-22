'use client';

import { Dropdown } from '@/components/ui/dropdown';
import {
  COUPON_TYPE_LABELS,
  COUPON_TYPES,
  formatVnd,
  type CouponDto,
  type CouponType,
} from '@nona/contracts';
import { useState, type FormEvent } from 'react';
import { usePaged } from '@/components/admin/client-pagination';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

interface Draft {
  code: string;
  description: string;
  type: CouponType;
  value: string;
  minOrder: string;
  maxDiscount: string;
  startsAt: string;
  endsAt: string;
  limitTotal: string;
  limitPerUser: string;
  isActive: boolean;
}
const blank: Draft = {
  code: '',
  description: '',
  type: 'PERCENT',
  value: '10',
  minOrder: '0',
  maxDiscount: '',
  startsAt: '',
  endsAt: '',
  limitTotal: '',
  limitPerUser: '',
  isActive: true,
};
// <input type="datetime-local"> works in local time; the API stores ISO instants.
const toLocal = (iso: string | null) =>
  iso
    ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : '';
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const toDraft = (c: CouponDto): Draft => ({
  code: c.code,
  description: c.description ?? '',
  type: c.type,
  value: String(c.value),
  minOrder: String(c.minOrderVnd),
  maxDiscount: c.maxDiscountVnd === null ? '' : String(c.maxDiscountVnd),
  startsAt: toLocal(c.startsAt),
  endsAt: toLocal(c.endsAt),
  limitTotal: c.usageLimitTotal === null ? '' : String(c.usageLimitTotal),
  limitPerUser: c.usageLimitPerUser === null ? '' : String(c.usageLimitPerUser),
  isActive: c.isActive,
});
const toPayload = (d: Draft) => ({
  code: d.code.trim().toUpperCase(),
  description: d.description.trim() || null,
  type: d.type,
  value: d.type === 'FREE_SHIPPING' ? 0 : Math.floor(Number(d.value) || 0),
  minOrderVnd: Math.floor(Number(d.minOrder) || 0),
  maxDiscountVnd: d.type === 'PERCENT' && d.maxDiscount ? Math.floor(Number(d.maxDiscount)) : null,
  startsAt: fromLocal(d.startsAt),
  endsAt: fromLocal(d.endsAt),
  usageLimitTotal: d.limitTotal ? Math.floor(Number(d.limitTotal)) : null,
  usageLimitPerUser: d.limitPerUser ? Math.floor(Number(d.limitPerUser)) : null,
  isActive: d.isActive,
});
const describe = (c: CouponDto) =>
  c.type === 'PERCENT'
    ? `${c.value}%${c.maxDiscountVnd ? ` (tối đa ${formatVnd(c.maxDiscountVnd)})` : ''}`
    : c.type === 'FIXED'
      ? formatVnd(c.value)
      : 'Miễn phí vận chuyển';

export function CouponManager({ initial }: { initial: CouponDto[] }) {
  const { request, can } = useAdmin();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const [items, setItems] = useState(initial);
  const paged = usePaged(items);
  const [editing, setEditing] = useState<CouponDto | 'new' | null>(null);
  const [d, setD] = useState<Draft>(blank);
  const writable = can('coupons:write');
  const reload = async () =>
    setItems((await request<{ items: CouponDto[] }>('GET', '/admin/coupons')).items);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      if (editing === 'new') await request('POST', '/admin/coupons', toPayload(d));
      else if (editing)
        await request('PATCH', `/admin/coupons/${editing.id}`, {
          version: editing.version,
          coupon: toPayload(d),
        });
      await reload();
      return true;
    });
    if (ok) {
      setEditing(null);
      toast('Đã lưu mã giảm giá');
    }
  };
  const toggle = async (c: CouponDto) => {
    const ok = await run(async () => {
      await request('PATCH', `/admin/coupons/${c.id}`, {
        version: c.version,
        coupon: { ...toPayload(toDraft(c)), isActive: !c.isActive },
      });
      await reload();
      return true;
    });
    if (ok) toast(c.isActive ? 'Đã tắt mã' : 'Đã bật mã');
  };

  return (
    <>
      {error && !editing && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Ưu đãi</th>
              <th className="num">Đơn tối thiểu</th>
              <th>Hiệu lực</th>
              <th className="num">Đã dùng</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.visible.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.code}</strong>
                  {c.description && (
                    <>
                      <br />
                      <small>{c.description}</small>
                    </>
                  )}
                </td>
                <td>
                  {COUPON_TYPE_LABELS[c.type]}
                  <br />
                  <small>{describe(c)}</small>
                </td>
                <td className="num">{c.minOrderVnd ? formatVnd(c.minOrderVnd) : '—'}</td>
                <td>
                  <small>
                    {c.startsAt
                      ? new Date(c.startsAt).toLocaleString('vi-VN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'Ngay'}{' '}
                    →{' '}
                    {c.endsAt
                      ? new Date(c.endsAt).toLocaleString('vi-VN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'không giới hạn'}
                  </small>
                </td>
                <td className="num">
                  {c.usedCount}
                  {c.usageLimitTotal ? ` / ${c.usageLimitTotal}` : ''}
                </td>
                <td>
                  <span className={`pill ${c.isActive ? 'pill-published' : 'pill-archived'}`}>
                    {c.isActive ? 'Đang bật' : 'Đã tắt'}
                  </span>
                </td>
                <td>
                  {writable && (
                    <div className="row-inline">
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setEditing(c);
                          setD(toDraft(c));
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={pending}
                        onClick={() => toggle(c)}
                      >
                        {c.isActive ? 'Tắt' : 'Bật'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7}>Chưa có mã giảm giá nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paged.footer}
      {writable && !editing && (
        <p>
          <button
            className="btn btn-primary admin-create"
            onClick={() => {
              setEditing('new');
              setD(blank);
            }}
          >
            + Tạo mã giảm giá
          </button>
        </p>
      )}

      {editing && (
        <form className="admin-card" onSubmit={save} style={{ marginTop: 18 }}>
          <h2>{editing === 'new' ? 'Mã giảm giá mới' : `Sửa mã ${editing.code}`}</h2>
          <h3 className="form-section">Thông tin mã</h3>
          <div className="form-grid" style={{ '--cols': 4 } as React.CSSProperties}>
            <label className="field">
              <span>Mã *</span>
              <input
                value={d.code}
                disabled={editing !== 'new'}
                required
                maxLength={32}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="VD: WELCOME10"
              />
              <small>
                {editing === 'new' ? '3–32 ký tự, không đổi được sau khi tạo' : 'Không thể đổi mã'}
              </small>
            </label>
            <div className="field">
              <span>Loại ưu đãi *</span>
              <Dropdown
                ariaLabel="Loại ưu đãi"
                value={d.type}
                onChange={(v) => set('type', v as CouponType)}
                options={COUPON_TYPES.map((t) => ({ value: t, label: COUPON_TYPE_LABELS[t] }))}
              />
              <small>&nbsp;</small>
            </div>
            {d.type !== 'FREE_SHIPPING' ? (
              <label className="field">
                <span>{d.type === 'PERCENT' ? 'Phần trăm giảm *' : 'Số tiền giảm (VNĐ) *'}</span>
                <input
                  type="number"
                  required
                  min={1}
                  max={d.type === 'PERCENT' ? 100 : undefined}
                  value={d.value}
                  onChange={(e) => set('value', e.target.value)}
                  placeholder={d.type === 'PERCENT' ? '1 – 100' : 'VD: 50000'}
                />
                <small>&nbsp;</small>
              </label>
            ) : (
              <div />
            )}
            {d.type === 'PERCENT' ? (
              <label className="field">
                <span>Giảm tối đa (VNĐ)</span>
                <input
                  type="number"
                  min={1}
                  value={d.maxDiscount}
                  onChange={(e) => set('maxDiscount', e.target.value)}
                  placeholder="Không giới hạn"
                />
                <small>&nbsp;</small>
              </label>
            ) : (
              <div />
            )}
          </div>
          <label className="field" style={{ marginTop: 16 }}>
            <span>Mô tả (hiển thị cho khách)</span>
            <input
              value={d.description}
              maxLength={200}
              onChange={(e) => set('description', e.target.value)}
              placeholder="VD: Giảm 10% cho đơn đầu tiên"
            />
          </label>

          <h3 className="form-section">Điều kiện và thời hạn</h3>
          <div className="form-grid" style={{ '--cols': 3 } as React.CSSProperties}>
            <label className="field">
              <span>Đơn tối thiểu (VNĐ)</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={d.minOrder}
                onChange={(e) => set('minOrder', e.target.value)}
              />
              <small>Tính trên tiền hàng, trước giảm giá</small>
            </label>
            <label className="field">
              <span>Bắt đầu</span>
              <input
                type="datetime-local"
                value={d.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
              />
              <small>Để trống = có hiệu lực ngay</small>
            </label>
            <label className="field">
              <span>Kết thúc</span>
              <input
                type="datetime-local"
                value={d.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
              />
              <small>Để trống = không hết hạn</small>
            </label>
          </div>

          <h3 className="form-section">Giới hạn lượt dùng</h3>
          <div className="form-grid" style={{ '--cols': 3 } as React.CSSProperties}>
            <label className="field">
              <span>Tổng lượt dùng tối đa</span>
              <input
                type="number"
                min={1}
                value={d.limitTotal}
                onChange={(e) => set('limitTotal', e.target.value)}
                placeholder="Không giới hạn"
              />
              <small>&nbsp;</small>
            </label>
            <label className="field">
              <span>Tối đa mỗi khách</span>
              <input
                type="number"
                min={1}
                value={d.limitPerUser}
                onChange={(e) => set('limitPerUser', e.target.value)}
                placeholder="Không giới hạn"
              />
              <small>Theo tài khoản; khách vãng lai theo email</small>
            </label>
            <div />
          </div>
          <label className="row-inline field" style={{ marginTop: 18 }}>
            <input
              type="checkbox"
              checked={d.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />{' '}
            <span>Đang bật</span>
          </label>
          <p className="form-note">
            Mỗi đơn chỉ dùng được một mã (không cộng dồn). Thay đổi mã không ảnh hưởng các đơn đã
            đặt — đơn lưu lại quy tắc tại thời điểm áp dụng.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={pending}>
              Lưu mã
            </button>
            <button className="btn btn-outline" type="button" onClick={() => setEditing(null)}>
              Hủy
            </button>
          </div>
        </form>
      )}
    </>
  );
}
