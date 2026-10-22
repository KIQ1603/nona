import { adminArticleSchema } from '@nona/contracts';
import { notFound } from 'next/navigation';
import { ArticleEditor } from '@/features/admin/article-editor';
import { adminGet } from '@/lib/admin-server';
import { ApiError } from '@/lib/api-client';

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await adminGet(`/admin/articles/${id}`, adminArticleSchema).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  return <ArticleEditor initial={article} />;
}
