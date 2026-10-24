import { EmailVerification } from '@/features/account/email-verification';
import { PhoneVerification } from '@/features/account/phone-verification';
import { ProfileForm } from '@/features/account/profile-form';
import { requireUser } from '@/lib/session-server';

export default async function ProfilePage() {
  const me = await requireUser('/tai-khoan');
  return (
    <>
      <h1>Hồ sơ</h1>
      <p className="lead">Quản lý thông tin tài khoản NONA của bạn.</p>
      <ProfileForm fullName={me.fullName} email={me.email} />
      {me.email && <EmailVerification />}
      <PhoneVerification />
      <div className="panel">
        <h2>Đơn hàng</h2>
        <p>Lịch sử đơn hàng sẽ xuất hiện ở đây khi tính năng đặt hàng ra mắt.</p>
      </div>
    </>
  );
}
