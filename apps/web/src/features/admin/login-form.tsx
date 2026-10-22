'use client';

import { loginResultSchema, meSchema } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';

export function LoginForm() {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [denied, setDenied] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);

  const post = async (path: string, body: object) => {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok)
      throw Object.assign(new Error(json?.error?.message ?? 'Đăng nhập không thành công.'), {
        handled: true,
      });
    return json;
  };

  const finish = async (raw: unknown) => {
    const me = meSchema.parse(raw);
    if (!me.permissions.includes('admin:access')) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': me.csrfToken },
      });
      setDenied(true);
      return;
    }
    router.replace(me.mfaRestricted ? '/admin/security-setup' : '/admin');
    router.refresh();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDenied(false);
    await run(async () => {
      if (challenge) {
        await finish(
          await post('/auth/mfa/verify', { challengeToken: challenge, code: form.get('code') }),
        );
        return;
      }
      const result = loginResultSchema.parse(
        await post('/auth/login', { email: form.get('email'), password: form.get('password') }),
      );
      if ('mfaRequired' in result) setChallenge(result.challengeToken);
      else await finish(result);
    });
  };

  return (
    <form className="admin-card login-card" onSubmit={submit} aria-labelledby="login-title">
      <div className="brand" style={{ marginBottom: 8 }}>
        <span className="brand-mark" aria-hidden="true">
          N
        </span>{' '}
        NONA
      </div>
      <h1 id="login-title">{challenge ? 'Xác thực hai lớp' : 'Đăng nhập quản trị'}</h1>
      {challenge ? (
        <label className="field">
          <span>Mã xác thực (6 số) hoặc mã khôi phục</span>
          <input
            name="code"
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={24}
          />
          <small>Mở ứng dụng xác thực trên điện thoại của bạn.</small>
        </label>
      ) : (
        <>
          <label className="field">
            <span>Email hoặc tên đăng nhập</span>
            <input name="email" type="text" autoComplete="username" required maxLength={254} />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={200}
            />
          </label>
        </>
      )}
      {(error || denied) && (
        <p className="form-error" role="alert">
          {denied ? 'Tài khoản này không có quyền truy cập khu vực quản trị.' : error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
        {pending ? 'Đang xử lý…' : challenge ? 'Xác nhận' : 'Đăng nhập'}
      </button>
      {challenge && (
        <button
          className="admin-link-button"
          type="button"
          style={{ color: 'var(--color-muted)', marginTop: 8 }}
          onClick={() => setChallenge(null)}
        >
          ← Quay lại
        </button>
      )}
    </form>
  );
}
