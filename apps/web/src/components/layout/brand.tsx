import Link from 'next/link';

export function Brand({ className = '' }: { className?: string }) {
  return (
    <Link className={`brand ${className}`.trim()} href="/" aria-label="Sắc Chằm - Giới thiệu">
      <img
        className="brand-mark"
        src="/brand/logo-sac-cham.png"
        alt="Sắc Chằm"
        width="1254"
        height="1254"
      />
    </Link>
  );
}
