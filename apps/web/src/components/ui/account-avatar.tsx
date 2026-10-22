import type { MeDto } from '@nona/contracts';
import { UserIcon } from './icons';

/** Signed out: the plain outline person. Signed in: a filled badge with the customer's initial. */
export function AccountAvatar({ user }: { user: MeDto | null }) {
  if (!user) return <UserIcon />;
  const initial = (user.fullName.trim()[0] ?? user.email[0] ?? '?').toLocaleUpperCase('vi-VN');
  return (
    <span className="account-avatar" aria-hidden="true">
      {initial}
    </span>
  );
}
