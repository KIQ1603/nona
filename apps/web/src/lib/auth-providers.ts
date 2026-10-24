import { API_URL } from './env';

/** Which extra sign-in options the API has switched on (never blocks the page if the API is down). */
export async function getAuthProviders(): Promise<{ google: boolean }> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/providers`, { cache: 'no-store' });
    const body = res.ok ? ((await res.json()) as { google?: boolean }) : null;
    return { google: body?.google === true };
  } catch {
    return { google: false };
  }
}

/** Messages for `?loi=` on the login page after a failed Google sign-in. */
export const GOOGLE_ERRORS: Record<string, string> = {
  'google-trung-email':
    'Email Google này đã được đăng ký bằng mật khẩu. Vui lòng đăng nhập bằng email và mật khẩu (có thể dùng “Quên mật khẩu” nếu bạn chưa nhớ).',
  'google-chua-xac-thuc': 'Email của tài khoản Google này chưa được Google xác minh.',
  'google-chua-cau-hinh':
    'Đăng nhập bằng Google chưa được bật trên cửa hàng này. Vui lòng dùng email hoặc số điện thoại.',
  'google-huy': 'Bạn đã hủy đăng nhập bằng Google.',
  'google-loi': 'Không thể đăng nhập bằng Google. Vui lòng thử lại.',
};
