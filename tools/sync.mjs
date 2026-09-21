// Sync manual por si el navegador bloquea CORS contra la API oficial.
// Uso: npm run sync
// Genera tools/output-players.json -> pégalo en la pestaña "Añadir / editar" > Importar JSON.

const BASE = 'https://fantasy-api.llt-services.com/api';
const HEADERS = {
  Accept: 'application/json',
  'x-app': '2',
  'x-lang': 'es',
  Referer: 'https://fantasy.laliga.com/',
  'User-Agent': 'Mozilla/5.0'
};

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

const POS = { 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL' };

const teamsData = await getJSON(`${BASE}/v3/teams-master`).catch(() => ({}));
const teamList = Array.isArray(teamsData) ? teamsData : teamsData.teams || [];
const teamsById = {};
for (const t of teamList) teamsById[t.id ?? t.teamId] = t.nickname || t.shortName || t.name;

const raw = await getJSON(`${BASE}/v1/competition/1/players`);
const list = Array.isArray(raw) ? raw : raw.players || raw.data || [];

const players = list
  .map((p) => ({
    externalId: String(p.id ?? p.playerMasterId ?? ''),
    name: p.nickname || p.name,
    team: teamsById[p.teamId] || '',
    position: POS[p.positionId] || '?',
    price: Number(p.marketValue ?? 0),
    pointsTotal: Number(p.points ?? 0),
    photo: p.image || p.photoUrl || null
  }))
  .filter((p) => p.externalId && p.name && p.position !== '?');

const fs = await import('node:fs');
fs.writeFileSync(new URL('./output-players.json', import.meta.url), JSON.stringify(players, null, 2));
console.log(`Guardados ${players.length} jugadores en tools/output-players.json`);
