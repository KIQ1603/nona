import type { Metadata } from 'next';
import { ForgotForm } from '@/features/account/forgot-form';

export const metadata: Metadata = { title: 'Quên mật khẩu', robots: { index: false } };

export default function ForgotPage() {
  return (
    <div className="auth-page">
      <ForgotForm />
    </div>
  );
}
