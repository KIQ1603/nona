import type { NextConfig } from 'next';

const API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
const MEDIA_ORIGIN = process.env.MEDIA_ORIGIN ?? 'http://localhost:9000/nona-media';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // our own brand loader replaces Next's corner badge
  devIndicators: false,
  transpilePackages: ['@nona/contracts'],
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // Same-origin API proxy: the browser only ever talks to the web origin, so the HttpOnly session
      // cookie is first-party and CORS is not needed.
      fallback: [
        { source: '/api/:path*', destination: `${API_URL}/v1/:path*` },
        // Uploaded product media (seed images in /public/media/seed are served first from disk).
        { source: '/media/:path*', destination: `${MEDIA_ORIGIN}/:path*` },
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;
