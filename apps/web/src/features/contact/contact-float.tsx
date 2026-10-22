import type { ContactSettings } from '@nona/contracts';
import { ChannelIcon } from './channel-icon';

/** Floating, softly pulsing contact buttons on the right edge. Channels come from admin settings. */
export function ContactFloat({ contact }: { contact: ContactSettings }) {
  const channels = contact.channels.filter((c) => c.enabled);
  if (!contact.floatingEnabled || channels.length === 0) return null;
  return (
    <nav className="contact-float" aria-label="Liên hệ nhanh">
      {channels.map((c) => (
        <a
          key={c.id}
          href={c.url}
          target={c.url.startsWith('https://') ? '_blank' : undefined}
          rel="noopener noreferrer"
          aria-label={c.label}
        >
          <span className="pulse" aria-hidden="true" />
          <ChannelIcon kind={c.kind} size={56} />
          <span className="tip">{c.label}</span>
        </a>
      ))}
    </nav>
  );
}
