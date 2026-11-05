'use client';

import {
  PAGE_GALLERY_SLOTS,
  PAGE_VALUE_SLOTS,
  type AdminSettings,
  type PageImages,
} from '@nona/contracts';
import { useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { describeError, useAdmin } from '@/lib/admin-client';

type Pages = AdminSettings['pages'];
/** A chosen picture: its object-store key (saved) and a URL to show it (preview). */
type Pic = { key: string; url: string } | null;

/** The built-in pictures each slot shows until the admin chooses one (files in /public/brand). */
const DEFAULT_TYPES: Record<string, string> = {
  'non-la': '/brand/home-nonla.jpg',
  'moc-khoa': '/brand/home-mockhoa.jpg',
  'kep-toc': '/brand/home-keptoc.jpg',
};
const DEFAULT_ABOUT = '/brand/about-craft.jpg';
const DEFAULT_GALLERY = [
  '/brand/about-craft.jpg',
  '/brand/about-team.jpg',
  '/brand/about-making.jpg',
];
const VALUES = [
  { label: 'Trân trọng bản sắc Việt', image: '/brand/value-ban-sac.jpg' },
  { label: 'Đề cao sự khéo léo và tinh thần thủ công', image: '/brand/value-thu-cong.jpg' },
  { label: 'Khuyến khích sáng tạo, cá nhân hóa', image: '/brand/value-sang-tao.jpg' },
  {
    label: 'Đưa các sản phẩm truyền thống vào đời sống hiện đại',
    image: '/brand/value-hien-dai.jpg',
  },
];

function Slot({
  label,
  fallback,
  value,
  onChange,
  hint,
}: {
  label: string;
  fallback: string | null;
  value: Pic;
  onChange: (pic: Pic) => void;
  hint?: string;
}) {
  const { upload } = useAdmin();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await upload<{ imageKey: string; imageUrl: string }>('/admin/pages/image', fd);
      onChange({ key: res.imageKey, url: res.imageUrl });
    } catch (e) {
      toast(describeError(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  const shown = value?.url ?? fallback;
  return (
    <div className="page-slot">
      <span className="page-slot-img">
        {shown ? <img src={shown} alt="" loading="lazy" /> : <em>Chưa có ảnh</em>}
      </span>
      <strong>{label}</strong>
      {hint && <small>{hint}</small>}
      <small>{value ? 'Ảnh bạn đã chọn' : 'Đang dùng ảnh mặc định'}</small>
      <div className="page-slot-actions">
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          {busy ? 'Đang tải…' : 'Đổi ảnh'}
        </button>
        {value && (
          <button type="button" className="btn btn-outline" onClick={() => onChange(null)}>
            Dùng ảnh mặc định
          </button>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}

export function PageImagesForm({
  initial,
  urls,
  types,
}: {
  initial: Pages;
  urls: PageImages;
  types: { slug: string; name: string }[];
}) {
  const { request } = useAdmin();
  const toast = useToast();
  const [version, setVersion] = useState(initial.version);
  const pic = (key: string | null | undefined, url: string | null | undefined): Pic =>
    key && url ? { key, url } : null;
  const [homeTypes, setHomeTypes] = useState<Record<string, Pic>>(() =>
    Object.fromEntries(
      types.map((t) => [t.slug, pic(initial.homeTypes[t.slug], urls.homeTypes[t.slug])]),
    ),
  );
  const [about, setAbout] = useState<Pic>(() => pic(initial.homeAbout, urls.homeAbout));
  const [gallery, setGallery] = useState<Pic[]>(() =>
    Array.from({ length: PAGE_GALLERY_SLOTS }, (_, i) =>
      pic(initial.aboutGallery[i], urls.aboutGallery[i]),
    ),
  );
  const [values, setValues] = useState<Pic[]>(() =>
    Array.from({ length: PAGE_VALUE_SLOTS }, (_, i) =>
      pic(initial.aboutValues[i], urls.aboutValues[i]),
    ),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await request<AdminSettings>('PATCH', '/admin/settings/pages', {
        version,
        value: {
          homeTypes: Object.fromEntries(
            Object.entries(homeTypes).flatMap(([slug, p]) => (p ? [[slug, p.key]] : [])),
          ),
          homeAbout: about?.key ?? null,
          aboutGallery: gallery.map((p) => p?.key ?? null),
          aboutValues: values.map((p) => p?.key ?? null),
        },
      });
      setVersion(res.pages.version);
      toast('Đã lưu ảnh');
    } catch (e) {
      toast(describeError(e));
    } finally {
      setSaving(false);
    }
  };
  const setAt = (list: Pic[], set: (v: Pic[]) => void, i: number, p: Pic) =>
    set(list.map((x, j) => (j === i ? p : x)));

  return (
    <>
      <div className="admin-card">
        <h2>Trang chủ: ảnh các ô danh mục</h2>
        <div className="page-slots">
          {types.map((t) => (
            <Slot
              key={t.slug}
              label={t.name}
              fallback={DEFAULT_TYPES[t.slug] ?? null}
              value={homeTypes[t.slug] ?? null}
              onChange={(p) => setHomeTypes({ ...homeTypes, [t.slug]: p })}
              hint={DEFAULT_TYPES[t.slug] ? undefined : 'Không chọn thì dùng ảnh sản phẩm đầu tiên'}
            />
          ))}
        </div>
        <h3 className="form-section">Trang chủ: ảnh “Về Sắc Chằm”</h3>
        <div className="page-slots">
          <Slot
            label="Ảnh bên cạnh phần giới thiệu"
            fallback={DEFAULT_ABOUT}
            value={about}
            onChange={setAbout}
          />
        </div>
      </div>

      <div className="admin-card">
        <h2>Giới thiệu: dải ảnh dưới “Câu chuyện của chúng tôi”</h2>
        <div className="page-slots">
          {gallery.map((p, i) => (
            <Slot
              key={i}
              label={`Ảnh ${i + 1}`}
              fallback={DEFAULT_GALLERY[i] ?? null}
              value={p}
              onChange={(v) => setAt(gallery, setGallery, i, v)}
            />
          ))}
        </div>
        <h3 className="form-section">Giới thiệu: Giá trị cốt lõi</h3>
        <div className="page-slots">
          {values.map((p, i) => (
            <Slot
              key={i}
              label={VALUES[i]!.label}
              fallback={VALUES[i]!.image}
              value={p}
              onChange={(v) => setAt(values, setValues, i, v)}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? 'Đang lưu…' : 'Lưu ảnh'}
      </button>
    </>
  );
}
