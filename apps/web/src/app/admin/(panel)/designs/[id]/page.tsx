import { adminDesignDetailSchema } from '@nona/contracts';
import { notFound } from 'next/navigation';
import { DesignReview } from '@/features/admin/design-review';
import { adminGet } from '@/lib/admin-server';
import { ApiError } from '@/lib/api-client';

export default async function AdminDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const design = await adminGet(`/admin/designs/${id}`, adminDesignDetailSchema).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  return <DesignReview initial={design} />;
}
