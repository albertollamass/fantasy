// Builds public/market.json from tools/output-players.json + current week.
// Usage: npm run sync && node tools/snapshot.mjs
// The snapshot ships with the site so GitHub Pages (no CORS to the
// official API from browsers) always has market data to show.

const HEADERS = {
  Accept: 'application/json',
  'x-app': '2',
  'x-lang': 'es',
  Referer: 'https://fantasy.laliga.com/',
  'User-Agent': 'Mozilla/5.0'
};

let week = '';
try {
  const r = await fetch('https://fantasy-api.llt-services.com/api/v1/competition/1/week/current', { headers: HEADERS });
  if (r.ok) {
    const w = await r.json();
    week = String(w.weekNumber ?? w.number ?? w.name ?? '');
  }
} catch { /* offline: keep week empty */ }

const fs = await import('node:fs');
const players = JSON.parse(fs.readFileSync(new URL('./output-players.json', import.meta.url), 'utf8'));
const snap = { updatedAt: new Date().toISOString(), week, players };
fs.writeFileSync(new URL('../public/market.json', import.meta.url), JSON.stringify(snap));
console.log(`Snapshot: ${players.length} players, week ${week || '?'}`);
