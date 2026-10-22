'use client';

import type { AdminCategory } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { usePaged } from '@/components/admin/client-pagination';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

export function CategoryManager({ initial }: { initial: AdminCategory[] }) {
  const { request, can } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const [items, setItems] = useState(initial);
  const paged = usePaged(items);
  const [draft, setDraft] = useState({
    name: '',
    slug: '',
    description: '',
    sortOrder: initial.length,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', slug: '', description: '', sortOrder: 0 });
  const writable = can('catalog:write');
  const reload = async () =>
    setItems((await request<{ items: AdminCategory[] }>('GET', '/admin/categories')).items);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      await request('POST', '/admin/categories', {
        name: draft.name,
        ...(draft.slug ? { slug: draft.slug } : {}),
        description: draft.description || null,
        sortOrder: draft.sortOrder,
      });
      await reload();
      return true;
    });
    if (ok) {
      setDraft({ name: '', slug: '', description: '', sortOrder: items.length + 1 });
      toast('Đã thêm danh mục');
      router.refresh();
    }
  };
  const save = async (id: string) => {
    const ok = await run(async () => {
      const res = await request<{ items: AdminCategory[] }>('PATCH', `/admin/categories/${id}`, {
        name: edit.name,
        slug: edit.slug,
        description: edit.description || null,
        sortOrder: edit.sortOrder,
      });
      setItems(res.items);
      return true;
    });
    if (ok) {
      setEditing(null);
      toast('Đã lưu danh mục');
      router.refresh();
    }
  };
  const remove = async (c: AdminCategory) => {
    if (!window.confirm(`Xóa danh mục “${c.name}”?`)) return;
    const ok = await run(async () => {
      await request('DELETE', `/admin/categories/${c.id}`);
      await reload();
      return true;
    });
    if (ok) toast('Đã xóa danh mục');
  };

  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Slug</th>
              <th>Mô tả</th>
              <th className="num">Thứ tự</th>
              <th className="num">Sản phẩm</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.visible.map((c) =>
              editing === c.id ? (
                <tr key={c.id}>
                  <td>
                    <input
                      aria-label="Tên"
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Slug"
                      value={edit.slug}
                      onChange={(e) => setEdit({ ...edit, slug: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Mô tả"
                      value={edit.description}
                      onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Thứ tự"
                      type="number"
                      min={0}
                      value={edit.sortOrder}
                      onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="num">{c.productCount}</td>
                  <td>
                    <div className="row-inline">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={pending}
                        onClick={() => save(c.id)}
                      >
                        Lưu
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>
                        Hủy
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{c.slug}</td>
                  <td className="wrap">{c.description ?? '—'}</td>
                  <td className="num">{c.sortOrder}</td>
                  <td className="num">{c.productCount}</td>
                  <td>
                    {writable && (
                      <div className="row-inline">
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            setEditing(c.id);
                            setEdit({
                              name: c.name,
                              slug: c.slug,
                              description: c.description ?? '',
                              sortOrder: c.sortOrder,
                            });
                          }}
                        >
                          Sửa
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={c.productCount > 0}
                          title={c.productCount > 0 ? 'Danh mục đang có sản phẩm' : undefined}
                          onClick={() => remove(c)}
                        >
                          Xóa
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {paged.footer}
      {writable && (
        <button
          type="button"
          className="btn btn-primary admin-create"
          onClick={() => {
            const form = document.getElementById('new-category');
            form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            form?.querySelector('input')?.focus();
          }}
        >
          + Thêm danh mục
        </button>
      )}
      {writable && (
        <form id="new-category" className="admin-card" onSubmit={create} style={{ marginTop: 18 }}>
          <h2>Thêm danh mục</h2>
          <div className="form-row">
            <label className="field">
              <span>Tên *</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                maxLength={80}
              />
            </label>
            <label className="field">
              <span>Slug</span>
              <input
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                placeholder="Tự tạo từ tên"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </label>
            <label className="field">
              <span>Thứ tự</span>
              <input
                type="number"
                min={0}
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <label className="field">
            <span>Mô tả</span>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={300}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            Thêm danh mục
          </button>
        </form>
      )}
    </>
  );
}
