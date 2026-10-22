'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/features/cart/cart-store';
import { useWishlist } from '@/features/wishlist/wishlist-store';
import { useCustomer } from '@/lib/customer-client';
import { NAV_LINKS } from '@/lib/site';
import { AccountAvatar } from '../ui/account-avatar';
import { BagIcon, HeartIcon, SearchIcon } from '../ui/icons';
import { Brand } from './brand';
import { useOverlays } from './overlay-store';

const isActive = (pathname: string, href: string) =>
  !href.includes('#') && (pathname === href || pathname.startsWith(`${href}/`));

export function SiteHeader() {
  const pathname = usePathname();
  const { show } = useOverlays();
  const { cart } = useCart();
  const { slugs } = useWishlist();
  const { status, user } = useCustomer();
  const count = cart.itemCount;

  return (
    <header className="site-header">
      <Brand />
      <nav className="desktop-nav" aria-label="Điều hướng chính">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(pathname, link.href) ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <button
          className="icon-button"
          type="button"
          aria-label="Tìm kiếm"
          onClick={() => show('search')}
        >
          <SearchIcon />
        </button>
        <Link
          className="icon-button wishlist-header"
          href="/tai-khoan/yeu-thich"
          aria-label={`Yêu thích, ${slugs.length} sản phẩm`}
        >
          <HeartIcon />
          <span className="badge" aria-hidden="true">
            {slugs.length}
          </span>
        </Link>
        <Link
          className="icon-button"
          // always the account page: a guest is sent to the login form (and back) by the server, so a click
          // made while the session is still being checked can never land a signed-in user on the form
          href="/tai-khoan"
          prefetch={false}
          aria-label={user ? `Tài khoản của ${user.fullName}` : 'Đăng nhập'}
          aria-busy={status === 'loading'}
        >
          <AccountAvatar user={user} />
        </Link>
        <button
          className="icon-button"
          type="button"
          aria-label={`Mở giỏ hàng, ${count} sản phẩm`}
          onClick={() => show('cart')}
        >
          <BagIcon />
          <span className="badge" aria-hidden="true">
            {count}
          </span>
        </button>
        <button
          className="icon-button menu-toggle"
          type="button"
          aria-label="Mở menu"
          onClick={() => show('nav')}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
