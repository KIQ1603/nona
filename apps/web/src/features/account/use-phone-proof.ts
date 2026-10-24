'use client';

import { authProvidersSchema, type AuthProviders, type FirebaseWebConfig } from '@nona/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendFirebaseCode, type PhoneSession } from '@/lib/firebase-phone';

let cached: Promise<AuthProviders | null> | null = null;
/** One request per page load: how phone numbers are verified on this shop. */
function loadProviders() {
  cached ??= fetch('/api/auth/providers', { cache: 'no-store' })
    .then(async (r) => (r.ok ? authProvidersSchema.parse(await r.json()) : null))
    .catch(() => null);
  return cached;
}

/**
 * How the number is proven. `firebase` is the config when Firebase Phone Auth is on (the browser asks
 * Firebase to text the number, `confirm` returns the ID token to hand to our API), `null` when our own SMS
 * codes are used, `undefined` while this is still being looked up. Render `<div ref={holder} />` once.
 */
export function usePhoneProof() {
  const [firebase, setFirebase] = useState<FirebaseWebConfig | null | undefined>(undefined);
  const holder = useRef<HTMLDivElement>(null);
  const session = useRef<PhoneSession | null>(null);

  useEffect(() => {
    let live = true;
    void loadProviders().then((p) => live && setFirebase(p?.phone.firebase ?? null));
    return () => {
      live = false;
    };
  }, []);

  const send = useCallback(
    async (phoneE164: string) => {
      if (!firebase || !holder.current)
        throw Object.assign(new Error('Chưa thể gửi mã lúc này. Vui lòng thử lại.'), {
          handled: true,
        });
      session.current = null;
      session.current = await sendFirebaseCode(firebase, phoneE164, holder.current);
    },
    [firebase],
  );
  const confirm = useCallback(async (code: string): Promise<string> => {
    if (!session.current) throw Object.assign(new Error('Hãy gửi mã trước.'), { handled: true });
    return session.current.confirm(code);
  }, []);

  return { firebase, holder, send, confirm };
}
