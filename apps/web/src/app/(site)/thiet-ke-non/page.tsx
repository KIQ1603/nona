import type { Metadata } from 'next';
import Link from 'next/link';
import { DesignEditor } from '@/features/custom/design-editor';
import { getCustomCatalog } from '@/features/custom/custom.api';
import { MyDesigns } from '@/features/custom/my-designs';

export const metadata: Metadata = {
  title: 'Thiết kế nón riêng',
  description: 'NONA Custom: thiết kế chiếc nón độc bản của riêng bạn.',
};

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CustomDesignPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const catalog = await getCustomCatalog().catch(() => null);
  if (!catalog || !catalog.options.enabled || catalog.products.length === 0)
    return (
      <div className="page-simple">
        <p className="eyebrow">NONA Custom</p>
        <h1>Tạm thời chưa mở</h1>
        <p>
          Dịch vụ thiết kế nón riêng hiện chưa sẵn sàng. Trong lúc chờ đợi, hãy khám phá bộ sưu tập
          hiện có.
        </p>
        <Link className="btn btn-dark" href="/shop">
          Xem bộ sưu tập
        </Link>
      </div>
    );
  return (
    <div className="custom-wrap">
      <header className="custom-head">
        <p className="eyebrow">NONA Custom</p>
        <h1>Thiết kế chiếc nón của bạn</h1>
        <p className="lead">
          Chọn màu nón và gắn các charm của cửa hàng lên chiếc nón yêu thích, rồi đặt hàng ngay.
          {catalog.options.requireApproval
            ? ' NONA sẽ xác nhận thiết kế trước khi nghệ nhân bắt tay vào làm.'
            : ''}
        </p>
      </header>
      <MyDesigns heading="Thiết kế gần đây của bạn" />
      <DesignEditor catalog={catalog} preselect={{ slug: one(sp.sanpham), variantId: one(sp.v) }} />
    </div>
  );
}
