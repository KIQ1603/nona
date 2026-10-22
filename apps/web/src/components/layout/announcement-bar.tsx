'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { StorefrontSettings } from '@nona/contracts';

export function AnnouncementBar({
  announcement,
}: {
  announcement: StorefrontSettings['announcement'];
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const external = announcement.linkUrl?.startsWith('https://');
  return (
    <div className="announcement" role="region" aria-label="Thông báo">
      <p>
        {announcement.linkUrl ? (
          external ? (
            <a href={announcement.linkUrl} rel="noopener noreferrer">
              {announcement.text}
            </a>
          ) : (
            <Link href={announcement.linkUrl}>{announcement.text}</Link>
          )
        ) : (
          announcement.text
        )}
      </p>
      <button type="button" aria-label="Đóng thông báo" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
