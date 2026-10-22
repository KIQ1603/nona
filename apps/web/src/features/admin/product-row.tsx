'use client';

import type { AdminProductDetail } from '@nona/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AnchoredMenu } from '@/components/admin/anchored-menu';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

type Status = AdminProductDetail['status'];
const LABELS: Record<Status, string> = {
  PUBLISHED: 'Đang bán',
  DRAFT: 'Nháp',
  ARCHIVED: 'Lưu trữ',
};
const DONE: Record<Status, string> = {
  PUBLISHED: 'Đã đăng bán sản phẩm',
  DRAFT: 'Đã chuyển sản phẩm về nháp',
  ARCHIVED: 'Đã lưu trữ sản phẩm',
};
const HINT: Record<Status, string> = {
  PUBLISHED: 'Hiện trên cửa hàng',
  DRAFT: 'Ẩn khỏi cửa hàng, vẫn sửa được',
  ARCHIVED: 'Ẩn khỏi cửa hàng',
};

/** Moves a product to another status. The version is read just before the write, so a stale list row cannot conflict. */
function useProductStatus(id: string) {
  const { request } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const change = async (next: Status) => {
    setPending(true);
    try {
      const detail = await request<AdminProductDetail>('GET', `/admin/products/${id}`);
      await request(
        'PATCH',
        `/admin/products/${id}`,
        {
          status: next,
          version: detail.version,
        },
        { quiet: true },
      );
      toast(DONE[next], 'success');
      router.refresh();
    } catch {
      // the failure has already been shown as an error notice
    } finally {
      setPending(false);
    }
  };
  return { change, pending };
}

/** The status badge is the control: click it to publish, unpublish or archive. */
export function ProductStatusCell({
  id,
  status,
  writable,
}: {
  id: string;
  status: Status;
  writable: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { change, pending } = useProductStatus(id);
  const badge = `pill pill-${status.toLowerCase()}`;
  if (!writable) return <span className={badge}>{LABELS[status]}</span>;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${badge} pill-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Đổi trạng thái"
        disabled={pending}
        onClick={() => setOpen(!open)}
      >
        {pending ? 'Đang đổi…' : LABELS[status]}
        <span aria-hidden="true"> ▾</span>
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label="Đổi trạng thái"
      >
        <div className="am-title">Chuyển sang</div>
        {(['PUBLISHED', 'DRAFT', 'ARCHIVED'] as Status[])
          .filter((s) => s !== status)
          .map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              className={`am-item${s === 'ARCHIVED' ? ' danger' : ''}`}
              onClick={() => {
                setOpen(false);
                if (
                  s === 'ARCHIVED' &&
                  !window.confirm('Lưu trữ sản phẩm này? Sản phẩm sẽ ẩn khỏi cửa hàng.')
                )
                  return;
                void change(s);
              }}
            >
              <span className={`pill pill-${s.toLowerCase()}`} aria-hidden="true">
                &nbsp;
              </span>
              <span>
                {LABELS[s]}
                <small>{HINT[s]}</small>
              </span>
            </button>
          ))}
      </AnchoredMenu>
    </>
  );
}

/** The "⋯" at the end of a product row: edit, view on the shop, archive. */
export function ProductRowMenu({
  id,
  slug,
  name,
  status,
  writable,
}: {
  id: string;
  slug: string;
  name: string;
  status: Status;
  writable: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { change } = useProductStatus(id);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="row-more"
        aria-label={`Thao tác cho ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        align="right"
        onClose={() => setOpen(false)}
        label="Thao tác"
      >
        <Link
          className="am-item"
          role="menuitem"
          href={`/admin/products/${id}`}
          onClick={() => setOpen(false)}
        >
          <span aria-hidden="true">✎</span>
          <span>{writable ? 'Sửa sản phẩm' : 'Xem chi tiết'}</span>
        </Link>
        {status === 'PUBLISHED' && (
          <Link
            className="am-item"
            role="menuitem"
            href={`/san-pham/${slug}`}
            target="_blank"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">↗</span>
            <span>Xem trên cửa hàng</span>
          </Link>
        )}
        {writable && status !== 'ARCHIVED' && (
          <button
            type="button"
            role="menuitem"
            className="am-item danger"
            onClick={() => {
              setOpen(false);
              if (window.confirm(`Xóa (lưu trữ) “${name}”? Sản phẩm sẽ ẩn khỏi cửa hàng.`))
                void change('ARCHIVED');
            }}
          >
            <span aria-hidden="true">🗑</span>
            <span>Xóa (lưu trữ)</span>
          </button>
        )}
      </AnchoredMenu>
    </>
  );
}
