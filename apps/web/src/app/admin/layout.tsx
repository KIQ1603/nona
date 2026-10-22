import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Quản trị', template: '%s | NONA Admin' },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-root">{children}</div>;
}
