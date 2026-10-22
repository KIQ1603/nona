import { Providers } from '@/components/providers';
import { ContactFloat } from '@/features/contact/contact-float';
import { getStorefrontSettings } from '@/features/settings/settings.api';

export const dynamic = 'force-dynamic';

/** The brand landing is a full-screen experience: it has its own header, so no site chrome here. */
export default async function LandingLayout({ children }: { children: React.ReactNode }) {
  const { contact } = await getStorefrontSettings();
  return (
    <Providers>
      {children}
      <ContactFloat contact={contact} />
    </Providers>
  );
}
