/** Server-side API origin. INTERNAL_API_URL lets containers reach the API on a private network. */
export const API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3100';
