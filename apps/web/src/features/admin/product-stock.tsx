'use client';

import type { AdminProductDetail } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AnchoredMenu } from '@/components/admin/anchored-menu';
import { useToast } from '@/components/ui/toast';
import { newIdempotencyKey, useAdmin } from '@/lib/admin-client';

import { StockEditor } from './stock-editor';

type Variant = AdminProductDetail['variants'][number];

/** Stock column of the product list: the total, plus a quick +/- panel for each colour/size. */
export function ProductStockCell({
  id,
  total,
  writable,
}: {
  id: string;
  total: number;
  writable: boolean;
}) {
  const { request } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const sum = variants ? variants.reduce((s, v) => s + v.stock, 0) : total;

  const show = async () => {
    if (open) return close();
    setOpen(true);
    try {
      const d = await request<AdminProductDetail>('GET', `/admin/products/${id}`);
      setVariants(d.variants);
    } catch {
      setOpen(false);
    }
  };
  const close = () => {
    setOpen(false);
    if (changed) {
      setChanged(false);
      router.refresh();
    }
  };

  const adjust = async (v: Variant, delta: number): Promise<boolean> => {
    setBusy(v.id);
    try {
      const res = await request<{ stock: number }>(
        'POST',
        '/admin/inventory/adjustments',
        {
          variantId: v.id,
          delta,
          reason: delta > 0 ? 'RECEIPT' : 'ADJUSTMENT',
          note: delta > 0 ? 'Nhập nhanh' : 'Trừ nhanh',
        },
        { idempotencyKey: newIdempotencyKey(), quiet: true },
      );
      setVariants(
        (list) => list?.map((x) => (x.id === v.id ? { ...x, stock: res.stock } : x)) ?? list,
      );
      setChanged(true);
      toast(`Kho “${v.name}”: ${res.stock}`, 'success');
      return true;
    } catch {
      return false; // already reported as an error notice
    } finally {
      setBusy(null);
    }
  };

  const badge =
    sum <= 0 ? (
      <span className="pill pill-out">Hết</span>
    ) : sum <= 5 ? (
      <span className="pill pill-low">{sum}</span>
    ) : (
      sum
    );
  if (!writable) return <>{badge}</>;

  return (
    <>
      <span className="stock-cell">
        {badge}
        <button
          ref={anchor}
          type="button"
          className="btn btn-sm btn-outline"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Thêm / trừ nhanh số lượng"
          onClick={() => void show()}
        >
          ± Kho
        </button>
      </span>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        align="right"
        onClose={close}
        label="Chỉnh kho nhanh"
      >
        <div className="stock-panel">
          <div className="am-title">Chỉnh kho nhanh</div>
          {!variants && <p className="card-sub">Đang tải…</p>}
          {variants?.map((v) => (
            <div className="stock-row" key={v.id}>
              <span className="stock-name">
                <strong>{v.name}</strong>
                <small>{v.sku}</small>
              </span>
              <StockEditor
                stock={v.stock}
                label={v.name}
                busy={busy === v.id}
                onApply={(d) => adjust(v, d)}
              />
            </div>
          ))}
          {variants?.length === 0 && <p className="card-sub">Sản phẩm chưa có màu / size.</p>}
        </div>
      </AnchoredMenu>
    </>
  );
}
