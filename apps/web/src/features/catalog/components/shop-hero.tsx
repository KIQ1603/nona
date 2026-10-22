export function ShopHero() {
  return (
    <section className="shop-hero" aria-labelledby="shop-title">
      <div className="hero-copy">
        <p className="eyebrow">Bộ sưu tập NONA</p>
        <h1 id="shop-title">
          Nón Việt,
          <br />
          <em>dấu ấn riêng.</em>
        </h1>
        <p>
          Mỗi chiếc nón là một câu chuyện được đan bằng đôi tay người Việt, để bạn mang theo một nét
          quê hương theo cách của riêng mình.
        </p>
      </div>
      <div className="hero-art" aria-hidden="true">
        <span className="sun" />
        <div className="hat-shape">
          <i />
        </div>
        <svg className="hero-line" viewBox="0 0 600 250">
          <path d="M-20 190C120 60 250 280 400 95S650 155 700 20" />
        </svg>
        <p>
          Thủ công
          <br />
          tại Việt Nam
        </p>
      </div>
    </section>
  );
}
