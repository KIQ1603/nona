'use client';

import { formatVnd, type AdminSettings } from '@nona/contracts';
import { useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useDialog } from '@/lib/use-dialog';
import { describeError, useAdmin } from '@/lib/admin-client';

type Custom = AdminSettings['custom'];
const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

export function CustomOptionsForm({ initial }: { initial: Custom }) {
  const { request } = useAdmin();
  const toast = useToast();
  const [version, setVersion] = useState(initial.version);
  const [o, setO] = useState<Omit<Custom, 'version'>>(() => {
    const { version: _v, ...rest } = initial;
    return rest;
  });

  /** Saves the whole options form with a new list of charms (used by the add/edit/delete popup). */
  const persistMotifs = async (motifs: Custom['motifs']): Promise<string | null> => {
    try {
      const res = await request<AdminSettings>('PATCH', '/admin/settings/custom', {
        version,
        value: { ...o, motifs },
      });
      const { version: v, ...rest } = res.custom;
      setVersion(v);
      setO(rest);
      toast('Đã lưu họa tiết');
      return null;
    } catch (e) {
      return describeError(e);
    }
  };

  return (
    <>
      <MotifsEditor motifs={o.motifs} onPersist={persistMotifs} />
    </>
  );
}

type Motif = Custom['motifs'][number];
const SHAPE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/;

/** Code for a new charm, made from its name (no diacritics) and unique among the existing ones. */
function makeId(name: string, taken: string[]): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'hoatiet';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

const BLANK: Motif = {
  id: '',
  name: '',
  path: null,
  imageKey: null,
  sizeCm: 10,
  heightCm: null,
  priceVnd: 0,
};

