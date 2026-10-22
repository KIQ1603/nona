import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page-simple">
      <p className="eyebrow">Lỗi 404</p>
      <h1>Không tìm thấy trang</h1>
      <p>Trang bạn tìm có thể đã được đổi địa chỉ hoặc không còn tồn tại.</p>
      <Link className="btn btn-dark" href="/shop">
        Về cửa hàng
      </Link>
    </div>
  );
}
