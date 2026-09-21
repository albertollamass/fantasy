// API oficial LaLiga Fantasy (usada por la app DAZN / fantasy.laliga.com)
// Base pública documentada por la comunidad:
//  - https://github.com/PlatanosVerdes/laliga-fantasy
//  - https://github.com/svendfe/laliga_fantasy_agent
//
// Endpoints PÚBLICOS (sin login):
//  GET /v1/competition/1/players
//  GET /v3/teams-master
//  GET /v1/competition/1/week/current
//  GET /v1/competition/1/calendar?weekNumber=N
//  GET /v1/competition/1/player/{id}
//  GET /v1/competition/1/player/{id}/market-value  (historial diario)
//
// Los endpoints de TU LIGA (/leagues/{id}/...) sí piden token de la app.
// Para esta v1 solo usamos los públicos: precios + puntos.
// IMPORTANTE: la base lleva /api y exige cabeceras x-app/x-lang como la app oficial.

// En navegador usamos el proxy local /api-fantasy (mismo origen, sin CORS).
// En Node (npm run sync) se usa la URL directa.
const DIRECT = 'https://fantasy-api.llt-services.com/api';
const BASE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? '/api-fantasy/api'
    : DIRECT;

function apiHeaders() {
  return {
    Accept: 'application/json',
    'x-app': '2',
    'x-lang': 'es',
    Referer: 'https://fantasy.laliga.com/'
  };
}

async function getJSON(url) {
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

const POSITION_MAP = {
  1: 'POR',
  2: 'DEF',
  3: 'MED',
  4: 'DEL',
  5: 'ENT' // entrenador, lo filtramos
};

export function normalizePlayer(p, teamsById = {}) {
  const pos = POSITION_MAP[p.positionId] || p.position || '?';
  return {
    externalId: String(p.id ?? p.playerId ?? p.playerMasterId ?? ''),
    name: p.nickname || p.name || p.fullName || 'Sin nombre',
    team: teamsById[p.teamId] || p.teamName || p.team || '',
    teamId: p.teamId ?? null,
    position: pos,
    price: Number(p.marketValue ?? p.price ?? p.value ?? 0),
    pointsTotal: Number(p.points ?? p.totalPoints ?? p.fantasyPoints ?? 0),
    pointsLastSeason: Number(p.lastSeasonPoints ?? 0),
    status: p.status ?? p.playerStatus ?? 'ok',
    photo: p.photoUrl || p.image || null,
    raw: p
  };
}

export async function fetchTeams() {
  const data = await getJSON(`${BASE}/v3/teams-master`);
  // forma habitual: { teams: [...] } o array directo
  const list = Array.isArray(data) ? data : data.teams || data.data || [];
  const byId = {};
  for (const t of list) {
    const id = t.id ?? t.teamId;
    byId[id] = t.nickname || t.shortName || t.name;
  }
  return { list, byId };
}

export async function fetchAllPlayers() {
  const [teams, data] = await Promise.all([
    fetchTeams().catch(() => ({ list: [], byId: {} })),
    getJSON(`${BASE}/v1/competition/1/players`)
  ]);
  const list = Array.isArray(data) ? data : data.players || data.data || [];
  return list
    .map((p) => normalizePlayer(p, teams.byId))
    .filter((p) => p.position !== 'ENT' && p.externalId);
}

export async function fetchCurrentWeek() {
  try {
    return await getJSON(`${BASE}/v1/competition/1/week/current`);
  } catch {
    return null;
  }
}

export async function fetchMarketHistory(externalId) {
  const data = await getJSON(`${BASE}/v1/competition/1/player/${externalId}/market-value`);
  const list = Array.isArray(data) ? data : data.history || data.marketValue || data.data || [];
  // normaliza a [{date, price}]
  return list
    .map((h) => ({
      date: h.date || h.day || h.createdAt || '',
      price: Number(h.value ?? h.marketValue ?? h.price ?? 0)
    }))
    .filter((h) => h.price > 0);
}

export const FantasyAPI = {
  fetchAllPlayers,
  fetchCurrentWeek,
  fetchMarketHistory,
  fetchTeams
};
