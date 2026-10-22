import type { ReactNode } from 'react';

export function EmptyState({
  icon = '⌁',
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
