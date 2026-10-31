import type { Metadata } from 'next';
import Link from 'next/link';
import { getCategories, getProducts } from '@/features/catalog/api/catalog.api';
import { NonLaCard } from '@/features/catalog/components/nonla-card';
import { getCustomCatalog } from '@/features/custom/custom.api';
import { BannerSlider } from '@/components/ui/banner-slider';
import { DesignShowcase } from '@/features/home/design-showcase';
import { getMe } from '@/lib/admin-server';
import { HOME_BANNER } from '@/lib/banner';

export const metadata: Metadata = {
  title: 'Trang chủ',
  alternates: { canonical: '/trang-chu' },
};

/** Pictures for the product types we know; any other type uses a picture of its first product. */
const TYPE_PHOTOS: Record<string, string> = {
  'non-la': '/brand/home-nonla.jpg',
  'moc-khoa': '/brand/home-mockhoa.jpg',
  'kep-toc': '/brand/home-keptoc.jpg',
};

/**
 * Home (public: guests see it too, a signed-in customer is also greeted by name): hero, the shop's product types (admin-managed), featured products (admin-flagged), a short
 * story, and the designer banner. The header (with the "Sản phẩm" dropdown) and the contact footer come from
 * the site shell.
 */
export default async function CustomerHomePage() {
  const [user, categories, flagged, customCatalog] = await Promise.all([
    getMe().catch(() => null),
    getCategories(),
    getProducts({ featured: 'true', sort: 'featured', pageSize: 8 }),
    getCustomCatalog().catch(() => null),
  ]);
  // nothing flagged as featured yet: show the first products rather than an empty block
  const featured =
    flagged.items.length > 0 ? flagged : await getProducts({ sort: 'featured', pageSize: 8 });
  const types = categories.items.filter((c) => c.parentSlug === null);
  const cards = await Promise.all(
    types.slice(0, 6).map(async (t) => ({
      type: t,
      image:
        TYPE_PHOTOS[t.slug] ??
        (await getProducts({ category: t.slug, sort: 'featured', pageSize: 1 })).items[0]?.image
          ?.url ??
        null,
    })),
  );

  const firstName = user ? user.fullName.trim().split(/\s+/).at(-1) || user.fullName : null;

  return (
    <div className="hm">
      <section
        className="hero-split hm-hero"
        style={{ '--hero-bg': '#3c2218' } as React.CSSProperties}
        aria-labelledby="hm-title"
      >
        <div className="hero-copy hm-hero-copy">
          {firstName && <p className="hm-hello">Chào {firstName}, mừng bạn trở lại</p>}
          <h1 id="hm-title">Chằm nét xưa, gài duyên nay</h1>
          <p className="hm-sub">
            Khám phá những chiếc nón lá và phụ kiện mang cảm hứng truyền thống, được sáng tạo để lưu
            giữ nét đẹp Việt theo cách riêng của bạn.
          </p>
          <div className="hm-actions">
            <Link className="hm-cta" href={types[0] ? `/shop/${types[0].slug}` : '/shop'}>
              Khám phá sản phẩm
            </Link>
            <Link className="hm-cta hm-cta-ghost" href="/thiet-ke-non">
              Tự thiết kế ngay
            </Link>
          </div>
        </div>
        <BannerSlider images={HOME_BANNER} />
      </section>

      {cards.length > 0 && (
        <section className="hm-section" aria-labelledby="hm-types-title">
          <h2 id="hm-types-title">Danh mục sản phẩm</h2>
          <ul className="hm-types">
            {cards.map(({ type, image }) => (
              <li key={type.slug}>
                <Link href={`/shop/${type.slug}`} className="hm-type">
                  <span className="hm-type-img">
                    {image && <img src={image} alt="" loading="lazy" />}
                  </span>
                  <strong>{type.name}</strong>
                  <span className="hm-type-note">
                    {type.description ?? 'Thủ công mang đậm bản sắc Việt.'}
                  </span>
                  <span className="hm-btn">Xem sản phẩm</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featured.items.length > 0 && (
        <section className="hm-section hm-products" aria-labelledby="hm-featured-title">
          <div className="hm-head">
            <h2 id="hm-featured-title">Sản phẩm nổi bật</h2>
            <Link href={types[0] ? `/shop/${types[0].slug}` : '/shop'}>Xem tất cả</Link>
          </div>
          <div className="nl-grid hm-grid">
            {featured.items.map((product) => (
              <NonLaCard
                key={product.id}
                product={product}
                cartLabel="Thêm vào giỏ hàng"
                detailLabel="Xem chi tiết"
              />
            ))}
          </div>
        </section>
      )}

      <section className="hm-story" aria-labelledby="hm-story-title">
        <div className="hm-story-img">
          <img src="/brand/about-craft.jpg" alt="Nghệ nhân chằm nón lá" loading="lazy" />
        </div>
        <div className="hm-story-copy">
          <h2 id="hm-story-title">Về Sắc Chằm</h2>
          <p>
            Mỗi đường chằm không chỉ kết nối những lớp lá mà còn nối dài câu chuyện văn hóa Việt.
            Sắc Chằm mong muốn đưa những giá trị thủ công truyền thống đến gần hơn với đời sống hôm
            nay.
          </p>
          <Link className="hm-cta" href="/">
            Khám phá câu chuyện của chúng mình
          </Link>
        </div>
      </section>

      <DesignShowcase catalog={customCatalog} />
    </div>
  );
}
