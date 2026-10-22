'use client';

import { Dropdown } from '@/components/ui/dropdown';
import {
  CONTACT_KIND_LABELS,
  CONTACT_KINDS,
  type AdminSettings,
  type ContactKind,
} from '@nona/contracts';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';
import { ChannelIcon } from '@/features/contact/channel-icon';

type Contact = AdminSettings['contact'];
type Channel = Contact['channels'][number];
const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30);

const PLACEHOLDER: Record<ContactKind, string> = {
  ZALO: 'https://zalo.me/0900000000',
  FACEBOOK: 'https://www.facebook.com/trang-cua-ban',
  MESSENGER: 'https://m.me/trang-cua-ban',
  TIKTOK: 'https://www.tiktok.com/@ten-kenh',
  INSTAGRAM: 'https://www.instagram.com/ten-tai-khoan',
  YOUTUBE: 'https://www.youtube.com/@ten-kenh',
  EMAIL: 'ten@gmail.com',
  PHONE: '0900000000',
  OTHER: 'https://…',
};

/** Lets admins type a bare email or phone number; we store the proper mailto:/tel: link. */
function normalizeUrl(kind: ContactKind, raw: string): string {
  const v = raw.trim();
  if (kind === 'EMAIL' && v && !/^mailto:/i.test(v) && v.includes('@')) return `mailto:${v}`;
  if (kind === 'PHONE' && v && !/^tel:/i.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`;
  return v;
}
const display = (url: string) => url.replace(/^(mailto:|tel:)/i, '');

export function ContactForm({ initial }: { initial: Contact }) {
  const { request } = useAdmin();
  const toast = useToast();
  const [version, setVersion] = useState(initial.version);
  const [c, setC] = useState<Omit<Contact, 'version'>>(() => {
    const { version: _v, ...rest } = initial;
    return rest;
  });
  const act = useAction();
  const setChannel = (i: number, patch: Partial<Channel>) =>
    setC({ ...c, channels: c.channels.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const res = await act.run(() =>
      request<AdminSettings>('PATCH', '/admin/settings/contact', {
        version,
        value: {
          ...c,
          channels: c.channels.map((x) => ({ ...x, url: normalizeUrl(x.kind, x.url) })),
        },
      }),
    );
    if (res) {
      const { version: v, ...rest } = res.contact;
      setVersion(v);
      setC(rest);
      toast('Đã lưu thông tin liên hệ. Cửa hàng cập nhật ngay.');
    }
  };

  return (
    <form onSubmit={save}>
      <div className="admin-card">
        <h2>Nút liên hệ nổi (bên phải màn hình)</h2>
        <label className="row-inline field">
          <input
            type="checkbox"
            checked={c.floatingEnabled}
            onChange={(e) => setC({ ...c, floatingEnabled: e.target.checked })}
          />{' '}
          <span>Hiện các nút Zalo, Facebook… nhấp nháy ở góc phải mọi trang</span>
        </label>
        <small>
          Mỗi kênh bên dưới đang bật sẽ có một nút. Thứ tự từ trên xuống dưới = thứ tự hiển thị.
        </small>
      </div>

      <div className="admin-card">
        <h2>Kênh liên hệ</h2>
        <table className="admin-table options-table">
          <thead>
            <tr>
              <th />
              <th>Loại</th>
              <th>Tên hiển thị</th>
              <th>Liên kết / địa chỉ</th>
              <th>Bật</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {c.channels.map((ch, i) => (
              <tr key={i}>
                <td>
                  <ChannelIcon kind={ch.kind} size={32} />
                </td>
                <td>
                  <Dropdown
                    ariaLabel="Loại kênh"
                    value={ch.kind}
                    onChange={(v) => setChannel(i, { kind: v as ContactKind })}
                    options={CONTACT_KINDS.map((k) => ({
                      value: k,
                      label: CONTACT_KIND_LABELS[k],
                    }))}
                  />
                </td>
                <td>
                  <input
                    value={ch.label}
                    maxLength={40}
                    onChange={(e) => setChannel(i, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={display(ch.url)}
                    placeholder={PLACEHOLDER[ch.kind]}
                    maxLength={300}
                    onChange={(e) => setChannel(i, { url: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={ch.enabled}
                    aria-label={`Bật ${ch.label}`}
                    onChange={(e) => setChannel(i, { enabled: e.target.checked })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-outline"
                    onClick={() => setC({ ...c, channels: c.channels.filter((_, j) => j !== i) })}
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
            {c.channels.length === 0 && (
              <tr>
                <td colSpan={6}>Chưa có kênh nào.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p>
          <small>
            Email và điện thoại chỉ cần gõ địa chỉ/số, hệ thống tự thêm mailto:/tel:. Liên kết khác
            phải bắt đầu bằng https://.
          </small>
        </p>
        <button
          type="button"
          className="btn btn-outline"
          disabled={c.channels.length >= 10}
          onClick={() =>
            setC({
              ...c,
              channels: [
                ...c.channels,
                {
                  id: slug(`kenh${Date.now().toString(36)}`),
                  kind: 'ZALO',
                  label: 'Zalo',
                  url: '',
                  enabled: true,
                },
              ],
            })
          }
        >
          + Thêm kênh
        </button>
      </div>

      <div className="admin-card">
        <h2>Trang “Liên hệ”</h2>
        <label className="field">
          <span>Tiêu đề</span>
          <input
            value={c.headline}
            maxLength={120}
            onChange={(e) => setC({ ...c, headline: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Mô tả ngắn</span>
          <textarea
            rows={3}
            maxLength={500}
            value={c.description}
            onChange={(e) => setC({ ...c, description: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Địa chỉ (tùy chọn)</span>
            <input
              value={c.address}
              maxLength={200}
              onChange={(e) => setC({ ...c, address: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Giờ làm việc (tùy chọn)</span>
            <input
              value={c.hours}
              maxLength={160}
              onChange={(e) => setC({ ...c, hours: e.target.value })}
            />
          </label>
        </div>
      </div>

      {act.error && (
        <p className="form-error" role="alert">
          {act.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={act.pending}>
        {act.pending ? 'Đang lưu…' : 'Lưu thông tin liên hệ'}
      </button>
    </form>
  );
}
