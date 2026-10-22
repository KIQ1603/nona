'use client';

import { HeartIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { useWishlist } from '@/features/wishlist/wishlist-store';

export function WishlistButton({ slug, name }: { slug: string; name: string }) {
  const { has, toggle } = useWishlist();
  const toast = useToast();
  const active = has(slug);
  return (
    <button
      className="wishlist-button"
      type="button"
      aria-pressed={active}
      aria-label={`${active ? 'Bỏ' : 'Thêm'} ${name} ${active ? 'khỏi' : 'vào'} yêu thích`}
      onClick={async () =>
        toast(
          (await toggle(slug))
            ? 'Đã lưu vào danh sách yêu thích'
            : 'Đã bỏ khỏi danh sách yêu thích',
        )
      }
    >
      <HeartIcon />
    </button>
  );
}
