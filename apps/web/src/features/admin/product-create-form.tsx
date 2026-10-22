'use client';

import type { AdminCategory, AdminProductDetail } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { newIdempotencyKey, useAdmin } from '@/lib/admin-client';
import { makeSku } from '@/lib/sku';
import { emptyProductForm, ProductFields, toPayload } from './product-fields';
import { PICTURE_HINT, PictureSlot } from './variant-picture';

interface Draft {
  key: number;
  name: string;
  price: string;
  stock: string;
  file: File | null;
}
const MAX_BYTES = 8 * 1024 * 1024;
let seq = 0;
const blank = (): Draft => ({ key: ++seq, name: '', price: '', stock: '0', file: null });

/** A local preview of the chosen file (revoked when replaced). */
function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function DraftRow({
  d,
  index,
  canRemove,
  canStock,
  onChange,
  onRemove,
}: {
  d: Draft;
  index: number;
  canRemove: boolean;
  canStock: boolean;
  onChange: (next: Draft) => void;
  onRemove: () => void;
}) {
  const preview = useObjectUrl(d.file);
  return (
    <div className="variant-draft">
      <PictureSlot
        url={preview}
        onPick={(file) => onChange({ ...d, file })}
        onRemove={() => onChange({ ...d, file: null })}
      />
      <div className="variant-draft-fields">
        <label className="field">
          <span>Màu hoặc size *</span>
          <input
            value={d.name}
            maxLength={80}
            required
            placeholder="VD: Đỏ son hoặc Size M"
            onChange={(e) => onChange({ ...d, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Giá bán (đ) *</span>
          <input
            type="number"
            min={0}
            step={1000}
            required
            value={d.price}
            onChange={(e) => onChange({ ...d, price: e.target.value })}
          />
        </label>
        {canStock && (
          <label className="field">
            <span>Tồn kho ban đầu</span>
            <input
              type="number"
              min={0}
              step={1}
              value={d.stock}
              onChange={(e) => onChange({ ...d, stock: e.target.value })}
            />
          </label>
        )}
      </div>
      {canRemove && (
        <button
          type="button"
          className="btn btn-sm btn-danger-outline variant-draft-remove"
          onClick={onRemove}
          aria-label={`Bỏ lựa chọn này ${index + 1}`}
        >
          Bỏ lựa chọn này
        </button>
      )}
    </div>
  );
}

export function ProductCreateForm({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const { request, upload, can } = useAdmin();
  const { pending, error, run } = useAction();
  const toast = useToast();
  const [form, setForm] = useState(emptyProductForm(categories[0]?.id ?? ''));
  const [drafts, setDrafts] = useState<Draft[]>(() => [blank()]);
  const [progress, setProgress] = useState('');
  const canStock = can('inventory:write');

  if (!can('catalog:write')) return <p className="form-error">Bạn không có quyền tạo sản phẩm.</p>;
  if (categories.length === 0)
    return <p className="form-note">Hãy tạo ít nhất một danh mục trước khi thêm sản phẩm.</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const big = drafts.find((d) => d.file && d.file.size > MAX_BYTES);
    if (big) return alert(`Ảnh “${big.file!.name}” vượt quá 8MB.`);
    let createdId: string | null = null;
    const id = await run(async () => {
      setProgress('Đang tạo sản phẩm…');
      const created = await request<{ id: string }>(
        'POST',
        '/admin/products',
        toPayload(form, true),
      );
      createdId = created.id;
      const taken: string[] = [];
      for (const [i, d] of drafts.entries()) {
        setProgress(`Đang thêm màu / size ${i + 1}/${drafts.length}…`);
        const sku = makeSku(form.name, d.name, taken);
        taken.push(sku);
        const detail = await request<AdminProductDetail>(
          'POST',
          `/admin/products/${created.id}/variants`,
          { sku, name: d.name.trim(), priceVnd: Math.floor(Number(d.price)) },
          { quiet: true },
        );
        const variant = detail.variants.find((v) => v.sku === sku);
        if (!variant) continue;
        if (d.file) {
          const fd = new FormData();
          fd.set('file', d.file);
          fd.set('alt', `${form.name} - ${d.name}`.slice(0, 200));
          fd.set('variantId', variant.id);
          await upload(`/admin/products/${created.id}/images`, fd, { quiet: true });
        }
        const stock = Math.floor(Number(d.stock));
        if (canStock && stock > 0)
          await request(
            'POST',
            '/admin/inventory/adjustments',
            { variantId: variant.id, delta: stock, reason: 'RECEIPT', note: 'Tồn kho ban đầu' },
            { idempotencyKey: newIdempotencyKey(), quiet: true },
          );
      }
      return created.id;
    });
    setProgress('');
    if (id) {
      toast('Đã tạo sản phẩm. Kiểm tra lại rồi bấm “Đăng bán”.', 'success');
      router.push(`/admin/products/${id}`);
    }
    // Created but a later step failed: continue in the editor instead of creating a duplicate.
    else if (createdId) {
      toast('Sản phẩm đã tạo nhưng chưa đủ màu/size hoặc ảnh. Hãy hoàn thiện tại đây.');
      router.push(`/admin/products/${createdId}`);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="admin-card">
        <h2>Thông tin sản phẩm</h2>
        <ProductFields value={form} onChange={setForm} categories={categories} />
      </div>

      <div className="admin-card">
        <div className="card-head">
          <div>
            <h2>Màu / size và ảnh nón</h2>
            <p className="card-sub">
              Mỗi màu hoặc size có ảnh, giá và tồn kho riêng (ví dụ nón đỏ dùng ảnh đỏ).{' '}
              {PICTURE_HINT}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            disabled={drafts.length >= 12}
            onClick={() => setDrafts([...drafts, blank()])}
          >
            + Thêm màu / size
          </button>
        </div>
        {drafts.map((d, i) => (
          <DraftRow
            key={d.key}
            d={d}
            index={i}
            canRemove={drafts.length > 1}
            canStock={canStock}
            onChange={(next) => setDrafts(drafts.map((x) => (x.key === d.key ? next : x)))}
            onRemove={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
          />
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? progress || 'Đang tạo…' : 'Tạo sản phẩm'}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => router.push('/admin/products')}
        >
          Hủy
        </button>
      </div>
    </form>
  );
}
