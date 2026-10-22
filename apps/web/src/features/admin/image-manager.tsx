'use client';

import type { AdminProductDetail } from '@nona/contracts';
import { useRef } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';
import { PICTURE_ACCEPT } from './variant-picture';

const MAX_BYTES = 8 * 1024 * 1024;

/** General gallery pictures (not tied to one colour/variant). Variant pictures live in the variant cards. */
export function ImageManager({
  product,
  onChange,
}: {
  product: AdminProductDetail;
  onChange: (p: AdminProductDetail) => void;
}) {
  const { request, upload, can } = useAdmin();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const writable = can('catalog:write');
  const images = product.images.filter((i) => !i.variantId);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast(`“${file.name}” vượt quá 8MB`);
        continue;
      }
      const form = new FormData();
      form.set('file', file);
      form.set('alt', product.name);
      const res = await run(() =>
        upload<AdminProductDetail>(`/admin/products/${product.id}/images`, form),
      );
      if (res) onChange(res);
    }
    if (input.current) input.current.value = '';
  };

  const move = async (index: number, dir: -1 | 1) => {
    const ids = images.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    const rest = product.images.filter((i) => i.variantId).map((i) => i.id);
    const res = await run(() =>
      request<AdminProductDetail>('PUT', `/admin/products/${product.id}/images/order`, {
        imageIds: [...ids, ...rest],
      }),
    );
    if (res) onChange(res);
  };

  const remove = async (id: string) => {
    if (!window.confirm('Xóa ảnh này?')) return;
    const res = await run(() =>
      request<AdminProductDetail>('DELETE', `/admin/products/${product.id}/images/${id}`),
    );
    if (res) {
      onChange(res);
      toast('Đã xóa ảnh');
    }
  };

  return (
    <section className="admin-card" aria-labelledby="images-title">
      <div className="card-head">
        <div>
          <h2 id="images-title">Ảnh chung của sản phẩm</h2>
          <p className="card-sub">
            Ảnh giới thiệu dùng cho mọi màu/size (ảnh đầu tiên là ảnh đại diện). Ảnh riêng của từng
            màu nằm trong mục “Màu / size”.
          </p>
        </div>
        {writable && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {pending ? 'Đang tải lên…' : '+ Tải ảnh lên'}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="image-grid">
        {images.map((img, i) => (
          <figure className="image-tile" key={img.id} style={{ margin: 0 }}>
            <img src={img.url} alt={img.alt} width={img.width} height={img.height} />
            <figcaption>
              {i === 0 ? '★ Ảnh đại diện' : `Ảnh ${i + 1}`} · {img.width}×{img.height}
            </figcaption>
            {writable && (
              <div className="row-inline">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={pending || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Đưa ảnh ${i + 1} lên trước`}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={pending || i === images.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Đưa ảnh ${i + 1} ra sau`}
                >
                  →
                </button>
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  disabled={pending}
                  onClick={() => remove(img.id)}
                >
                  Xóa
                </button>
              </div>
            )}
          </figure>
        ))}
      </div>
      {images.length === 0 && <p className="card-sub">Chưa có ảnh chung nào.</p>}
    </section>
  );
}
