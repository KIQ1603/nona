import { type LandingContent, type ProductListItem } from '@nona/contracts';
import Link from 'next/link';
import { BannerSlider } from '@/components/ui/banner-slider';
import { ABOUT_BANNER } from '@/lib/banner';

/** Photo for each core value (replace the files in /public/brand to change them). */
const ABOUT_VALUES = [
  { label: 'Trân trọng bản sắc Việt', image: '/brand/value-ban-sac.jpg' },
  { label: 'Đề cao sự khéo léo và tinh thần thủ công', image: '/brand/value-thu-cong.jpg' },
  { label: 'Khuyến khích sáng tạo, cá nhân hóa', image: '/brand/value-sang-tao.jpg' },
  {
    label: 'Đưa các sản phẩm truyền thống vào đời sống hiện đại',
    image: '/brand/value-hien-dai.jpg',
  },
];
/** Photos under the story: workers, the hat from behind, the embroidery (replace the files to change them). */
const ABOUT_GALLERY = ['/brand/about-craft.jpg', '/brand/about-story.jpg', '/brand/about-hero.jpg'];

/** The Giới thiệu page body. The header and footer come from the site shell like every other page. */
export function LandingExperience({
  products,
}: {
  content?: LandingContent;
  products: ProductListItem[];
}) {
  return (
    <div className="ab-page">
      <main>
        <section
          className="hero-split ab-hero"
          id="gioi-thieu"
          style={{ '--hero-bg': '#efe2d4' } as React.CSSProperties}
          aria-labelledby="ab-title"
        >
          <div className="hero-copy ab-hero-copy">
            <h1 id="ab-title">Về dự án Sắc Chằm</h1>
            <p className="ab-lead">
              Sắc Chằm mang nét duyên nón lá Làng Chuông vào những thiết kế nón và phụ kiện dành cho
              đời sống hôm nay, để vẻ đẹp truyền thống trở thành một phần trong phong cách riêng của
              bạn.
            </p>
          </div>
          <BannerSlider images={ABOUT_BANNER} />
        </section>

        <section className="ab-story" id="cau-chuyen" aria-labelledby="ab-story-title">
          <h2 id="ab-story-title">Câu chuyện của chúng tôi</h2>
          <div className="ab-story-text">
            <p>
              Có những điều thân thuộc đến mức ta ít khi dừng lại để ngắm nhìn. Chiếc nón lá là một
              điều như thế, hiện diện trong ký ức về bà, về mẹ, trong những buổi chợ và trên những
              con đường quê. Dáng nón giản dị ấy chứa đựng cả sự khéo léo của người làm nghề và nét
              duyên đã đi cùng bao thế hệ người Việt.
            </p>
            <p>
              Với Sắc Chằm, câu chuyện bắt đầu từ Làng Chuông, nơi những đôi tay vẫn tỉ mỉ làm nên
              từng chiếc nón. Từ lá, vành tre đến từng đường kim, mỗi công đoạn đều cần sự kiên nhẫn
              và kinh nghiệm. Nhìn một chiếc nón thành hình, chúng mình hiểu rằng điều đáng quý còn
              nằm ở những tháng năm người thợ gắn bó với nghề, ở những kỹ năng được trao truyền qua
              từng thế hệ.
            </p>
            <p>
              Từ đó, chúng mình tự hỏi: chiếc nón có thể đồng hành cùng người trẻ hôm nay theo những
              cách nào? Có thể là một phụ kiện trong chuyến đi, một nét duyên bên tà áo dài cô dâu,
              hay một điểm nhấn giữa không khí sôi động của sự kiện. Trên nền phôi nón Làng Chuông,
              Sắc Chằm phát triển những cách phối màu, trang trí và cá nhân hóa để mỗi thiết kế vừa
              giữ được dáng nét quen thuộc, vừa phù hợp với người sử dụng.
            </p>
            <p>
              Câu chuyện ấy còn được tiếp nối qua những chiếc móc khóa và kẹp tóc nón lá nhỏ xinh.
              Khi dáng nón được mang theo trên chiếc túi hay gài nhẹ lên mái tóc, nét đẹp truyền
              thống có thêm một cách hiện diện trong cuộc sống thường ngày. Chúng mình mong mỗi
              người có thể tìm thấy một thiết kế hợp với mình, hoặc cùng Sắc Chằm tạo nên một món đồ
              mang màu sắc và kỷ niệm riêng.
            </p>
            <p>
              “Chằm nét xưa, gài duyên nay” vì thế cũng là cách Sắc Chằm nhìn về hành trình của
              mình: trân trọng nền tảng làng nghề và tìm thêm những cách để chiếc nón tiếp tục được
              yêu thích, sử dụng. Chúng mình hy vọng, từ một món đồ bạn chọn mang theo, câu chuyện
              về nón lá Việt sẽ được kể tiếp — gần gũi và tự nhiên trong chính cuộc sống của bạn.
            </p>
          </div>
        </section>

        <ul className="ab-gallery" aria-label="Hình ảnh Sắc Chằm">
          {ABOUT_GALLERY.map((src) => (
            <li key={src}>
              <img src={src} alt="" loading="lazy" />
            </li>
          ))}
        </ul>

        <section className="ab-core" aria-labelledby="ab-core-title">
          <h2 id="ab-core-title">Giá trị cốt lõi</h2>
          <ul>
            {ABOUT_VALUES.map((v) => (
              <li key={v.label}>
                <span className="ab-oval">
                  <img src={v.image} alt="" loading="lazy" />
                </span>
                <strong>{v.label}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="ab-featured" aria-labelledby="ab-featured-title">
          <h2 id="ab-featured-title">Sản phẩm nổi bật</h2>
          {products.length > 0 ? (
            <ul>
              {products.map((p) => (
                <li key={p.slug}>
                  <Link href={`/san-pham/${p.slug}`} className="ab-product">
                    <span className="ab-product-img">
                      {p.image && <img src={p.image.url} alt={p.image.alt || p.name} />}
                    </span>
                    <span className="ab-pill">
                      {p.name}
                      <i aria-hidden="true">⌄</i>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sc-empty">Bộ sưu tập mới đang được hoàn thiện.</p>
          )}
          <Link className="ab-more" href="/shop">
            Xem thêm
          </Link>
        </section>
      </main>
    </div>
  );
}
