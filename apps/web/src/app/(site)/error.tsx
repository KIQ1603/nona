'use client';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-simple" role="alert">
      <p className="eyebrow">Có lỗi xảy ra</p>
      <h1>Rất tiếc, đã có sự cố</h1>
      <p>Chúng tôi chưa thể tải nội dung này. Vui lòng thử lại sau ít phút.</p>
      <button className="btn btn-dark" type="button" onClick={reset}>
        Thử lại
      </button>
    </div>
  );
}
