import type { ContactSettings } from '@nona/contracts';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { Brand } from './brand';

/** Footer links come from the admin-managed contact channels, never from code. */
export function SiteFooter({ contact }: { contact: ContactSettings }) {
  const channels = contact.channels.filter((c) => c.enabled);
  return (
    <footer className="site-footer">
      <Brand />
      <p>{SITE.tagline}</p>
      <nav className="footer-links" aria-label="Liên hệ và mạng xã hội">
        {channels.map((c) => (
          <a
            key={c.id}
            href={c.url}
            rel="noopener noreferrer"
            target={c.url.startsWith('https://') ? '_blank' : undefined}
          >
            {c.label}
          </a>
        ))}
        <Link href="/lien-he">Liên hệ</Link>
      </nav>
      <small>© {new Date().getFullYear()} NONA. Được làm với tình yêu tại Việt Nam.</small>
    </footer>
  );
}
