import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { getArticles } from '@/features/articles/articles.api';

export const metadata: Metadata = {
  title: 'Bài viết',
  description: 'Câu chuyện làng nghề, cách chọn và chăm sóc nón lá, cùng những tin mới từ NONA.',
  alternates: { canonical: '/bai-viet' },
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { items, meta } = await getArticles(page, 9);
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  return (
    <div className="articles-page">
      <header className="articles-head">
        <p className="eyebrow">Bài viết</p>
        <h1>Chuyện nón, chuyện nghề</h1>
        <p className="lead">Những câu chuyện, mẹo chọn nón và tin mới từ NONA.</p>
      </header>
      {items.length === 0 ? (
        <EmptyState title="Chưa có bài viết nào" icon="✎">
          <p>Chúng tôi đang chuẩn bị những bài viết đầu tiên. Quay lại sau nhé!</p>
          <Link className="btn btn-dark" href="/shop">
            Xem cửa hàng
          </Link>
        </EmptyState>
      ) : (
        <ul className="article-cards">
          {items.map((a, i) => (
            <li key={a.slug} className={i === 0 && page === 1 ? 'featured' : undefined}>
              <Link href={`/bai-viet/${a.slug}`}>
                <div className="cover">
                  {a.cover && (
                    <img
                      src={a.cover.url}
                      alt={a.cover.alt || a.title}
                      width={a.cover.width}
                      height={a.cover.height}
                      loading={i < 3 ? 'eager' : 'lazy'}
                    />
                  )}
                </div>
                <div className="meta">
                  <time dateTime={a.publishedAt}>{date(a.publishedAt)}</time>
                  <h2>{a.title}</h2>
                  {a.excerpt && <p>{a.excerpt}</p>}
                  <span className="more">Đọc tiếp →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="pagination" aria-label="Phân trang">
          {page > 1 ? (
            <Link href={`/bai-viet?page=${page - 1}`} rel="prev">
              ← Trước
            </Link>
          ) : (
            <span className="disabled">← Trước</span>
          )}
          <span aria-current="page">
            {page}/{pages}
          </span>
          {page < pages ? (
            <Link href={`/bai-viet?page=${page + 1}`} rel="next">
              Sau →
            </Link>
          ) : (
            <span className="disabled">Sau →</span>
          )}
        </nav>
      )}
    </div>
  );
}
