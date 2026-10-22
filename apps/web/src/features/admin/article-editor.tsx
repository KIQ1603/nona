'use client';

import { ARTICLE_STATUS_LABELS, articlePublishIssues, type AdminArticle } from '@nona/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { ArticleBody } from '@/features/articles/article-body';
import { useAdmin } from '@/lib/admin-client';

/** Wraps the current selection (or inserts a placeholder) and keeps the caret sensible. */
function wrap(
  el: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
  set: (v: string) => void,
) {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const chosen = value.slice(s, e) || placeholder;
  set(value.slice(0, s) + before + chosen + after + value.slice(e));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(s + before.length, s + before.length + chosen.length);
  });
}
function linePrefix(el: HTMLTextAreaElement, prefix: string, set: (v: string) => void) {
  const { selectionStart: s, value } = el;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  set(value.slice(0, start) + prefix + value.slice(start));
  requestAnimationFrame(() => el.focus());
}

export function ArticleEditor({ initial }: { initial: AdminArticle }) {
  const { request, upload } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [a, setA] = useState(initial);
  const [form, setForm] = useState({
    title: initial.title,
    slug: initial.slug,
    excerpt: initial.excerpt,
    body: initial.body,
    coverAlt: initial.cover?.alt ?? '',
    seoTitle: initial.seoTitle ?? '',
    seoDescription: initial.seoDescription ?? '',
  });
  const [preview, setPreview] = useState(false);
  const save = useAction();
  const state = useAction();
  const media = useAction();
  const text = useRef<HTMLTextAreaElement>(null);
  const bodyFile = useRef<HTMLInputElement>(null);
  const coverFile = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const dirty =
    form.title !== a.title ||
    form.slug !== a.slug ||
    form.excerpt !== a.excerpt ||
    form.body !== a.body ||
    form.coverAlt !== (a.cover?.alt ?? '') ||
    form.seoTitle !== (a.seoTitle ?? '') ||
    form.seoDescription !== (a.seoDescription ?? '');
  const issues = articlePublishIssues({
    title: form.title,
    body: form.body,
    hasCover: Boolean(a.cover),
  });

  const payload = () => ({
    version: a.version,
    title: form.title.trim(),
    slug: form.slug.trim(),
    excerpt: form.excerpt.trim(),
    body: form.body,
    coverAlt: form.coverAlt.trim(),
    seoTitle: form.seoTitle.trim() || null,
    seoDescription: form.seoDescription.trim() || null,
  });
  const apply = (next: AdminArticle) => {
    setA(next);
    setForm((f) => ({ ...f, slug: next.slug }));
  };

  const saveAll = async (e?: FormEvent) => {
    e?.preventDefault();
    const res = await save.run(() =>
      request<AdminArticle>('PATCH', `/admin/articles/${a.id}`, payload()),
    );
    if (res) {
      apply(res);
      toast('Đã lưu bài viết');
    }
    return res;
  };
  const setStatus = async (status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED') => {
    // save pending edits together with the status change so nothing is lost or published stale
    const res = await state.run(() =>
      request<AdminArticle>('PATCH', `/admin/articles/${a.id}`, { ...payload(), status }),
    );
    if (res) {
      apply(res);
      toast(
        status === 'PUBLISHED'
          ? 'Đã đăng bài viết'
          : status === 'DRAFT'
            ? 'Đã chuyển về nháp'
            : 'Đã lưu trữ bài viết',
      );
    }
  };
  const onCover = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alt', form.coverAlt);
    const res = await media.run(() => upload<AdminArticle>(`/admin/articles/${a.id}/cover`, fd));
    if (res) {
      setA((cur) => ({
        ...cur,
        version: res.version,
        cover: res.cover,
        publishIssues: res.publishIssues,
      }));
      toast('Đã cập nhật ảnh bìa');
    }
    if (coverFile.current) coverFile.current.value = '';
  };
  const removeCover = async () => {
    const res = await media.run(() =>
      request<AdminArticle>('DELETE', `/admin/articles/${a.id}/cover`),
    );
    if (res)
      setA((cur) => ({
        ...cur,
        version: res.version,
        cover: null,
        publishIssues: res.publishIssues,
      }));
  };
  const onBodyImage = async (file: File | undefined) => {
    if (!file || !text.current) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await media.run(() => upload<{ url: string }>('/admin/articles/images', fd));
    if (res) {
      const alt = window.prompt('Mô tả ảnh (hiển thị làm chú thích, có thể để trống):', '') ?? '';
      wrap(text.current, '\n\n', '\n\n', `![${alt.replace(/[\]\n]/g, ' ')}](${res.url})`, (v) =>
        set('body', v),
      );
    }
    if (bodyFile.current) bodyFile.current.value = '';
  };
  const remove = async () => {
    if (!window.confirm('Xóa vĩnh viễn bài viết này?')) return;
    const ok = await state.run(async () => {
      await request('DELETE', `/admin/articles/${a.id}`);
      return true;
    });
    if (ok) router.push('/admin/articles');
  };

  const t = () => text.current!;
  return (
    <form onSubmit={saveAll}>
      <div className="page-head">
        <div>
          <p>
            <Link href="/admin/articles">← Bài viết</Link>
          </p>
          <h1 className="row-inline">
            {a.title || 'Bài viết'}{' '}
            <span
              className={`pill ${a.status === 'PUBLISHED' ? 'pill-published' : a.status === 'ARCHIVED' ? 'pill-archived' : 'pill-draft'}`}
            >
              {ARTICLE_STATUS_LABELS[a.status]}
            </span>
          </h1>
          <p>
            /bai-viet/{a.slug} · phiên bản {a.version}
          </p>
        </div>
        <div className="form-actions">
          {a.status === 'PUBLISHED' && (
            <Link className="btn btn-outline" href={`/bai-viet/${a.slug}`} target="_blank">
              Xem trên cửa hàng ↗
            </Link>
          )}
          <button className="btn btn-primary" type="submit" disabled={save.pending || !dirty}>
            {save.pending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {a.status !== 'PUBLISHED' && (
            <button
              type="button"
              className="btn btn-dark"
              disabled={state.pending || issues.length > 0}
              onClick={() => setStatus('PUBLISHED')}
            >
              Đăng bài
            </button>
          )}
          {a.status === 'PUBLISHED' && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={state.pending}
              onClick={() => setStatus('DRAFT')}
            >
              Gỡ xuống (nháp)
            </button>
          )}
          {a.status !== 'ARCHIVED' && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={state.pending}
              onClick={() =>
                window.confirm('Lưu trữ bài viết này? Bài sẽ ẩn khỏi cửa hàng.') &&
                setStatus('ARCHIVED')
              }
            >
              Lưu trữ
            </button>
          )}
        </div>
      </div>
      {(save.error || state.error || media.error) && (
        <p className="form-error" role="alert">
          {save.error ?? state.error ?? media.error}
        </p>
      )}
      {a.status !== 'PUBLISHED' && issues.length > 0 && (
        <div className="admin-card" style={{ marginBottom: 18 }}>
          <strong>Cần hoàn thiện trước khi đăng:</strong>
          <ul className="issue-list">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="article-editor-grid">
        <div>
          <div className="admin-card">
            <label className="field">
              <span>Tiêu đề</span>
              <input
                value={form.title}
                maxLength={160}
                required
                onChange={(e) => set('title', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Tóm tắt (hiện ở danh sách bài viết)</span>
              <textarea
                rows={3}
                maxLength={400}
                value={form.excerpt}
                onChange={(e) => set('excerpt', e.target.value)}
              />
              <small>{form.excerpt.length}/400</small>
            </label>
          </div>

          <div className="admin-card">
            <h2>Nội dung</h2>
            <div className="md-toolbar" role="toolbar" aria-label="Định dạng">
              <button type="button" onClick={() => linePrefix(t(), '## ', (v) => set('body', v))}>
                Tiêu đề
              </button>
              <button type="button" onClick={() => linePrefix(t(), '### ', (v) => set('body', v))}>
                Tiêu đề nhỏ
              </button>
              <button
                type="button"
                onClick={() => wrap(t(), '**', '**', 'chữ đậm', (v) => set('body', v))}
              >
                <b>B</b>
              </button>
              <button
                type="button"
                onClick={() => wrap(t(), '*', '*', 'chữ nghiêng', (v) => set('body', v))}
              >
                <i>I</i>
              </button>
              <button type="button" onClick={() => linePrefix(t(), '- ', (v) => set('body', v))}>
                • Danh sách
              </button>
              <button type="button" onClick={() => linePrefix(t(), '1. ', (v) => set('body', v))}>
                1. Đánh số
              </button>
              <button type="button" onClick={() => linePrefix(t(), '> ', (v) => set('body', v))}>
                “ Trích dẫn
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = window.prompt(
                    'Địa chỉ liên kết (https://… hoặc /đường-dẫn):',
                    'https://',
                  );
                  if (url) wrap(t(), '[', `](${url})`, 'văn bản liên kết', (v) => set('body', v));
                }}
              >
                Liên kết
              </button>
              <button
                type="button"
                disabled={media.pending}
                onClick={() => bodyFile.current?.click()}
              >
                {media.pending ? 'Đang tải…' : 'Chèn ảnh'}
              </button>
              <input
                ref={bodyFile}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => void onBodyImage(e.target.files?.[0])}
              />
              <button type="button" onClick={() => setPreview(!preview)} aria-pressed={preview}>
                {preview ? 'Soạn thảo' : 'Xem trước'}
              </button>
            </div>
            {preview ? (
              <div className="article-preview">
                <ArticleBody body={form.body || '*Chưa có nội dung.*'} />
              </div>
            ) : (
              <textarea
                ref={text}
                className="md-textarea"
                value={form.body}
                maxLength={60000}
                onChange={(e) => set('body', e.target.value)}
                placeholder={'## Tiêu đề phần\n\nĐoạn văn…'}
              />
            )}
            <small>
              Định dạng: ## tiêu đề, **đậm**, *nghiêng*, - danh sách, 1. đánh số, &gt; trích dẫn,
              [chữ](https://…). Không dùng HTML.
            </small>
          </div>
        </div>

        <div>
          <div className="admin-card cover-box">
            <h2>Ảnh bìa</h2>
            {a.cover ? (
              <img src={a.cover.url} alt={a.cover.alt || 'Ảnh bìa'} />
            ) : (
              <p>Chưa có ảnh bìa (bắt buộc để đăng).</p>
            )}
            <label className="field">
              <span>Mô tả ảnh (alt)</span>
              <input
                value={form.coverAlt}
                maxLength={200}
                onChange={(e) => set('coverAlt', e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-outline"
                disabled={media.pending}
                onClick={() => coverFile.current?.click()}
              >
                {a.cover ? 'Đổi ảnh bìa' : 'Tải ảnh bìa'}
              </button>
              {a.cover && a.status !== 'PUBLISHED' && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger-outline"
                  onClick={removeCover}
                >
                  Xóa ảnh
                </button>
              )}
            </div>
            <input
              ref={coverFile}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void onCover(e.target.files?.[0])}
            />
            <small>Nên dùng ảnh ngang, tối thiểu 600px mỗi cạnh.</small>
          </div>

          <div className="admin-card">
            <h2>Đường dẫn và SEO</h2>
            <label className="field">
              <span>Slug</span>
              <input
                value={form.slug}
                maxLength={120}
                onChange={(e) => set('slug', e.target.value)}
              />
              <small>Đổi slug sẽ đổi địa chỉ bài viết.</small>
            </label>
            <label className="field">
              <span>Tiêu đề SEO (tùy chọn)</span>
              <input
                value={form.seoTitle}
                maxLength={160}
                onChange={(e) => set('seoTitle', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Mô tả SEO (tùy chọn)</span>
              <textarea
                rows={3}
                maxLength={300}
                value={form.seoDescription}
                onChange={(e) => set('seoDescription', e.target.value)}
              />
            </label>
          </div>

          {a.status !== 'PUBLISHED' && (
            <div className="admin-card">
              <button type="button" className="btn btn-sm btn-danger-outline" onClick={remove}>
                Xóa bài viết
              </button>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
