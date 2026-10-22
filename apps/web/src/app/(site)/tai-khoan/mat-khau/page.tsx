import { PasswordForm } from '@/features/account/password-form';

export default function PasswordPage() {
  return (
    <>
      <h1>Đổi mật khẩu</h1>
      <p className="lead">Chọn mật khẩu mạnh và không dùng lại ở nơi khác.</p>
      <PasswordForm />
    </>
  );
}
