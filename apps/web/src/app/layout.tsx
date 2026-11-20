import type { Metadata, Viewport } from 'next';
import { RouteLoader } from '@/components/layout/route-loader';
import { SITE_URL } from '@/lib/env';
import { SITE } from '@/lib/site';
import '@/styles/fonts.css';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/layout.css';
import '@/styles/shop.css';
import '@/styles/product.css';
import '@/styles/cart.css';
import '@/styles/home.css';
import '@/styles/account.css';
import '@/styles/landing.css';
import '@/styles/admin.css';
import '@/styles/custom.css';
import '@/styles/sac-cham.css';
import '@/styles/home-sc.css';
import '@/styles/about-sc.css';
import '@/styles/nonla-sc.css';
import '@/styles/design-sc.css';
import '@/styles/banner-sc.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Sắc Chằm — Chằm nét xưa, gài duyên nay', template: '%s | Sắc Chằm' },
  description: SITE.description,
  icons: { icon: '/brand/logo-sac-cham.png', apple: '/brand/logo-sac-cham.png' },
  openGraph: { siteName: 'Sắc Chằm', locale: 'vi_VN', type: 'website' },
};
export const viewport: Viewport = { themeColor: '#73171d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <RouteLoader />
        {children}
      </body>
    </html>
  );
}
