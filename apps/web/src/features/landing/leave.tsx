'use client';

import Link from 'next/link';
import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react';

/** Navigates away with the landing's curtain transition (set by LandingExperience). */
const LeaveContext = createContext<(href: string) => void>((href) => window.location.assign(href));
export const LeaveProvider = LeaveContext.Provider;
export const useLeave = () => useContext(LeaveContext);

/** A normal Next link (prefetch, middle-click) whose plain left click plays the exit transition first. */
export function LeaveLink({ href, onClick, ...props }: ComponentProps<typeof Link>) {
  const leave = useLeave();
  return (
    <Link
      href={href}
      {...props}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0
        )
          return;
        e.preventDefault();
        leave(typeof href === 'string' ? href : (href.pathname ?? '/'));
      }}
    />
  );
}
