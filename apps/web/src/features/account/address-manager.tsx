'use client';

import { addressListSchema, MAX_ADDRESSES, type AddressDto } from '@nona/contracts';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

const blank = {
  fullName: '',
  phone: '',
  line1: '',
  ward: '',
  district: '',
  province: '',
  isDefault: false,
};
type Form = typeof blank;

export function AddressManager({ initial }: { initial: AddressDto[] }) {
  const { request } = useCustomer();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(blank);

  const apply = (raw: unknown) => setItems(addressListSchema.parse(raw).items);
  const startEdit = (a: AddressDto) => {
    setEditing(a.id);
    setForm({
      fullName: a.fullName,
      phone: a.phone,
      line1: a.line1,
      ward: a.ward,
      district: a.district,
      province: a.province,
      isDefault: a.isDefault,
    });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      apply(
        editing === 'new'
          ? await request('POST', '/me/addresses', form)
          : await request('PATCH', `/me/addresses/${editing}`, form),
      );
      return true;
    });
    if (ok) {
      setEditing(null);
      toast('Đã lưu địa chỉ');
    }
  };
  const makeDefault = async (id: string) =>
    void (await run(async () =>
      apply(await request('PATCH', `/me/addresses/${id}`, { isDefault: true })),
    ));
  const remove = async (id: string) => {
    if (!window.confirm('Xóa địa chỉ này?')) return;
    await run(async () => apply(await request('DELETE', `/me/addresses/${id}`)));
  };
  const set = (k: keyof Form, v: string | boolean) => setForm({ ...form, [k]: v });

  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 && editing === null && <p className="panel">Bạn chưa lưu địa chỉ nào.</p>}
      <ul className="address-list">
        {items.map((a) => (
          <li key={a.id} className={`address-card${a.isDefault ? ' default' : ''}`}>
            {a.isDefault && <span className="tag">Mặc định</span>}
            <strong>{a.fullName}</strong>
            <span>{a.phone}</span>
            <span>
              {a.line1}, {a.ward}, {a.district}, {a.province}
            </span>
            <div className="actions">
              <button
                className="btn btn-outline-site btn-sm-site"
                type="button"
                onClick={() => startEdit(a)}
              >
                Sửa
              </button>
              {!a.isDefault && (
                <button
                  className="btn btn-outline-site btn-sm-site"
                  type="button"
                  disabled={pending}
                  onClick={() => makeDefault(a.id)}
                >
                  Đặt mặc định
                </button>
              )}
              <button
                className="btn btn-outline-site btn-sm-site"
                type="button"
                disabled={pending}
                onClick={() => remove(a.id)}
              >
                Xóa
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing === null ? (
        items.length < MAX_ADDRESSES && (
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setEditing('new');
              setForm(blank);
            }}
          >
            + Thêm địa chỉ
          </button>
        )
      ) : (
        <form className="panel account-form" onSubmit={save}>
          <h2>{editing === 'new' ? 'Địa chỉ mới' : 'Sửa địa chỉ'}</h2>
          <div className="form-grid">
            <label className="field">
              <span>Họ tên người nhận</span>
              <input
                autoComplete="name"
                required
                maxLength={100}
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Số điện thoại</span>
              <input
                type="tel"
                autoComplete="tel"
                required
                inputMode="tel"
                value={form.phone}
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
              value={form.line1}
              onChange={(e) => set('line1', e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Phường/Xã</span>
              <input
                required
                maxLength={100}
                value={form.ward}
                onChange={(e) => set('ward', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Quận/Huyện</span>
              <input
                required
                maxLength={100}
                value={form.district}
                onChange={(e) => set('district', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Tỉnh/Thành phố</span>
              <input
                required
                maxLength={100}
                value={form.province}
                onChange={(e) => set('province', e.target.value)}
              />
            </label>
          </div>
          <label className="check field">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
            />{' '}
            Đặt làm địa chỉ mặc định
          </label>
          <div className="row-inline" style={{ gap: 10 }}>
            <button className="btn btn-primary" type="submit" disabled={pending}>
              Lưu địa chỉ
            </button>
            <button className="btn btn-outline-site" type="button" onClick={() => setEditing(null)}>
              Hủy
            </button>
          </div>
        </form>
      )}
    </>
  );
}
