'use client';

import { Dropdown } from '@/components/ui/dropdown';
import { formatVnd, INVENTORY_REASONS, type AdminProductDetail } from '@nona/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { newIdempotencyKey, useAdmin } from '@/lib/admin-client';
import { makeSku } from '@/lib/sku';
import { StockEditor } from './stock-editor';
import { PICTURE_HINT, PictureSlot } from './variant-picture';

type Variant = AdminProductDetail['variants'][number];
const REASON_LABEL: Record<(typeof INVENTORY_REASONS)[number], string> = {
  RECEIPT: 'Nhập kho',
  RETURN: 'Khách trả hàng',
  ADJUSTMENT: 'Điều chỉnh (kiểm kê)',
};

function StockDialog({
  variant,
  onClose,
  onDone,
}: {
  variant: Variant;
  onClose: () => void;
  onDone: (stock: number) => void;
}) {
  const { request } = useAdmin();
  const { pending, error, run } = useAction();
  const [reason, setReason] = useState<(typeof INVENTORY_REASONS)[number]>('RECEIPT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // One key per dialog instance: double-clicks and network retries replay instead of double-applying.
  const [key] = useState(newIdempotencyKey);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.floor(Number(amount));
    if (!n) return;
    const delta = reason === 'ADJUSTMENT' ? n : Math.abs(n);
    const res = await run(() =>
      request<{ stock: number }>(
        'POST',
        '/admin/inventory/adjustments',
        { variantId: variant.id, delta, reason, ...(note.trim() ? { note: note.trim() } : {}) },
        { idempotencyKey: key },
      ),
    );
    if (res) onDone(res.stock);
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-title"
        onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h3 id="stock-title">Điều chỉnh kho — {variant.sku}</h3>
        <p>
          Tồn hiện tại: <strong>{variant.stock}</strong>
        </p>
        <label className="field">
          <span>Loại</span>
          <Dropdown
            ariaLabel="Loại điều chỉnh"
            value={reason}
            onChange={(v) => setReason(v as typeof reason)}
            options={INVENTORY_REASONS.map((r) => ({ value: r, label: REASON_LABEL[r] }))}
          />
        </label>
        <label className="field">
          <span>{reason === 'ADJUSTMENT' ? 'Số lượng (+ tăng, − giảm)' : 'Số lượng'}</span>
          <input
            type="number"
            step={1}
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Ghi chú</span>
          <input
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder="VD: Nhập lô tháng 10"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            Xác nhận
          </button>
          <button className="btn btn-outline" type="button" onClick={onClose}>
            Hủy
          </button>
        </div>
      </form>
    </div>
  );
}

