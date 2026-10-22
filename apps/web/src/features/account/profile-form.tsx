'use client';

import { meSchema } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const { request, setUser } = useCustomer();
  const router = useRouter();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const [name, setName] = useState(fullName);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const me = await run(async () =>
      meSchema.parse(await request('PATCH', '/me', { fullName: name })),
    );
    if (me) {
      setUser(me);
      router.refresh();
      toast('Đã lưu hồ sơ');
    }
  };
  return (
    <form className="panel account-form" onSubmit={submit}>
      <h2>Thông tin cá nhân</h2>
      <label className="field">
        <span>Email</span>
        <input value={email} disabled readOnly />
        <small>Email dùng để đăng nhập và không thể thay đổi tại đây.</small>
      </label>
      <label className="field">
        <span>Họ và tên</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-dark" type="submit" disabled={pending || name.trim() === fullName}>
        Lưu thay đổi
      </button>
    </form>
  );
}
