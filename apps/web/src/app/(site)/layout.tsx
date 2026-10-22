import { ContactFloat } from '@/features/contact/contact-float';
import { getStorefrontSettings } from '@/features/settings/settings.api';
import { Suspense } from 'react';
import { ScrollReset } from '@/components/layout/scroll-reset';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SearchPanel } from '@/components/layout/search-panel';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Providers } from '@/components/providers';
import { CartDrawer } from '@/features/cart/cart-drawer';

// Rendered per request (data is still cached via fetch revalidate/tags) so builds never depend on the API.
export const dynamic = 'force-dynamic';

/** Storefront chrome. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { contact } = await getStorefrontSettings();
  return (
    <Providers>
      <div className="site-shell">
        <a className="skip-link" href="#main">
          Bỏ qua điều hướng
        </a>
        <SiteHeader />
        <MobileNav />
        <SearchPanel />
        <main id="main">{children}</main>
        <Suspense>
          <ScrollReset />
        </Suspense>
        <SiteFooter contact={contact} />
      </div>
      <CartDrawer />
      <ContactFloat contact={contact} />
    </Providers>
  );
}
