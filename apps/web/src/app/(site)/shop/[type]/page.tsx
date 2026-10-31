import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategories } from '@/features/catalog/api/catalog.api';
import { TypePage } from '@/features/catalog/components/type-page';
import { parseShopParams, type RawSearchParams } from '@/features/catalog/lib/shop-params';
import { CustomCta } from '@/features/custom/custom-cta';

type Props = {
  params: Promise<{ type: string }>;
  searchParams: Promise<RawSearchParams>;
};

async function load(slug: string) {
  const { items } = await getCategories();
  const type = items.find((c) => c.slug === slug && c.parentSlug === null);
  return type ? { type, groups: items.filter((c) => c.parentSlug === type.slug) } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load((await params).type).catch(() => null);
  if (!found) return { title: 'Sản phẩm' };
  return {
    title: found.type.name,
    description:
      found.type.description ?? `Khám phá ${found.type.name.toLowerCase()} thủ công Sắc Chằm.`,
    alternates: { canonical: `/shop/${found.type.slug}` },
  };
}

/** One product type (Nón lá, Móc khóa, Kẹp tóc…): the same page for every type, filled from the admin's data. */
export default async function ProductTypePage({ params, searchParams }: Props) {
  const found = await load((await params).type);
  if (!found) notFound();
  const { q } = parseShopParams(await searchParams);
  return (
    <>
      <TypePage type={found.type} groups={found.groups} q={q} />
      <CustomCta />
    </>
  );
}
