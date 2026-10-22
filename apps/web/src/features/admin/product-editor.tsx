'use client';

import type { AdminCategory, AdminProductDetail } from '@nona/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { StatusPill } from '@/components/admin/status-pill';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';
import { ImageManager } from './image-manager';
import { ProductFields, toPayload, type ProductFormState } from './product-fields';
import { VariantManager } from './variant-manager';

const toForm = (p: AdminProductDetail): ProductFormState => ({
  name: p.name,
  slug: p.slug,
  categoryId: p.category.id,
  summary: p.summary ?? '',
  description: p.description ?? '',
  badge: p.badge ?? '',
  colorCode: p.colorCode ?? '',
  styleCode: p.styleCode ?? '',
  sortWeight: p.sortWeight,
  isCustomizable: p.isCustomizable,
  hatWidthCm: p.hatWidthCm === null ? '' : String(p.hatWidthCm),
  hatHeightCm: p.hatHeightCm === null ? '' : String(p.hatHeightCm),
  seoTitle: p.seoTitle ?? '',
  seoDescription: p.seoDescription ?? '',
});

export function ProductEditor({
  initial,
  categories,
}: {
  initial: AdminProductDetail;
  categories: AdminCategory[];
}) {
  const { request, can } = useAdmin();
  const toast = useToast();
  const [product, setProduct] = useState(initial);
  const [form, setForm] = useState(toForm(initial));
  const info = useAction();
  const status = useAction();
  const writable = can('catalog:write');

  /** Child sections return the fresh product; keep the form in sync only for fields the user hasn't touched. */
  const applyDetail = (next: AdminProductDetail) => setProduct(next);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const res = await info.run(() =>
      request<AdminProductDetail>('PATCH', `/admin/products/${product.id}`, {
        ...toPayload(form, true),
        slug: form.slug.trim() || product.slug,
        version: product.version,
      }),
    );
    if (res) {
      setProduct(res);
      setForm(toForm(res));
      toast('Đã lưu thông tin sản phẩm');
    }
  };

  const setStatus = async (next: AdminProductDetail['status']) => {
    const res = await status.run(() =>
      request<AdminProductDetail>('PATCH', `/admin/products/${product.id}`, {
        status: next,
        version: product.version,
      }),
    );
    if (res) {
      setProduct(res);
      toast(
        next === 'PUBLISHED'
          ? 'Đã đăng bán sản phẩm'
          : next === 'DRAFT'
            ? 'Đã chuyển về nháp'
            : 'Đã lưu trữ sản phẩm',
      );
    }
  };

  const conflict = [info.error, status.error].some(
    (m) => m?.includes('chỉnh sửa') || m?.includes('tải lại'),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <p>
            <Link href="/admin/products">← Sản phẩm</Link>
          </p>
          <h1 className="row-inline">
            {product.name} <StatusPill status={product.status} />
          </h1>
          <p>
            /{product.slug} · phiên bản {product.version}
          </p>
        </div>
        {writable && (
          <div className="form-actions">
            {product.status === 'PUBLISHED' && (
              <Link className="btn btn-outline" href={`/san-pham/${product.slug}`} target="_blank">
                Xem trên cửa hàng ↗
              </Link>
            )}
            {product.status !== 'PUBLISHED' && (
              <button
                className="btn btn-primary"
                disabled={status.pending || product.publishIssues.length > 0}
                onClick={() => setStatus('PUBLISHED')}
              >
                Đăng bán
              </button>
            )}
            {product.status === 'PUBLISHED' && (
              <button
                className="btn btn-outline"
                disabled={status.pending}
                onClick={() => setStatus('DRAFT')}
              >
                Gỡ xuống (nháp)
              </button>
            )}
            {product.status !== 'ARCHIVED' && (
              <button
                className="btn btn-outline"
                disabled={status.pending}
                onClick={() =>
                  window.confirm('Lưu trữ sản phẩm này? Sản phẩm sẽ ẩn khỏi cửa hàng.') &&
                  setStatus('ARCHIVED')
                }
              >
                Lưu trữ
              </button>
            )}
          </div>
        )}
      </div>

      {status.error && (
        <p className="form-error" role="alert">
          {status.error}
        </p>
      )}
      {product.status !== 'PUBLISHED' && product.publishIssues.length > 0 && (
        <div className="admin-card" style={{ marginBottom: 18 }}>
          <strong>Cần hoàn thiện trước khi đăng bán:</strong>
          <ul className="issue-list">
            {product.publishIssues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
      {conflict && (
        <p className="form-error">
          Dữ liệu đã thay đổi ở nơi khác.{' '}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => window.location.reload()}
          >
            Tải lại trang
          </button>
        </p>
      )}

      <form className="admin-card" onSubmit={save}>
        <div className="card-head">
          <h2>Thông tin sản phẩm</h2>
        </div>
        <fieldset disabled={!writable} style={{ border: 0, padding: 0, margin: 0 }}>
          <ProductFields
            value={form}
            onChange={setForm}
            categories={categories}
            slugHint="Đổi slug sẽ làm đổi đường dẫn sản phẩm trên cửa hàng."
          />
        </fieldset>
        {info.error && (
          <p className="form-error" role="alert">
            {info.error}
          </p>
        )}
        {writable && (
          <button className="btn btn-primary" type="submit" disabled={info.pending}>
            {info.pending ? 'Đang lưu…' : 'Lưu thông tin'}
          </button>
        )}
      </form>

      <VariantManager product={product} onChange={applyDetail} />
      <ImageManager product={product} onChange={applyDetail} />
    </>
  );
}
