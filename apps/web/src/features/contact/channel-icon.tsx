import type { ContactKind } from '@nona/contracts';

const COLORS: Record<ContactKind, string> = {
  ZALO: '#0068ff',
  FACEBOOK: '#1877f2',
  MESSENGER: '#a334fa',
  TIKTOK: '#111111',
  INSTAGRAM: '#d62976',
  YOUTUBE: '#e62117',
  EMAIL: '#d93025',
  PHONE: '#1f8a4c',
  OTHER: '#4a504c',
};

const GLYPH: Record<ContactKind, React.ReactNode> = {
  ZALO: (
    <text
      x="12"
      y="15.5"
      textAnchor="middle"
      fontSize="8.6"
      fontWeight="700"
      fill="#fff"
      fontFamily="Arial, sans-serif"
    >
      Zalo
    </text>
  ),
  FACEBOOK: (
    <path
      d="M13.5 20v-7h2.4l.4-2.8h-2.8V8.5c0-.8.3-1.4 1.5-1.4h1.4V4.6c-.3 0-1.1-.1-2.1-.1-2.1 0-3.5 1.3-3.5 3.6v2.1H8.4V13h2.4v7h2.7Z"
      fill="#fff"
    />
  ),
  MESSENGER: (
    <path
      d="M12 4C7.6 4 4.2 7.2 4.2 11.3c0 2.3 1.1 4.3 2.8 5.6V20l2.6-1.4c.7.2 1.5.3 2.4.3 4.4 0 7.8-3.2 7.8-7.3S16.4 4 12 4Zm.8 9.8-2-2.1-3.9 2.1 4.3-4.6 2 2.1 3.9-2.1-4.3 4.6Z"
      fill="#fff"
    />
  ),
  TIKTOK: (
    <path
      transform="translate(12 12) scale(0.58) translate(-12 -12)"
      d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      fill="#fff"
    />
  ),
  INSTAGRAM: (
    <g fill="none" stroke="#fff" strokeWidth="1.6">
      <rect x="5" y="5" width="14" height="14" rx="4" />
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="16.2" cy="7.8" r=".6" fill="#fff" />
    </g>
  ),
  YOUTUBE: (
    <path
      d="M18.8 8.3c-.2-.8-.8-1.3-1.5-1.5C16 6.5 12 6.5 12 6.5s-4 0-5.3.3c-.7.2-1.3.7-1.5 1.5C5 9.6 5 12 5 12s0 2.4.2 3.7c.2.8.8 1.3 1.5 1.5 1.3.3 5.3.3 5.3.3s4 0 5.3-.3c.7-.2 1.3-.7 1.5-1.5.2-1.3.2-3.7.2-3.7s0-2.4-.2-3.7ZM10.5 14.2V9.8l3.7 2.2-3.7 2.2Z"
      fill="#fff"
    />
  ),
  EMAIL: (
    <path
      d="M5 7h14v10H5V7Zm1.4 1.3L12 12.6l5.6-4.3M6.2 16l4-3.4M17.8 16l-4-3.4"
      fill="none"
      stroke="#fff"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),
  PHONE: (
    <path
      d="M8.2 5.5 6.4 6.3c-.6.3-.9.9-.8 1.5.8 4.5 4.6 8.4 9.3 9.5.6.1 1.2-.2 1.5-.8l.8-1.7c.2-.4 0-.9-.4-1.1l-2.3-1.1c-.3-.2-.7-.1-1 .1l-.8.8c-1.4-.6-2.8-2-3.4-3.4l.8-.8c.3-.3.3-.7.1-1L9.3 5.9c-.2-.4-.7-.5-1.1-.4Z"
      fill="#fff"
    />
  ),
  OTHER: (
    <path
      d="M10 14l4-4M9 11.5 7.2 13.3a2.5 2.5 0 0 0 3.5 3.5L12.5 15m2.5-2.5 1.8-1.8a2.5 2.5 0 0 0-3.5-3.5L11.5 9"
      fill="none"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
};

/** Round brand-coloured icon for a contact channel. */
export function ChannelIcon({ kind, size = 44 }: { kind: ContactKind; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="channel-icon">
      <circle cx="12" cy="12" r="12" fill={COLORS[kind]} />
      {GLYPH[kind]}
    </svg>
  );
}
