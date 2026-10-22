import Link from 'next/link';
import { MyDesigns } from '@/features/custom/my-designs';

export default function MyDesignsPage() {
  return (
    <>
      <h1>Thiết kế của tôi</h1>
      <p className="lead">Các thiết kế nón riêng và trạng thái duyệt.</p>
      <MyDesigns />
      <p>
        <Link className="btn btn-dark" href="/thiet-ke-non">
          Tạo thiết kế mới
        </Link>
      </p>
    </>
  );
}
