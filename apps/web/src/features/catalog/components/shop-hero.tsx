export function ShopHero() {
  return (
    <section className="shop-hero" aria-labelledby="shop-title">
      <div className="hero-copy">
        <p className="eyebrow">Bộ sưu tập Sắc Chằm</p>
        <h1 id="shop-title">Sản phẩm</h1>
        <p>
          Những sản phẩm thủ công mang đậm bản sắc Việt, được chăm chút bằng đôi tay người Việt và
          kể lại theo cách của riêng bạn.
        </p>
      </div>
      <div className="hero-art" aria-hidden="true">
        <span className="shop-lotus-mark">✿</span>
        <span className="shop-thread thread-one" />
        <span className="shop-thread thread-two" />
      </div>
    </section>
  );
}
