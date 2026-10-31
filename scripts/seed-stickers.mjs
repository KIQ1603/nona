// Puts the shop's picture stickers (rhinestone, pearl, shell) into the designer's options through the admin API,
// so it works against any environment (local, Render): the pictures go to the object store like any admin upload.
//
//   API_URL=http://localhost:4100 ADMIN_EMAIL=admin@local ADMIN_PASSWORD=1 \
//   WEB_ORIGIN=http://localhost:3100 node scripts/seed-stickers.mjs [--replace-all]
//
// Idempotent: a sticker with the same id is replaced. `--replace-all` also removes every other sticker (use it on a
// fresh/demo database). Sizes, prices and colours can be changed afterwards in the admin (Tự thiết kế).
// The prices below are SAMPLE values: set the real ones in the admin.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.API_URL ?? 'http://localhost:4100').replace(/\/$/, '');
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3100';
const replaceAll = process.argv.includes('--replace-all');

const STICKERS = [
  { id: 'da', name: 'Đá', file: 'da.png', sizeCm: 1.5, heightCm: 1.5, priceVnd: 5000 },
  { id: 'ngoc', name: 'Ngọc', file: 'ngoc.png', sizeCm: 1.5, heightCm: 1.5, priceVnd: 5000 },
  { id: 'vo-so', name: 'Vỏ sò', file: 'vo-so.png', sizeCm: 3.5, heightCm: 2.3, priceVnd: 8000 },
];

const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return res;
};

const login = await must(
  await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL ?? 'admin@local',
      password: process.env.ADMIN_PASSWORD ?? '1',
    }),
  }),
  'login',
);
const me = await login.json();
if (me.mfaRequired) throw new Error('This admin needs a one-time code (MFA): sign in on the web and add the stickers there.');
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const headers = { cookie, origin: ORIGIN, 'x-csrf-token': me.csrfToken };

const settings = await (await must(await fetch(`${API}/v1/admin/settings`, { headers }), 'read settings')).json();
const custom = settings.custom;
const { version, ...options } = custom;

const added = [];
for (const s of STICKERS) {
  const form = new FormData();
  form.set('file', new Blob([await fs.readFile(path.join(root, 'scripts/sticker-assets', s.file))], { type: 'image/png' }), s.file);
  const up = await (await must(await fetch(`${API}/v1/admin/custom/motif-image`, { method: 'POST', headers, body: form }), `upload ${s.id}`)).json();
  added.push({
    id: s.id,
    name: s.name,
    path: null,
    imageKey: up.imageKey,
    sizeCm: s.sizeCm,
    heightCm: s.heightCm,
    priceVnd: s.priceVnd,
    tint: 'shaded',
  });
}
const ids = new Set(added.map((m) => m.id));
const motifs = [...(replaceAll ? [] : options.motifs.filter((m) => !ids.has(m.id))), ...added].slice(0, 30);

await must(
  await fetch(`${API}/v1/admin/settings/custom`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ version, value: { ...options, enabled: true, motifs } }),
  }),
  'save options',
);
console.log(`Stickers saved: ${motifs.map((m) => m.name).join(', ')}`);
