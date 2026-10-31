export interface BannerImage {
  src: string;
  alt: string;
}

/** Photo of the Trang chủ banner (file in /public/banner). Shown whole, never cropped. */
export const HOME_BANNER: BannerImage[] = [
  {
    src: '/banner/banner-6.jpg',
    alt: 'Thiếu nữ áo dài trắng che nửa mặt sau chiếc nón lá vẽ hoa sen, giữa vườn cọ xanh',
  },
];

/** Photo of the Giới thiệu banner. */
export const ABOUT_BANNER: BannerImage[] = [
  {
    src: '/banner/banner-2.jpg',
    alt: 'Thiếu nữ áo dài hồng ôm chiếc nón lá đính đá hồng, bên những đóa hoa tím',
  },
];
