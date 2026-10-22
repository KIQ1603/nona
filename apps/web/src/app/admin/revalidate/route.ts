import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { getMe } from '@/lib/admin-server';

const ALLOWED = new Set(['catalog', 'settings']);

/** Lets the admin UI refresh cached storefront data right after a save. Staff session required. */
export async function POST(request: Request) {
  const me = await getMe();
  if (!me?.permissions.includes('admin:access'))
    return NextResponse.json({ ok: false }, { status: 401 });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host'))
    return NextResponse.json({ ok: false }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { tag?: string } | null;
  if (!body?.tag || !ALLOWED.has(body.tag))
    return NextResponse.json({ ok: false }, { status: 400 });
  revalidateTag(body.tag);
  return NextResponse.json({ ok: true });
}
