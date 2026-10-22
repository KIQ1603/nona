'use client';

import { Dropdown } from '@/components/ui/dropdown';
import { PRODUCT_COLORS, PRODUCT_STYLES, type AdminCategory } from '@nona/contracts';

export interface ProductFormState {
  name: string;
  slug: string;
  categoryId: string;
  summary: string;
  description: string;
  badge: string;
  colorCode: string;
  styleCode: string;
  sortWeight: number;
  isCustomizable: boolean;
  hatWidthCm: string;
  hatHeightCm: string;
  seoTitle: string;
  seoDescription: string;
}

export const emptyProductForm = (categoryId = ''): ProductFormState => ({
  name: '',
  slug: '',
  categoryId,
  summary: '',
  description: '',
  badge: '',
  colorCode: '',
  styleCode: '',
  sortWeight: 0,
  isCustomizable: true,
  hatWidthCm: '60',
  hatHeightCm: '45',
  seoTitle: '',
  seoDescription: '',
});

/** Empty strings become null so cleared optional fields are actually cleared on the server. */
export const toPayload = (f: ProductFormState, includeSlug: boolean) => ({
  name: f.name.trim(),
  ...(includeSlug && f.slug.trim() ? { slug: f.slug.trim() } : {}),
  categoryId: f.categoryId,
  summary: f.summary.trim() || null,
  description: f.description.trim() || null,
  badge: f.badge.trim() || null,
  colorCode: f.colorCode || null,
  styleCode: f.styleCode || null,
  sortWeight: f.sortWeight,
  isCustomizable: f.isCustomizable,
  hatWidthCm: f.hatWidthCm.trim() ? Number(f.hatWidthCm) : null,
  hatHeightCm: f.hatHeightCm.trim() ? Number(f.hatHeightCm) : null,
  seoTitle: f.seoTitle.trim() || null,
  seoDescription: f.seoDescription.trim() || null,
});

