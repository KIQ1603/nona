#!/usr/bin/env node
// Helper to authorise the NONA app on a Zalo Official Account (OAuth v4 + PKCE) and print the tokens.
//   node scripts/zalo-oauth.mjs url      -> prints the page the OA admin must open
//   node scripts/zalo-oauth.mjs exchange <code>  -> trades the ?code=... from the redirect for the tokens
// Needs ZALO_APP_ID, ZALO_APP_SECRET and ZALO_REDIRECT_URI (the Callback URL set in the Zalo app) in the environment.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const { ZALO_APP_ID: appId, ZALO_APP_SECRET: secret, ZALO_REDIRECT_URI: redirect } = process.env;
const FILE = new URL('./.zalo-pkce.json', import.meta.url);
const need = (v, n) => v || (console.error(`Set ${n} first.`), process.exit(1));
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'url') {
  need(appId, 'ZALO_APP_ID'); need(redirect, 'ZALO_REDIRECT_URI');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  writeFileSync(FILE, JSON.stringify({ verifier, state }), { mode: 0o600 });
  const u = new URL('https://oauth.zaloapp.com/v4/oa/permission');
  u.search = new URLSearchParams({
    app_id: appId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state,
  }).toString();
  console.log('Open this link as an ADMIN of the Official Account and press "Cho phép":\n\n' + u + '\n');
  console.log('You will be redirected to your Callback URL with ?code=...&oa_id=... in the address bar.');
  console.log('Then run: node scripts/zalo-oauth.mjs exchange <that code>');
} else if (cmd === 'exchange' && arg) {
  need(appId, 'ZALO_APP_ID'); need(secret, 'ZALO_APP_SECRET');
  const { verifier } = JSON.parse(readFileSync(FILE, 'utf8'));
  const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', secret_key: secret },
    body: new URLSearchParams({ app_id: appId, code: arg, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const body = await res.json();
  if (!body.access_token) { console.error('Zalo refused:', body); process.exit(1); }
  console.log('Put this in .env (the worker rotates it by itself afterwards):\n');
  console.log(`ZALO_OA_REFRESH_TOKEN=${body.refresh_token}`);
  console.log(`# access token (valid ${body.expires_in}s, optional): ${body.access_token}`);
} else {
  console.error('Usage: node scripts/zalo-oauth.mjs url | exchange <code>');
  process.exit(1);
}
