import Link from 'next/link';

export function CustomCta() {
  return (
    <section className="custom-cta" aria-labelledby="custom-title">
      <div className="cta-pattern" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div>
        <p className="eyebrow">NONA Custom</p>
        <h2 id="custom-title">
          Chiếc nón kể
          <br />
          <em>câu chuyện của bạn.</em>
        </h2>
        <p className="lead">
          Chọn màu, họa tiết và lời nhắn riêng. Chúng tôi sẽ cùng nghệ nhân biến ý tưởng của bạn
          thành một chiếc nón độc bản.
        </p>
        <Link className="cta-link" href="/thiet-ke-non">
          Bắt đầu thiết kế <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="custom-visual" aria-hidden="true">
        <div className="custom-hat">
          <b>nona</b>
        </div>
        <span>
          Độc bản
          <br />
          cho riêng bạn
        </span>
      </div>
    </section>
  );
}
