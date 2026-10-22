'use client';

import type { AdminArticle } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useAdmin } from '@/lib/admin-client';

export function NewArticleForm() {
  const { request } = useAdmin();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const act = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = await act.run(() => request<AdminArticle>('POST', '/admin/articles', { title }));
    if (a) router.push(`/admin/articles/${a.id}`);
  };
  return (
    <form className="admin-card" onSubmit={submit}>
      <label className="field">
        <span>Tiêu đề bài viết</span>
        <input
          value={title}
          maxLength={160}
          required
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      {act.error && (
        <p className="form-error" role="alert">
          {act.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={act.pending || !title.trim()}>
        {act.pending ? 'Đang tạo…' : 'Tạo bản nháp'}
      </button>
    </form>
  );
}
