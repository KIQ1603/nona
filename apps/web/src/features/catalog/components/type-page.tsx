import Link from 'next/link';
import type { CategoryDto, ProductListItem } from '@nona/contracts';
import { EmptyState } from '@/components/ui/empty-state';
import { getProducts } from '../api/catalog.api';
import { NonLaCard } from './nonla-card';

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="m5 9 7 7 7-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/** Three products in a row, each with a name pill under the picture. */
export function FeaturedRow({ products }: { products: ProductListItem[] }) {
  if (products.length === 0) return null;
  return (
    <section className="nl-featured" aria-labelledby="nl-featured-title">
      <h2 id="nl-featured-title">Sản phẩm nổi bật</h2>
      <ul>
        {products.map((p) => (
          <li key={p.slug}>
            <Link href={`/san-pham/${p.slug}`} className="nl-feat">
              <span className="nl-feat-img">
                {p.image && <img src={p.image.url} alt={p.image.alt || p.name} />}
              </span>
              <span className="nl-feat-pill">
                {p.name}
                <i aria-hidden="true">⌄</i>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A product TYPE page (Nón lá, Móc khóa, Kẹp tóc…), identical for every type: the products the admin marked
 * as featured, the type's name, then one collapsible group per category inside the type (products placed
 * directly in the type come first, without a heading). What shows is configured in the admin.
 */
export async function TypePage({
  type,
  groups,
  q,
}: {
  type: CategoryDto;
  /** The categories inside this type, in the admin's order. */
  groups: CategoryDto[];
  q?: string;
}) {
  const [featuredOnly, all, perGroup] = await Promise.all([
    q
      ? null
      : getProducts({ category: type.slug, featured: 'true', sort: 'featured', pageSize: 3 }),
    getProducts({ category: type.slug, q, sort: 'featured', pageSize: 48 }),
    Promise.all(
      groups.map(async (g) => ({
        group: g,
        items: (await getProducts({ category: g.slug, q, sort: 'featured', pageSize: 48 })).items,
      })),
    ),
  ]);
  // nothing flagged as featured yet: show the first products of the type instead of an empty block
  const featured =
    featuredOnly && featuredOnly.items.length > 0
      ? featuredOnly.items
      : q
        ? []
        : all.items.slice(0, 3);
  const direct = all.items.filter((p) => p.category.slug === type.slug);
  const shown = perGroup.filter((g) => g.items.length > 0);
  const empty = direct.length === 0 && shown.length === 0;

  return (
    <div className="nl">
      <FeaturedRow products={featured} />
      <h1 className="nl-title">{q ? `${type.name}: kết quả cho “${q}”` : type.name}</h1>
      {direct.length > 0 && (
        <div className="nl-grid nl-direct">
          {direct.map((product) => (
            <NonLaCard key={product.id} product={product} />
          ))}
        </div>
      )}
      {shown.map(({ group, items }) => (
        <details className="nl-group" id={group.slug} key={group.slug} open>
          <summary>
            <h2>{group.name}</h2>
            <Chevron />
          </summary>
          <div className="nl-grid">
            {items.map((product) => (
              <NonLaCard key={product.id} product={product} />
            ))}
          </div>
        </details>
      ))}
      {empty && (
        <EmptyState title={q ? 'Chưa tìm thấy sản phẩm phù hợp' : 'Sắp ra mắt'}>
          <p>
            {q
              ? 'Thử đổi từ khóa nhé.'
              : `Bộ sưu tập ${type.name.toLowerCase()} đang được cập nhật.`}
          </p>
          {q && (
            <Link className="btn btn-dark" href={`/shop/${type.slug}`}>
              Xem tất cả
            </Link>
          )}
        </EmptyState>
      )}
    </div>
  );
}
