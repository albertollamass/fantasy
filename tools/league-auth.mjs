// Login de un solo paso contra LaLiga (Azure AD B2C) — SOLO LECTURA.
// No pide tu contrasena al script: te da una URL, te logueas TU en tu
// navegador (igual que en la app: Google/Apple/email) y pegas aqui la
// redireccion. Guarda el token en tools/.tokens.json (gitignored, modo 600).
// Uso: node tools/league-auth.mjs

import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

const POLICY = 'B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN';
const CLIENT_ID = 'af88bcff-1157-40a0-b579-030728aacf0b';
const REDIRECT_URI = 'authredirect://com.lfp.laligafantasy';
const AUTH_URL = 'https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));
const nonce = b64url(randomBytes(16));

const url =
  `${AUTH_URL}?p=${POLICY}&client_id=${CLIENT_ID}&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('openid offline_access')}` +
  `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&nonce=${nonce}`;

console.log('\n1. Abre esta URL en Chrome (activa antes DevTools > Network > Preserve log):\n');
console.log(url);
console.log('\n2. Logueate como en la app. El navegador se quedara en blanco: es lo esperado.');
console.log('3. En Network, ultima fila "(canceled)", boton derecho > Copy > Copy link address.');
console.log('   Empieza por authredirect://com.lfp.laligafantasy/?state=...&code=...\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((res) => rl.question('Pega aqui la redireccion: ', res));
rl.close();

const redirect = answer.trim().replace(/^"|"$/g, '');
const qs = redirect.split('?')[1] || '';
const params = new URLSearchParams(qs);
const code = params.get('code');
const returnedState = params.get('state');
if (!code) {
  console.error('No veo ningun code en lo pegado. Empieza de nuevo.');
  process.exit(1);
}
if (returnedState !== state) {
  console.error('El state no coincide (URL de otro intento). Repite desde el paso 1.');
  process.exit(1);
}

async function exchange(withPolicy) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });
  if (withPolicy) body.set('p', POLICY);
  const r = await fetch(withPolicy ? `${TOKEN_URL}?p=${POLICY}` : TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

let res = await exchange(true);
if (!res.ok) {
  console.log(`Token con policy: HTTP ${res.status}. Reintento sin policy...`);
  res = await exchange(false);
}
if (!res.ok) {
  console.error(`Fallo el intercambio (HTTP ${res.status}):\n${res.text.slice(0, 500)}`);
  process.exit(1);
}

const tokens = JSON.parse(res.text);
const saved = {
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  token_type: tokens.token_type || 'Bearer',
  expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000
};
writeFileSync(new URL('./.tokens.json', import.meta.url), JSON.stringify(saved, null, 2), { mode: 0o600 });
console.log('\nSesion guardada en tools/.tokens.json (solo lectura desde aqui).');
console.log('Siguiente: node tools/league-market.mjs');
