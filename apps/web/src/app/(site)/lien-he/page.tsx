import type { Metadata } from 'next';
import { ChannelIcon } from '@/features/contact/channel-icon';
import { getStorefrontSettings } from '@/features/settings/settings.api';

export const metadata: Metadata = {
  title: 'Liên hệ',
  description: 'Liên hệ NONA qua Zalo, Facebook, email và các kênh khác.',
};

const shown = (url: string) => url.replace(/^(mailto:|tel:|https:\/\/)/i, '').replace(/\/$/, '');

export default async function ContactPage() {
  const { contact } = await getStorefrontSettings();
  const channels = contact.channels.filter((c) => c.enabled);
  return (
    <div className="contact-page">
      <p className="eyebrow">Liên hệ</p>
      <h1>{contact.headline || 'Liên hệ NONA'}</h1>
      {contact.description && <p className="lead">{contact.description}</p>}
      {channels.length > 0 ? (
        <ul className="contact-cards">
          {channels.map((c) => (
            <li key={c.id}>
              <a
                href={c.url}
                target={c.url.startsWith('https://') ? '_blank' : undefined}
                rel="noopener noreferrer"
              >
                <ChannelIcon kind={c.kind} size={52} />
                <strong>{c.label}</strong>
                <small>{shown(c.url)}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>Thông tin liên hệ đang được cập nhật.</p>
      )}
      {(contact.address || contact.hours) && (
        <dl className="contact-info">
          {contact.address && (
            <div>
              <dt>Địa chỉ</dt>
              <dd>{contact.address}</dd>
            </div>
          )}
          {contact.hours && (
            <div>
              <dt>Giờ làm việc</dt>
              <dd>{contact.hours}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
