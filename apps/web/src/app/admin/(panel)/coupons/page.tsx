import { couponListSchema } from '@nona/contracts';
import { CouponManager } from '@/features/admin/coupon-manager';
import { adminGet } from '@/lib/admin-server';

export default async function CouponsPage() {
  const list = await adminGet('/admin/coupons', couponListSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mã giảm giá</h1>
          <p>Tạo và điều chỉnh khuyến mãi — mọi quy tắc nằm ở đây, không cố định trong mã nguồn.</p>
        </div>
      </div>
      <CouponManager initial={list.items} />
    </>
  );
}
