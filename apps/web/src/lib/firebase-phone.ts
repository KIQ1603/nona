import type { FirebaseWebConfig } from '@nona/contracts';

/** What Firebase answers with when the number is texted: confirm() takes the typed code, returns the ID token. */
export interface PhoneSession {
  confirm: (code: string) => Promise<string>;
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-phone-number': 'Số điện thoại không hợp lệ.',
  'auth/missing-phone-number': 'Vui lòng nhập số điện thoại.',
  'auth/too-many-requests': 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.',
  'auth/quota-exceeded': 'Hệ thống tạm thời hết lượt gửi mã. Vui lòng thử lại sau.',
  'auth/invalid-verification-code': 'Mã không đúng. Vui lòng kiểm tra lại.',
  'auth/code-expired': 'Mã đã hết hạn. Hãy gửi lại mã mới.',
  'auth/session-expired': 'Mã đã hết hạn. Hãy gửi lại mã mới.',
  'auth/captcha-check-failed': 'Không xác minh được bạn là người thật. Vui lòng tải lại trang.',
  'auth/network-request-failed': 'Không thể kết nối. Vui lòng kiểm tra mạng.',
  'auth/operation-not-allowed':
    'Xác thực số điện thoại chưa được bật hoặc chưa cho phép gửi đến Việt Nam.',
  'auth/billing-not-enabled':
    'Dịch vụ gửi SMS chưa được bật cho cửa hàng này. Vui lòng liên hệ cửa hàng.',
  'auth/unauthorized-domain': 'Tên miền này chưa được cho phép dùng xác thực số điện thoại.',
};

/** Firebase errors become short Vietnamese messages that `describeApiError` shows as they are. */
function friendly(error: unknown): Error {
  const code = (error as { code?: string } | null)?.code ?? '';
  return Object.assign(
    new Error(MESSAGES[code] ?? 'Không thể xác thực số điện thoại. Vui lòng thử lại.'),
    { handled: true },
  );
}

type Verifier = { clear: () => void };
let lastVerifier: Verifier | null = null;

/**
 * Asks Firebase to text a code to `phone` (E.164). Firebase protects this with an invisible reCAPTCHA that
 * lives inside `holder`. The SDK is loaded only when someone actually verifies a number.
 */
export async function sendFirebaseCode(
  config: FirebaseWebConfig,
  phone: string,
  holder: HTMLElement,
): Promise<PhoneSession> {
  try {
    const [{ getApp, getApps, initializeApp }, auth] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = getApps().length > 0 ? getApp() : initializeApp(config);
    const service = auth.getAuth(app);
    service.languageCode = 'vi';
    lastVerifier?.clear(); // a reCAPTCHA widget can only be used once
    holder.replaceChildren();
    const slot = holder.appendChild(document.createElement('div'));
    const verifier = new auth.RecaptchaVerifier(service, slot, { size: 'invisible' });
    lastVerifier = verifier;
    let confirmation;
    try {
      confirmation = await auth.signInWithPhoneNumber(service, phone, verifier);
    } catch (e) {
      verifier.clear();
      lastVerifier = null;
      throw e;
    }
    return {
      confirm: async (code) => {
        try {
          const credential = await confirmation.confirm(code);
          const token = await credential.user.getIdToken();
          // we only needed the proof of the number: our own session is the API's cookie
          await auth.signOut(service).catch(() => undefined);
          return token;
        } catch (e) {
          throw friendly(e);
        }
      },
    };
  } catch (e) {
    throw friendly(e);
  }
}