export function ProductFields({
  value,
  onChange,
  categories,
  slugHint,
}: {
  value: ProductFormState;
  onChange: (next: ProductFormState) => void;
  categories: AdminCategory[];
  slugHint?: string;
}) {
  const set = <K extends keyof ProductFormState>(key: K, v: ProductFormState[K]) =>
    onChange({ ...value, [key]: v });
  const grid = (cols: number) => ({ '--cols': cols }) as React.CSSProperties;
  return (
    <>
      <h3 className="form-section first">Thông tin cơ bản</h3>
      <div className="form-grid" style={grid(2)}>
        <label className="field">
          <span>Tên sản phẩm *</span>
          <input
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            required
            maxLength={160}
          />
          <small>Hiển thị trên cửa hàng</small>
        </label>
        <div className="field">
          <span>Danh mục *</span>
          <Dropdown
            ariaLabel="Danh mục"
            value={value.categoryId}
            onChange={(v) => set('categoryId', v)}
            options={[
              ...(value.categoryId ? [] : [{ value: '', label: 'Chọn danh mục…' }]),
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <small>Nhóm sản phẩm trên thanh danh mục</small>
        </div>
      </div>
      <div className="form-grid" style={{ ...grid(1), marginTop: 16 }}>
        <label className="field">
          <span>Slug (đường dẫn)</span>
          <input
            value={value.slug}
            onChange={(e) => set('slug', e.target.value)}
            maxLength={120}
            placeholder="Để trống để tự tạo từ tên"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <small>{slugHint ?? 'Chỉ gồm chữ thường, số và dấu gạch ngang'}</small>
        </label>
        <label className="field">
          <span>Mô tả ngắn</span>
          <input
            value={value.summary}
            onChange={(e) => set('summary', e.target.value)}
            maxLength={300}
          />
          <small>Một hai câu dưới tên sản phẩm</small>
        </label>
        <label className="field">
          <span>Mô tả chi tiết</span>
          <textarea
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={5000}
            rows={4}
          />
        </label>
      </div>

      <h3 className="form-section">Phân loại hiển thị</h3>
      <div className="form-grid" style={grid(4)}>
        <label className="field">
          <span>Nhãn (badge)</span>
          <input
            value={value.badge}
            onChange={(e) => set('badge', e.target.value)}
            maxLength={24}
            placeholder="VD: Mới, Bán chạy"
          />
          <small>Hiện trên thẻ sản phẩm</small>
        </label>
        <div className="field">
          <span>Màu sắc (bộ lọc)</span>
          <Dropdown
            ariaLabel="Màu sắc (bộ lọc)"
            value={value.colorCode}
            onChange={(v) => set('colorCode', v)}
            options={[
              { value: '', label: '—' },
              ...PRODUCT_COLORS.map((c) => ({ value: c.code, label: c.label })),
            ]}
          />
          <small>Dùng cho bộ lọc của khách</small>
        </div>
        <div className="field">
          <span>Phong cách (bộ lọc)</span>
          <Dropdown
            ariaLabel="Phong cách (bộ lọc)"
            value={value.styleCode}
            onChange={(v) => set('styleCode', v)}
            options={[
              { value: '', label: '—' },
              ...PRODUCT_STYLES.map((s) => ({ value: s.code, label: s.label })),
            ]}
          />
          <small>Dùng cho bộ lọc của khách</small>
        </div>
        <label className="field">
          <span>Thứ tự nổi bật</span>
          <input
            type="number"
            min={0}
            max={100000}
            value={value.sortWeight}
            onChange={(e) =>
              set('sortWeight', Math.max(0, Math.floor(Number(e.target.value) || 0)))
            }
          />
          <small>Số lớn hiển thị trước</small>
        </label>
      </div>

      <h3 className="form-section">Thiết kế riêng (NONA Custom)</h3>
      <label className="row-inline field">
        <input
          type="checkbox"
          checked={value.isCustomizable}
          onChange={(e) => set('isCustomizable', e.target.checked)}
        />{' '}
        <span>Cho phép khách thiết kế riêng trên sản phẩm này</span>
      </label>
      {value.isCustomizable && (
        <>
          <div className="form-grid" style={grid(4)}>
            <label className="field">
              <span>Chiều rộng nón thật (cm)</span>
              <input
                type="number"
                min={5}
                max={100}
                step={0.5}
                value={value.hatWidthCm}
                onChange={(e) => set('hatWidthCm', e.target.value)}
                placeholder="VD: 40"
              />
              <small>Chỗ rộng nhất của nón</small>
            </label>
            <label className="field">
              <span>Chiều cao nón thật (cm)</span>
              <input
                type="number"
                min={3}
                max={100}
                step={0.5}
                value={value.hatHeightCm}
                onChange={(e) => set('hatHeightCm', e.target.value)}
                placeholder="VD: 18"
              />
              <small>Từ đỉnh đến vành (tùy chọn)</small>
            </label>
          </div>
          <p className="form-note">
            Chỉ cần ước lượng. Hệ thống dùng chiều rộng (hoặc chiều cao nếu chưa nhập rộng) để charm
            hiển thị đúng tỉ lệ; để trống thì tạm tính nón rộng 40 cm. Ảnh nón nên cắt sát mép nón.
          </p>
        </>
      )}

      <h3 className="form-section">SEO</h3>
      <div className="form-grid" style={grid(2)}>
        <label className="field">
          <span>SEO title</span>
          <input
            value={value.seoTitle}
            onChange={(e) => set('seoTitle', e.target.value)}
            maxLength={160}
          />
          <small>Tiêu đề trên Google</small>
        </label>
        <label className="field">
          <span>SEO description</span>
          <input
            value={value.seoDescription}
            onChange={(e) => set('seoDescription', e.target.value)}
            maxLength={300}
          />
          <small>Mô tả ngắn trên Google</small>
        </label>
      </div>
    </>
  );
}