function VariantCard({
  variant,
  product,
  writable,
  canStock,
  onSaved,
  onStock,
}: {
  variant: Variant;
  product: AdminProductDetail;
  writable: boolean;
  canStock: boolean;
  onSaved: (p: AdminProductDetail) => void;
  onStock: () => void;
}) {
  const { request, upload } = useAdmin();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const pic = useAction();
  const quickStock = useAction();
  const image = product.images.find((i) => i.variantId === variant.id) ?? null;
  const [f, setF] = useState({
    name: variant.name,
    price: String(variant.priceVnd),
    compare: variant.compareAtPriceVnd === null ? '' : String(variant.compareAtPriceVnd),
    active: variant.isActive,
    weight: variant.weightGrams === null ? '' : String(variant.weightGrams),
  });
  const dirty =
    f.name !== variant.name ||
    Number(f.price) !== variant.priceVnd ||
    (f.compare === '' ? null : Number(f.compare)) !== variant.compareAtPriceVnd ||
    f.active !== variant.isActive ||
    (f.weight === '' ? null : Number(f.weight)) !== variant.weightGrams;

  const save = async () => {
    const res = await run(() =>
      request<AdminProductDetail>('PATCH', `/admin/variants/${variant.id}`, {
        name: f.name.trim(),
        priceVnd: Math.floor(Number(f.price)),
        compareAtPriceVnd: f.compare === '' ? null : Math.floor(Number(f.compare)),
        isActive: f.active,
        weightGrams: f.weight === '' ? null : Math.floor(Number(f.weight)),
      }),
    );
    if (res) {
      onSaved(res);
      toast(`Đã lưu “${f.name.trim()}”`);
    }
  };

  /** One-click stock changes (+1, -1, +10) recorded in the stock ledger. */
  const quick = async (delta: number): Promise<boolean> => {
    const res = await quickStock.run(() =>
      request<{ stock: number }>(
        'POST',
        '/admin/inventory/adjustments',
        {
          variantId: variant.id,
          delta,
          reason: delta > 0 ? 'RECEIPT' : 'ADJUSTMENT',
          note: delta > 0 ? 'Nhập nhanh' : 'Trừ nhanh',
        },
        { idempotencyKey: newIdempotencyKey(), quiet: true },
      ),
    );
    if (res) {
      onSaved({
        ...product,
        variants: product.variants.map((v) =>
          v.id === variant.id ? { ...v, stock: res.stock } : v,
        ),
      });
      toast(`Kho “${variant.name}”: ${res.stock}`, 'success');
    }
    return Boolean(res);
  };

  const setPicture = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) return toast('Ảnh vượt quá 8MB');
    const fd = new FormData();
    fd.set('file', file);
    fd.set('alt', `${product.name} - ${variant.name}`.slice(0, 200));
    fd.set('variantId', variant.id);
    const res = await pic.run(() =>
      upload<AdminProductDetail>(`/admin/products/${product.id}/images`, fd),
    );
    if (res) {
      onSaved(res);
      toast(`Đã cập nhật ảnh “${variant.name}”`);
    }
  };
  const removePicture = async () => {
    if (!image || !window.confirm(`Gỡ ảnh của “${variant.name}”?`)) return;
    const res = await pic.run(() =>
      request<AdminProductDetail>('DELETE', `/admin/products/${product.id}/images/${image.id}`),
    );
    if (res) onSaved(res);
  };

  return (
    <article className={`variant-card${variant.isActive ? '' : ' off'}`}>
      <PictureSlot
        url={image?.url ?? null}
        busy={pic.pending}
        disabled={!writable}
        onPick={(file) => void setPicture(file)}
        onRemove={() => void removePicture()}
      />
      <div className="variant-body">
        <header>
          <strong>{variant.name}</strong>
          <small>SKU {variant.sku}</small>
          {!variant.isActive && <span className="pill pill-out">Ngừng bán</span>}
        </header>
        <div className="variant-grid">
          <label className="field">
            <span>Màu hoặc size</span>
            <input
              value={f.name}
              disabled={!writable}
              maxLength={80}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Giá bán (đ)</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={f.price}
              disabled={!writable}
              onChange={(e) => setF({ ...f, price: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Giá gốc (đ)</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={f.compare}
              placeholder="Không giảm giá"
              disabled={!writable}
              onChange={(e) => setF({ ...f, compare: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Khối lượng (g)</span>
            <input
              type="number"
              min={1}
              value={f.weight}
              placeholder="Tùy chọn"
              disabled={!writable}
              onChange={(e) => setF({ ...f, weight: e.target.value })}
            />
          </label>
        </div>
        <footer>
          <label className="row-inline">
            <input
              type="checkbox"
              checked={f.active}
              disabled={!writable}
              onChange={(e) => setF({ ...f, active: e.target.checked })}
            />{' '}
            <span>Đang bán</span>
          </label>
          <span className="variant-stock">
            {canStock ? (
              <StockEditor
                stock={variant.stock}
                label={variant.name}
                busy={quickStock.pending}
                onApply={quick}
              />
            ) : variant.stock <= 0 ? (
              <span className="pill pill-out">Hết</span>
            ) : (
              <strong>{variant.stock}</strong>
            )}
          </span>
          <span className="variant-buttons">
            {canStock && (
              <button type="button" className="btn btn-sm btn-outline" onClick={onStock}>
                Nhập / kiểm kê kho
              </button>
            )}
            {writable && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!dirty || pending}
                onClick={save}
              >
                {pending ? 'Đang lưu…' : 'Lưu thay đổi'}
              </button>
            )}
          </span>
        </footer>
        {(error || pic.error) && (
          <p className="form-error" role="alert" style={{ margin: 0 }}>
            {error ?? pic.error}
          </p>
        )}
      </div>
    </article>
  );
}

export function VariantManager({
  product,
  onChange,
}: {
  product: AdminProductDetail;
  onChange: (p: AdminProductDetail) => void;
}) {
  const { request, upload, can } = useAdmin();
  const toast = useToast();
  const add = useAction();
  const [stockFor, setStockFor] = useState<Variant | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    price: string;
    stock: string;
    file: File | null;
  }>({ name: '', price: '', stock: '0', file: null });
  const writable = can('catalog:write');
  const canStock = can('inventory:write');
  const reset = () => setDraft({ name: '', price: '', stock: '0', file: null });
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.file) return setPreview(null);
    const u = URL.createObjectURL(draft.file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [draft.file]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const res = await add.run(async () => {
      const sku = makeSku(
        product.name,
        draft.name,
        product.variants.map((v) => v.sku),
      );
      let detail = await request<AdminProductDetail>(
        'POST',
        `/admin/products/${product.id}/variants`,
        {
          sku,
          name: draft.name.trim(),
          priceVnd: Math.floor(Number(draft.price)),
        },
        { quiet: true },
      );
      const created = detail.variants.find((v) => v.sku === sku);
      if (created && draft.file) {
        const fd = new FormData();
        fd.set('file', draft.file);
        fd.set('alt', `${product.name} - ${draft.name}`.slice(0, 200));
        fd.set('variantId', created.id);
        detail = await upload<AdminProductDetail>(`/admin/products/${product.id}/images`, fd, {
          quiet: true,
        });
      }
      const stock = Math.floor(Number(draft.stock));
      if (created && canStock && stock > 0) {
        await request(
          'POST',
          '/admin/inventory/adjustments',
          { variantId: created.id, delta: stock, reason: 'RECEIPT', note: 'Tồn kho ban đầu' },
          { idempotencyKey: newIdempotencyKey(), quiet: true },
        );
        detail = {
          ...detail,
          variants: detail.variants.map((v) => (v.id === created.id ? { ...v, stock } : v)),
        };
      }
      return detail;
    });
    if (res) {
      onChange(res);
      reset();
      setAdding(false);
      toast('Đã thêm màu / size');
    }
  };

  return (
    <section className="admin-card" aria-labelledby="variants-title">
      <div className="card-head">
        <div>
          <h2 id="variants-title">Màu / size, ảnh, giá và tồn kho</h2>
          <p className="card-sub">
            Mỗi sản phẩm có ít nhất một lựa chọn <b>màu hoặc size</b> (ví dụ nón đỏ, nón xanh, size
            M, size L). Mỗi lựa chọn có mã SKU, ảnh, giá và tồn kho riêng; khách thiết kế trực tiếp
            trên ảnh của lựa chọn đang chọn. {PICTURE_HINT}
          </p>
        </div>
        {writable && !adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + Thêm màu / size
          </button>
        )}
      </div>

      {writable && adding && (
        <form onSubmit={create} className="variant-card variant-new">
          <PictureSlot
            url={preview}
            onPick={(file) => setDraft({ ...draft, file })}
            onRemove={() => setDraft({ ...draft, file: null })}
          />
          <div className="variant-body">
            <header>
              <strong>Màu / size mới</strong>
            </header>
            <div className="variant-grid">
              <label className="field">
                <span>Màu hoặc size *</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                  autoFocus
                  maxLength={80}
                  placeholder="VD: Xanh rêu hoặc Size M"
                />
              </label>
              <label className="field">
                <span>Giá bán (đ) *</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  required
                />
              </label>
              {canStock && (
                <label className="field">
                  <span>Tồn kho ban đầu</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.stock}
                    onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                  />
                </label>
              )}
            </div>
            {add.error && (
              <p className="form-error" role="alert">
                {add.error}
              </p>
            )}
            <footer>
              <span />
              <span className="variant-buttons">
                <button type="submit" className="btn btn-sm btn-primary" disabled={add.pending}>
                  {add.pending ? 'Đang thêm…' : 'Thêm màu / size'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    reset();
                    setAdding(false);
                  }}
                >
                  Hủy
                </button>
              </span>
            </footer>
          </div>
        </form>
      )}

      {product.variants.map((v) => (
        <VariantCard
          key={`${v.id}:${v.priceVnd}:${v.compareAtPriceVnd}:${v.isActive}:${v.name}:${v.weightGrams}`}
          variant={v}
          product={product}
          writable={writable}
          canStock={canStock}
          onSaved={onChange}
          onStock={() => setStockFor(v)}
        />
      ))}
      {product.variants.length === 0 && !adding && (
        <p className="card-sub">
          Chưa có màu / size nào. Thêm ít nhất một màu hoặc size để đăng bán.
        </p>
      )}

      {stockFor && (
        <StockDialog
          variant={stockFor}
          onClose={() => setStockFor(null)}
          onDone={(stock) => {
            onChange({
              ...product,
              variants: product.variants.map((v) => (v.id === stockFor.id ? { ...v, stock } : v)),
            });
            setStockFor(null);
            toast('Đã cập nhật tồn kho');
          }}
        />
      )}
    </section>
  );
}
