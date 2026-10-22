import { articlePlainText, readingMinutes } from '@nona/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/features/articles/article-body';
import { getArticle, getArticles } from '@/features/articles/articles.api';
import { SITE_URL } from '@/lib/env';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await getArticle((await params).slug);
  if (!a) return { title: 'Không tìm thấy bài viết' };
  const description = a.seoDescription ?? (a.excerpt || articlePlainText(a.body).slice(0, 160));
  return {
    title: a.seoTitle ?? a.title,
    description,
    alternates: { canonical: `/bai-viet/${a.slug}` },
    openGraph: {
      type: 'article',
      title: a.title,
      description,
      publishedTime: a.publishedAt,
      images: a.cover ? [a.cover.url] : undefined,
    },
  };
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function ArticlePage({ params }: Props) {
  const a = await getArticle((await params).slug);
  if (!a) notFound();
  const more = (await getArticles(1, 4)).items.filter((x) => x.slug !== a.slug).slice(0, 3);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt,
    image: a.cover ? [a.cover.url] : undefined,
    author: a.authorName
      ? { '@type': 'Person', name: a.authorName }
      : { '@type': 'Organization', name: 'NONA' },
    mainEntityOfPage: `${SITE_URL}/bai-viet/${a.slug}`,
  };
  return (
    <article className="article-page">
      <nav className="breadcrumbs article-crumbs" aria-label="Đường dẫn">
        <ol>
          <li>
            <Link href="/">Trang chủ</Link>
          </li>
          <li>
            <Link href="/bai-viet">Bài viết</Link>
          </li>
          <li aria-current="page">{a.title}</li>
        </ol>
      </nav>
      <header className="article-head">
        <p className="eyebrow">Bài viết</p>
        <h1>{a.title}</h1>
        <p className="byline">
          <time dateTime={a.publishedAt}>{date(a.publishedAt)}</time>
          {a.authorName && <> · {a.authorName}</>} · {readingMinutes(a.body)} phút đọc
        </p>
        {a.excerpt && <p className="lead">{a.excerpt}</p>}
      </header>
      {a.cover && (
        <figure className="article-cover">
          <img
            src={a.cover.url}
            alt={a.cover.alt || a.title}
            width={a.cover.width}
            height={a.cover.height}
            fetchPriority="high"
          />
        </figure>
      )}
      <ArticleBody body={a.body} />
      {more.length > 0 && (
        <aside className="article-more" aria-labelledby="more-title">
          <h2 id="more-title">Đọc thêm</h2>
          <ul>
            {more.map((m) => (
              <li key={m.slug}>
                <Link href={`/bai-viet/${m.slug}`}>
                  {m.cover && (
                    <img src={m.cover.url} alt="" width={120} height={90} loading="lazy" />
                  )}
                  <span>{m.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </article>
  );
}
