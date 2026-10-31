import type { ContactSettings } from '@nona/contracts';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { Brand } from './brand';

/** Contact details stay admin-managed; only the storefront information architecture is fixed. */
export function SiteFooter({ contact }: { contact: ContactSettings }) {
  const channels = contact.channels.filter((channel) => channel.enabled);
  return (
    <footer className="site-footer">
      <div className="footer-brand-column">
        <Brand />
        <p>{contact.description || SITE.tagline}</p>
      </div>
      <nav className="footer-links" aria-label="Liên kết nhanh">
        <strong>Liên kết nhanh</strong>
        <Link href="/trang-chu">Trang chủ</Link>
        <Link href="/">Giới thiệu</Link>
        <Link href="/shop">Sản phẩm</Link>
        <Link href="/thiet-ke-non">Tự thiết kế</Link>
      </nav>
      <div className="footer-contact">
        <strong>Liên hệ</strong>
        {channels.slice(0, 4).map((channel) => (
          <a
            key={channel.id}
            href={channel.url}
            rel="noopener noreferrer"
            target={channel.url.startsWith('https://') ? '_blank' : undefined}
          >
            {channel.label}
          </a>
        ))}
        {contact.address && <span>{contact.address}</span>}
      </div>
      <small>
        © {new Date().getFullYear()} Sắc Chằm. {SITE.tagline}
      </small>
      <div className="footer-legal">
        <Link href="/lien-he">Chính sách bảo mật</Link>
        <Link href="/lien-he">Điều khoản sử dụng</Link>
      </div>
    </footer>
  );
}
