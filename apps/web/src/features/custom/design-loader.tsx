'use client';

import { designSchema, type CustomCatalog, type DesignDto } from '@nona/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useCustomer } from '@/lib/customer-client';
import { DesignEditor } from './design-editor';

/** Designs are private (owner cookie / account), so they are loaded in the browser, never cached server-side. */
export function DesignLoader({ id, catalog }: { id: string; catalog: CustomCatalog }) {
  const { request, status, user } = useCustomer();
  const [state, setState] = useState<{ design: DesignDto } | { missing: true } | null>(null);
  useEffect(() => {
    if (status === 'loading') return;
    let live = true;
    request<unknown>('GET', `/custom-designs/${id}`)
      .then((raw) => live && setState({ design: designSchema.parse(raw) }))
      .catch(
        (e) =>
          live &&
          (e instanceof ApiError && e.status !== 404
            ? setState({ missing: true })
            : setState({ missing: true })),
      );
    return () => {
      live = false;
    };
  }, [id, request, status, user?.id]);

  if (!state) return <p className="lead">Đang tải thiết kế…</p>;
  if ('missing' in state)
    return (
      <div className="page-simple">
        <h1>Không tìm thấy thiết kế</h1>
        <p>
          Thiết kế này không tồn tại hoặc không thuộc về bạn. Nếu bạn đã thiết kế khi chưa đăng
          nhập, hãy dùng cùng trình duyệt hoặc đăng nhập tài khoản đã dùng.
        </p>
        <Link className="btn btn-dark" href="/thiet-ke-non">
          Thiết kế mới
        </Link>
      </div>
    );
  return <DesignEditor key={state.design.latest.id} catalog={catalog} initial={state.design} />;
}
