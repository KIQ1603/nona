import Link from 'next/link';
import { wishlistSchema } from '@nona/contracts';
import { EmptyState } from '@/components/ui/empty-state';
import { getProducts } from '@/features/catalog/api/catalog.api';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { userGet } from '@/lib/session-server';

export default async function WishlistPage() {
  const { slugs } = await userGet('/wishlist', wishlistSchema, '/tai-khoan/yeu-thich');
  const products = slugs.length
    ? (await getProducts({ slugs: slugs.slice(0, 48), pageSize: 48 })).items
    : [];
  // Preserve the order the shopper saved them in.
  const ordered = slugs.flatMap((s) => products.filter((p) => p.slug === s));
  return (
    <>
      <h1>Yêu thích</h1>
      <p className="lead">{ordered.length} sản phẩm bạn đã lưu.</p>
      {ordered.length ? (
        <ProductGrid products={ordered} />
      ) : (
        <EmptyState title="Chưa có sản phẩm yêu thích" icon="♡">
          <p>Bấm vào biểu tượng trái tim trên sản phẩm để lưu lại.</p>
          <Link className="btn btn-dark" href="/shop">
            Khám phá cửa hàng
          </Link>
        </EmptyState>
      )}
    </>
  );
}