/** Charms are added and edited in a popup: name, picture, price. The code is generated. */
function MotifsEditor({
  motifs,
  onPersist,
}: {
  motifs: Motif[];
  onPersist: (m: Motif[]) => Promise<string | null>;
}) {
  const { upload } = useAdmin();
  const [editing, setEditingRaw] = useState<{ index: number | null; draft: Motif } | null>(null);
  // number fields keep what the person typed (so they can clear and retype); they are validated on save
  const [sizeText, setSizeText] = useState('10');
  const [heightText, setHeightText] = useState('10');
  const [priceText, setPriceText] = useState('0');
  const setEditing: typeof setEditingRaw = (v) => {
    setEditingRaw(v);
    if (v && typeof v !== 'function') {
      setSizeText(String(v.draft.sizeCm));
      setHeightText(String(v.draft.heightCm ?? v.draft.sizeCm));
      setPriceText(v.draft.priceVnd ? String(v.draft.priceVnd) : '');
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const close = () => {
    setEditing(null);
    setError(null);
    setWarn(false);
  };
  useDialog(editing !== null, dialog, close);
  const draft = editing?.draft;
  const patch = (p: Partial<Motif>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await upload<{
        imageKey: string;
        transparent: boolean;
        width: number;
        height: number;
      }>('/admin/custom/motif-image', fd);
      // suggest the height from the picture's own proportions (the admin can still change it)
      const h = Math.min(
        60,
        Math.max(1, Math.round((((Number(sizeText) || 10) * res.height) / res.width) * 2) / 2),
      );
      setHeightText(String(h));
      patch({ imageKey: res.imageKey, heightCm: h });
      setWarn(!res.transparent);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const submit = async () => {
    if (!editing || !draft) return;
    const name = draft.name.trim();
    if (!name) return setError('Hãy nhập tên họa tiết.');
    const size = Number(sizeText);
    const height = Number(heightText);
    if (!(height >= 1 && height <= 60)) return setError('Chiều cao charm phải từ 1 đến 60 cm.');
    if (!(size >= 1 && size <= 60)) return setError('Kích thước charm phải từ 1 đến 60 cm.');
    if (!draft.imageKey && !(draft.path && SHAPE.test(draft.path)))
      return setError('Hãy tải hình cho họa tiết (SVG hoặc PNG nền trong suốt).');
    const ids = motifs.filter((_, i) => i !== editing.index).map((m) => m.id);
    const next: Motif = {
      ...draft,
      sizeCm: size,
      heightCm: height,
      name,
      id: editing.index === null ? makeId(name, ids) : draft.id,
    };
    const list =
      editing.index === null
        ? [...motifs, next]
        : motifs.map((m, i) => (i === editing.index ? next : m));
    setBusy(true);
    const err = await onPersist(list);
    setBusy(false);
    if (err) setError(err);
    else close();
  };

  const remove = async (i: number) => {
    if (
      !window.confirm(
        `Xóa họa tiết “${motifs[i]!.name}”? Thiết kế đã gửi và đơn đã đặt không bị ảnh hưởng.`,
      )
    )
      return;
    setRowError(await onPersist(motifs.filter((_, j) => j !== i)));
  };

  return (
    <div className="admin-card">
      <div className="card-head">
        <div>
          <h2>Họa tiết / biểu tượng (charm)</h2>
          <p className="card-sub">{motifs.length}/30 họa tiết. Khách chọn và đặt lên nón.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary admin-create"
          disabled={motifs.length >= 30}
          onClick={() => setEditing({ index: null, draft: { ...BLANK } })}
        >
          + Thêm họa tiết
        </button>
      </div>
      <div className="format-guide">
        <strong>Nên dùng định dạng nào?</strong>
        <ul>
          <li>
            <b>SVG</b> (tốt nhất) hoặc <b>PNG nền trong suốt</b> (khoảng 512×512px là đủ). Ảnh to cỡ
            nào cũng được: hệ thống tự cắt phần trống và thu về 256×256px.
          </li>
          <li>Hình giữ nguyên màu gốc khi đặt lên nón. JPEG sẽ giữ cả ô nền.</li>
        </ul>
      </div>
      {rowError && (
        <p className="form-error" role="alert">
          {rowError}
        </p>
      )}
      <table className="admin-table options-table">
        <thead>
          <tr>
            <th>Hình</th>
            <th>Tên</th>
            <th className="num">Kích thước</th>
            <th className="num">Phụ thu</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {motifs.map((m, i) => (
            <tr key={m.id}>
              <td>
                <MotifPreview m={m} size={40} />
              </td>
              <td>
                <strong>{m.name}</strong>
              </td>
              <td className="num">
                {m.sizeCm} × {m.heightCm ?? m.sizeCm} cm
              </td>
              <td className="num">{m.priceVnd ? formatVnd(m.priceVnd) : 'Miễn phí'}</td>
              <td className="row-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setEditing({ index: i, draft: { ...m } })}
                >
                  Sửa
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger-outline"
                  onClick={() => remove(i)}
                >
                  Xóa
                </button>
              </td>
            </tr>
          ))}
          {motifs.length === 0 && (
            <tr>
              <td colSpan={5}>Chưa có họa tiết nào.</td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && draft && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            className="modal motif-modal"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="motif-title"
          >
            <h3 id="motif-title">{editing.index === null ? 'Thêm họa tiết' : 'Sửa họa tiết'}</h3>
            {/* not a <form>: it already sits inside the options form, and Enter must save the popup only */}
            <div
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  (e.target as HTMLElement).tagName === 'INPUT' &&
                  (e.target as HTMLInputElement).type !== 'file'
                ) {
                  e.preventDefault();
                  void submit();
                }
              }}
            >
              <label className="field">
                <span>Tên họa tiết</span>
                <input
                  value={draft.name}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="VD: Hoa sen"
                />
              </label>
              <div className="field">
                <span>Hình</span>
                <div className="motif-pick">
                  <div className="motif-pick-preview">
                    <MotifPreview m={draft} size={72} />
                  </div>
                  <div>
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={busy}
                      onClick={() => file.current?.click()}
                    >
                      {busy
                        ? 'Đang xử lý…'
                        : draft.imageKey || draft.path
                          ? 'Đổi hình'
                          : 'Chọn hình (SVG/PNG)'}
                    </button>
                    <small>SVG hoặc PNG nền trong suốt, kích thước tùy ý.</small>
                  </div>
                </div>
                <input
                  ref={file}
                  type="file"
                  accept=".svg,image/svg+xml,image/png,image/webp,image/jpeg"
                  hidden
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                {warn && (
                  <small className="form-error">
                    Ảnh không có nền trong suốt nên sẽ hiện cả ô nền. Nên dùng SVG hoặc PNG nền
                    trong suốt.
                  </small>
                )}
              </div>
              <div className="form-grid" style={{ '--cols': 2 } as React.CSSProperties}>
                <label className="field">
                  <span>Chiều rộng thật (cm)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={0.5}
                    value={sizeText}
                    onChange={(e) => setSizeText(e.target.value)}
                  />
                  <small>Bề ngang của charm</small>
                </label>
                <label className="field">
                  <span>Chiều cao thật (cm)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={0.5}
                    value={heightText}
                    onChange={(e) => setHeightText(e.target.value)}
                  />
                  <small>Bề dọc; tự gợi ý theo tỉ lệ ảnh khi tải lên</small>
                </label>
              </div>
              <p className="form-note">
                Nếu nón rộng 60 cm thì charm này chiếm khoảng{' '}
                {Math.round(((Number(sizeText) || draft.sizeCm) / 60) * 100)}% chiều rộng nón. Mỗi
                nón dùng chiều rộng thật của nó nên tỉ lệ luôn đúng.
              </p>
              <label className="field">
                <span>Giá phụ thu (VNĐ, 0 = miễn phí)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={priceText}
                  placeholder="0"
                  onChange={(e) => {
                    setPriceText(e.target.value);
                    patch({ priceVnd: int(e.target.value) });
                  }}
                />
              </label>
              {!draft.imageKey && (
                <details className="field">
                  <summary>Nâng cao: dán đường vẽ SVG (path) thay cho hình</summary>
                  <input
                    value={draft.path ?? ''}
                    maxLength={800}
                    placeholder="M50 10 L90 90 L10 90 Z (khung 100×100)"
                    onChange={(e) => patch({ path: e.target.value || null })}
                  />
                </details>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy ? 'Đang lưu…' : 'Lưu họa tiết'}
                </button>
                <button type="button" className="btn btn-outline" onClick={close}>
                  Hủy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MotifPreview({ m, size }: { m: Motif; size: number }) {
  if (m.imageKey)
    return (
      <img
        src={`/media/${m.imageKey}`}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
      />
    );
  if (m.path && SHAPE.test(m.path))
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <path d={m.path} fill="#222" />
      </svg>
    );
  return <span className="motif-empty" style={{ width: size, height: size }} aria-hidden="true" />;
}
