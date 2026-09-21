// Lee el mercado de TU liga — SOLO LECTURA, nunca puja ni vende.
// Requiere: node tools/league-auth.mjs (una vez).
// Uso: node tools/league-market.mjs [LEAGUE_ID]
// Salida: tools/output-league-market.json (para pegar en la pestana Mi liga).
// El token se refresca solo y se reescribe en tools/.tokens.json.

const BASE = 'https://fantasy-api.llt-services.com/api';
const POLICY = 'B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN';
const CLIENT_ID = 'af88bcff-1157-40a0-b579-030728aacf0b';
const TOKEN_URL = 'https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token';
const POS = { 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL', 5: 'ENT' };

const fs = await import('node:fs');
const TOKENS_FILE = new URL('./.tokens.json', import.meta.url);

function apiHeaders(bearer) {
  return {
    Accept: 'application/json',
    'x-app': '2',
    'x-lang': 'es',
    Referer: 'https://fantasy.laliga.com/',
    'User-Agent': 'Mozilla/5.0',
    Authorization: `Bearer ${bearer}`
  };
}

async function getJSON(url, bearer) {
  const r = await fetch(url, { headers: apiHeaders(bearer) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

function unwrap(raw) {
  if (Array.isArray(raw)) return raw;
  for (const k of ['data', 'elements', 'items']) {
    if (Array.isArray(raw?.[k])) return raw[k];
  }
  return [];
}

let saved;
try {
  saved = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
} catch {
  console.error('Sin sesion. Ejecuta primero: node tools/league-auth.mjs');
  process.exit(1);
}

async function refresh(withPolicy) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: saved.refresh_token,
    scope: 'openid offline_access'
  });
  const r = await fetch(withPolicy ? `${TOKEN_URL}?p=${POLICY}` : TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await r.text();
  if (!r.ok) return null;
  return JSON.parse(text);
}

if (Date.now() > (saved.expires_at || 0) - 120000) {
  console.log('Refrescando sesion...');
  let t = await refresh(true);
  if (!t) t = await refresh(false);
  if (!t?.access_token) {
    console.error('No se pudo refrescar. Repite: node tools/league-auth.mjs');
    process.exit(1);
  }
  saved = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || saved.refresh_token,
    token_type: t.token_type || 'Bearer',
    expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000
  };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
}

const bearer = saved.access_token;
const leagues = unwrap(await getJSON(`${BASE}/v1/competition/1/leagues`, bearer));
if (!leagues.length) {
  console.error('No veo ligas en tu cuenta.');
  process.exit(1);
}
console.log('\nTus ligas:');
for (const l of leagues) {
  console.log(`- ${l.id}: ${l.name || l.leagueName || '(sin nombre)'}`);
}

const leagueId = process.argv[2] || leagues[0].id;
const league = leagues.find((l) => String(l.id) === String(leagueId)) || leagues[0];
console.log(`\nMercado de: ${league.name || league.leagueName} (${league.id})`);

const market = unwrap(await getJSON(`${BASE}/v1/competition/1/league/${league.id}/market`, bearer));

const listings = market.map((m) => {
  const pm = m.playerMaster || {};
  return {
    marketId: String(m.id ?? ''),
    name: pm.nickname || pm.name || '(?)',
    position: POS[pm.positionId] || '?',
    teamId: pm.teamId ?? null,
    price: Number(pm.marketValue ?? 0),
    points: Number(pm.points ?? 0),
    salePrice: Number(m.salePrice ?? 0),
    bids: Number(m.numberOfBids ?? 0),
    expires: m.expirationDate || '',
    seller: m.sellerTeam?.name || m.sellerTeam?.shortName || 'LaLiga',
    directOffer: !!m.directOffer
  };
});

const out = {
  updatedAt: new Date().toISOString(),
  leagueId: String(league.id),
  leagueName: league.name || league.leagueName || '',
  listings
};
fs.writeFileSync(new URL('./output-league-market.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`\n${listings.length} lotes guardados en tools/output-league-market.json`);
console.log('Top por precio:');
for (const l of [...listings].sort((a, b) => b.price - a.price).slice(0, 10)) {
  console.log(`- ${l.name} (${l.position}, ${l.seller}) | ${l.price} | ${l.bids} pujas | vence ${l.expires}`);
}
console.log('\nPegalo en la app: pestana Mi liga.');
