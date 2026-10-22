import Link from 'next/link';
import { hatSVG, STRAW_NATURAL } from '@/features/landing/hat-svg';

const LOGO = hatSVG({ straw: STRAW_NATURAL, strap: '#b5442a', deco: 'plain' }, 'brand');

export function Brand({ className = '' }: { className?: string }) {
  return (
    <Link className={`brand ${className}`.trim()} href="/" aria-label="NONA - Trang chủ">
      <span className="brand-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOGO }} />
      <span>
        NO<em>NA</em>
      </span>
    </Link>
  );
}
