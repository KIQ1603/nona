import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Playfair_Display } from 'next/font/google';
import { RouteLoader } from '@/components/layout/route-loader';
import { SITE_URL } from '@/lib/env';
import { SITE } from '@/lib/site';
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
import '@/styles/articles.css';

const body = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-be-vietnam',
  display: 'swap',
});
const display = Playfair_Display({
  subsets: ['vietnamese', 'latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'NONA — Nón Việt, dấu ấn riêng', template: '%s | NONA' },
  description: SITE.description,
  openGraph: { siteName: 'NONA', locale: 'vi_VN', type: 'website' },
};
export const viewport: Viewport = { themeColor: '#21352d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${body.variable} ${display.variable}`}>
      <body>
        <RouteLoader />
        {children}
      </body>
    </html>
  );
}
