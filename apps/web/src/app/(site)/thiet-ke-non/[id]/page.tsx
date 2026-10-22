import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCustomCatalog } from '@/features/custom/custom.api';
import { DesignLoader } from '@/features/custom/design-loader';

export const metadata: Metadata = {
  title: 'Thiết kế của tôi',
  robots: { index: false, follow: false },
};

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const catalog = await getCustomCatalog().catch(() => null);
  if (!catalog) notFound();
  return (
    <div className="custom-wrap">
      <DesignLoader id={id} catalog={catalog} />
    </div>
  );
}
