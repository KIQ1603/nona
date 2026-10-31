export const SITE = {
  name: 'Sắc Chằm',
  tagline: 'Gìn giữ nét Việt, thêu sắc hôm nay.',
  description:
    'Sắc Chằm — sản phẩm thủ công mang bản sắc Việt, được kể lại bằng một ngôn ngữ gần gũi và hiện đại.',
} as const;

export interface NavLink {
  href: string;
  label: string;
  /** Sub-menu (the "Sản phẩm" dropdown): product types, each with the groups inside it. */
  children?: { href: string; label: string; sub?: { href: string; label: string }[] }[];
}

/** A product type (Nón lá, Móc khóa, Kẹp tóc…): a category without a parent, managed by the admin. */
export interface NavType {
  slug: string;
  name: string;
  /** The groups inside the type. */
  groups?: { slug: string; name: string }[];
}

/** Main navigation; "Sản phẩm" is a dropdown whose entries come from the catalogue, in the admin's order. */
export function buildNav(types: NavType[]): NavLink[] {
  return [
    { href: '/trang-chu', label: 'Trang chủ' },
    { href: '/', label: 'Giới thiệu' },
    {
      href: types[0] ? `/shop/${types[0].slug}` : '/shop',
      label: 'Sản phẩm',
      children: types.map((t) => ({
        href: `/shop/${t.slug}`,
        label: t.name,
        sub: (t.groups ?? []).map((g) => ({ href: `/shop/${t.slug}#${g.slug}`, label: g.name })),
      })),
    },
    { href: '/thiet-ke-non', label: 'Tự thiết kế' },
    { href: '/lien-he', label: 'Liên hệ' },
  ];
}
