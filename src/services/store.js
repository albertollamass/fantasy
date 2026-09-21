// Capa de datos: Firestore si hay config, si no localStorage.
// Estrategia plan gratuito:
//  - Firestore SOLO guarda tu equipo (players con inSquad) + meta/finance.
//    Cada sync = ~1 lectura + ~15-25 escrituras (tu plantilla), no 827.
//  - El mercado completo (800+ jugadores) vive en memoria + caché local,
//    se descarga de la API oficial en cada sync sin tocar Firestore.
// Colecciones Firestore:
//  players/{id} -> solo jugadores con inSquad=true
//  meta/current -> { currentWeek, updatedAt }
//  meta/finance -> { cash, debtLimit, updatedAt }
// Solo la usas tú, por eso las rules están abiertas (ver firestore.rules).

import { db, hasFirebaseConfig } from '../firebase';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';

export const isCloud = hasFirebaseConfig && !!db;
const LS_KEY = 'fantasy-players-v1';
const LS_META = 'fantasy-meta-v1';
const LS_MARKET = 'fantasy-market-cache-v1';
const LS_FINANCE = 'fantasy-finance-v1';

function today() {
  return new Date().toISOString().slice(0, 10);
}
function uid() {
  return 'p_' + Math.random().toString(36).slice(2, 9);
}

function readLS() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeLS(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

export function emptyPlayer() {
  return {
    name: '',
    team: '',
    position: 'MED',
    price: 0,
    pointsTotal: 0,
    pointsLastWeek: 0,
    externalId: '',
    inSquad: true,
    isStarter: true,
    priceHistory: [],
    weeklyPoints: []
  };
}

export async function listPlayers() {
  if (!isCloud) return readLS();
  const snap = await getDocs(collection(db, 'players'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function savePlayer(p) {
  const id = p.id || uid();
  const now = new Date().toISOString();
  // registra historial si cambia el precio
  let prev = null;
  const all = await listPlayers();
  prev = all.find((x) => (x.id || x.externalId) === (p.id || p.externalId));

  const history = [...(p.priceHistory || prev?.priceHistory || [])];
  const lastPrice = history.length ? history[history.length - 1].price : null;
  if (p.price !== lastPrice) {
    history.push({ date: today(), price: Number(p.price) || 0, source: p._source || 'manual' });
  }

  const data = {
    ...p,
    id,
    priceHistory: history.slice(-60),
    updatedAt: now
  };
  delete data._source;

  if (!isCloud) {
    const list = readLS();
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = data;
    else list.push(data);
    writeLS(list);
    return data;
  }
  await setDoc(doc(db, 'players', id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return data;
}

export async function removePlayer(id) {
  if (!isCloud) {
    writeLS(readLS().filter((x) => x.id !== id));
    return;
  }
  await deleteDoc(doc(db, 'players', id));
}

// Sincroniza lista de la API oficial contra lo guardado.
// Guarda historial de precio automáticamente.
// Escritura por lotes: 1 lectura + N escrituras en batch (500 por lote).
export async function upsertFromApi(apiPlayers, weekLabel = '') {
  const current = await listPlayers();
  const byExt = new Map(current.filter((p) => p.externalId).map((p) => [String(p.externalId), p]));
  const now = new Date().toISOString();
  const mergedList = apiPlayers.map((api) => {
    const existing = byExt.get(String(api.externalId));
    const base = existing || { ...emptyPlayer(), id: api.externalId, externalId: api.externalId, inSquad: false, isStarter: false };
    const history = [...(base.priceHistory || [])];
    const lastPrice = history.length ? history[history.length - 1].price : null;
    if (api.price !== lastPrice) {
      history.push({ date: today(), price: Number(api.price) || 0, source: 'api' });
    }
    let weeklyPoints = base.weeklyPoints || [];
    if (weekLabel && existing) {
      const wp = [...weeklyPoints];
      if (!wp.some((w) => String(w.week) === String(weekLabel))) {
        const prevTotal = Number(existing.pointsTotal || 0);
        wp.push({ week: String(weekLabel), points: Math.max(0, Number(api.pointsTotal || 0) - prevTotal) });
      }
      weeklyPoints = wp.slice(-30);
    }
    return {
      ...base,
      id: base.id || String(api.externalId),
      name: api.name,
      team: api.team,
      position: api.position !== '?' ? api.position : base.position,
      price: api.price,
      pointsTotal: api.pointsTotal,
      externalId: String(api.externalId),
      priceHistory: history.slice(-60),
      weeklyPoints,
      updatedAt: now
    };
  });

  if (!isCloud) {
    const list = readLS();
    const byId = new Map(list.map((p) => [p.id, p]));
    for (const m of mergedList) byId.set(m.id, m);
    writeLS([...byId.values()]);
    try {
      localStorage.setItem(LS_META, JSON.stringify({ currentWeek: weekLabel, updatedAt: now }));
    } catch { /* noop */ }
    return mergedList;
  }

  // Firestore por lotes (máx 500 escrituras por batch)
  for (let i = 0; i < mergedList.length; i += 450) {
    const batch = writeBatch(db);
    for (const m of mergedList.slice(i, i + 450)) {
      batch.set(doc(db, 'players', String(m.id)), { ...m, updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
  await setDoc(doc(db, 'meta', 'current'), { currentWeek: weekLabel, updatedAt: serverTimestamp() }, { merge: true });
  return mergedList;
}

export function getCachedMarket() {
  try {
    return JSON.parse(localStorage.getItem(LS_MARKET) || 'null');
  } catch {
    return null;
  }
}

export function setCachedMarket(players, weekLabel) {
  try {
    localStorage.setItem(LS_MARKET, JSON.stringify({ updatedAt: new Date().toISOString(), week: weekLabel, players }));
  } catch { /* cuota llena: el mercado se pierde, no pasa nada */ }
}

// Foto del mercado incluida en el despliegue (public/market.json).
// En GitHub Pages el navegador no puede llamar a la API por CORS,
// asi que la app usa esta foto hasta que sincronices en local.
export async function fetchMarketSnapshot() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}market.json`);
    if (!res.ok) return null;
    const snap = await res.json();
    const players = Array.isArray(snap) ? snap : snap.players || [];
    if (!players.length) return null;
    return { players, week: snap.week || '', updatedAt: snap.updatedAt || '' };
  } catch {
    return null;
  }
}

// Descarga el mercado completo SIN guardarlo en Firestore.
// Solo actualiza en Firestore los jugadores de TU equipo (inSquad).
// Devuelve el mercado mezclado (con tus flags inSquad/isStarter) para memoria.
export async function syncMarketOnly(apiPlayers, weekLabel = '') {
  const squad = await listPlayers();
  const byExt = new Map(squad.filter((p) => p.externalId).map((p) => [String(p.externalId), p]));
  const now = new Date().toISOString();

  const market = apiPlayers.map((api) => {
    const existing = byExt.get(String(api.externalId));
    let priceHistory = existing?.priceHistory || [];
    if (existing && api.price !== (priceHistory.length ? priceHistory[priceHistory.length - 1].price : null)) {
      priceHistory = [...priceHistory, { date: today(), price: Number(api.price) || 0, source: 'api' }].slice(-60);
    }
    return {
      id: existing?.id || String(api.externalId),
      externalId: String(api.externalId),
      name: api.name,
      team: api.team,
      position: api.position,
      price: api.price,
      prevPrice: priceHistory.length >= 2 ? priceHistory[priceHistory.length - 2].price : (existing?.price ?? api.price),
      priceDiff: priceHistory.length >= 2 ? api.price - priceHistory[priceHistory.length - 2].price : 0,
      pointsTotal: api.pointsTotal,
      inSquad: !!existing?.inSquad,
      isStarter: existing ? !!existing.isStarter : false,
      priceHistory,
      weeklyPoints: existing?.weeklyPoints || []
    };
  });

  // Persiste SOLO tu equipo (los que ya tenías marcados)
  const squadUpdates = market.filter((m) => byExt.has(String(m.externalId)));
  if (!isCloud) {
    const list = readLS();
    const byId = new Map(list.map((p) => [p.id, p]));
    for (const m of squadUpdates) {
      const prev = byId.get(m.id) || {};
      byId.set(m.id, { ...prev, ...m, inSquad: true, updatedAt: now });
    }
    writeLS([...byId.values()]);
  } else if (squadUpdates.length) {
    for (let i = 0; i < squadUpdates.length; i += 450) {
      const batch = writeBatch(db);
      for (const m of squadUpdates.slice(i, i + 450)) {
        batch.set(doc(db, 'players', String(m.id)), { ...m, inSquad: true, updatedAt: serverTimestamp() }, { merge: true });
      }
      await batch.commit();
    }
    await setDoc(doc(db, 'meta', 'current'), { currentWeek: weekLabel, updatedAt: serverTimestamp() }, { merge: true });
  }

  setCachedMarket(market, weekLabel);
  return { market, squadWrites: squadUpdates.length };
}

// Borra de Firestore los docs que NO son de tu equipo (restos del modo antiguo
// que guardaba 150-800 jugadores). Libera almacenamiento del plan gratuito.
export async function cleanupMarket() {
  const all = await listPlayers();
  const junk = all.filter((p) => !p.inSquad);
  if (!isCloud) {
    writeLS(all.filter((p) => p.inSquad));
    return junk.length;
  }
  for (const j of junk) {
    await deleteDoc(doc(db, 'players', String(j.id)));
  }
  return junk.length;
}

export async function getFinance() {
  const fallback = { cash: 0 };
  try {
    if (!isCloud) {
      const raw = JSON.parse(localStorage.getItem(LS_FINANCE) || '{}');
      return { cash: Number(raw.cash) || 0 };
    }
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'meta', 'finance'));
    return snap.exists() ? { cash: Number(snap.data().cash) || 0 } : fallback;
  } catch {
    return fallback;
  }
}

export async function saveFinance({ cash }) {
  const data = { cash: Number(cash) || 0 };
  if (!isCloud) {
    localStorage.setItem(LS_FINANCE, JSON.stringify(data));
    return data;
  }
  await setDoc(doc(db, 'meta', 'finance'), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return data;
}

const LS_LINEUP = 'fantasy-lineup-v1';
export const FORMATIONS = ['5-4-1', '5-3-2', '4-5-1', '4-4-2', '4-3-3', '3-5-2', '3-4-3'];

export function parseFormation(f) {
  const m = String(f || '').split('-').map(Number);
  if (m.length !== 3 || m.some((n) => !Number.isInteger(n))) return { def: 4, med: 4, del: 2 };
  return { def: m[0], med: m[1], del: m[2] };
}

export async function getLineup() {
  const fallback = { formation: '4-4-2' };
  try {
    if (!isCloud) {
      const raw = JSON.parse(localStorage.getItem(LS_LINEUP) || '{}');
      const f = FORMATIONS.includes(raw.formation) ? raw.formation : fallback.formation;
      return { formation: f };
    }
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'meta', 'lineup'));
    const f = snap.exists() && FORMATIONS.includes(snap.data().formation) ? snap.data().formation : fallback.formation;
    return { formation: f };
  } catch {
    return fallback;
  }
}

export async function saveLineup({ formation }) {
  const f = FORMATIONS.includes(formation) ? formation : '4-4-2';
  if (!isCloud) {
    localStorage.setItem(LS_LINEUP, JSON.stringify({ formation: f }));
    return { formation: f };
  }
  await setDoc(doc(db, 'meta', 'lineup'), { formation: f, updatedAt: serverTimestamp() }, { merge: true });
  return { formation: f };
}

export function exportMarketForAI(market, weekLabel = '') {
  const sorted = [...market].sort((a, b) => (b.price || 0) - (a.price || 0));
  const line = (p) => {
    const h = p.priceHistory || [];
    const trend = h.length >= 2 ? h[h.length - 1].price - h[h.length - 2].price : (p.priceDiff || 0);
    const prev = h.length >= 2 ? h[h.length - 2].price : (p.prevPrice ?? null);
    const sign = trend > 0 ? `+${fmtM(trend)}` : `${fmtM(trend)}`;
    const ppm = p.price > 0 ? (Number(p.pointsTotal || 0) / (p.price / 1_000_000)).toFixed(2) : '0.00';
    const t = prev != null && trend !== 0 ? ` | tendencia ${sign} (antes ${fmtM(prev)})` : '';
    return `- ${p.name} (${p.position}, ${p.team}) | ${fmtM(p.price)} | ${p.pointsTotal ?? 0} pts${t} | ${ppm} pts/M`;
  };
  return [
    `MERCADO FANTASY DAZN (${sorted.length} jugadores${weekLabel ? `, jornada ${weekLabel}` : ''}) para analisis:`,
    'Formato por linea: nombre (posicion, equipo) | precio | puntos totales | tendencia | puntos por millon.',
    ...sorted.map(line),
    'Dime: chollos por posicion, quien puede subir de precio y en quien no merece la pena gastar.'
  ].join('\n');
}

export function exportLeagueForAI(listings, leagueName = '') {
  const sorted = [...listings].sort((a, b) => (b.price || 0) - (a.price || 0));
  const line = (l) =>
    `- ${l.name} (${l.position}) | ${fmtM(l.price)} | ${l.points ?? 0} pts | sale ${fmtM(l.salePrice)} | ${l.bids} pujas | vence ${l.expires || '?'} | vende ${l.seller}`;
  return [
    `MERCADO DE MI LIGA ${leagueName} (${sorted.length} lotes) para analisis:`,
    ...sorted.map(line),
    'Dime: por quien merece la pena pujar segun precio, pujas actuales, vencimiento y puntos.'
  ].join('\n');
}

export function exportForAI(players) {
  const inSquad = players.filter((p) => p.inSquad);
  const starters = inSquad.filter((p) => p.isStarter);
  const bench = inSquad.filter((p) => !p.isStarter);
  const line = (p) => {
    const last = (p.priceHistory || []).slice(-2);
    const trend = last.length === 2 ? last[1].price - last[0].price : 0;
    const sign = trend > 0 ? `+${trend}` : `${trend}`;
    const ppm = p.price > 0 ? (Number(p.pointsTotal || 0) / (p.price / 1_000_000)).toFixed(2) : '—';
    return `- ${p.name} (${p.position} · ${p.team}) | ${fmtM(p.price)} | ${p.pointsTotal ?? 0} pts tot | J${p.pointsLastWeek ?? 0} última | ${ppm} pts/M | tendencia ${sign}`;
  };
  return [
    'MI EQUIPO FANTASY DAZN (para análisis):',
    '',
    `TITULARES (${starters.length}):`,
    ...starters.map(line),
    '',
    `BANQUILLO (${bench.length}):`,
    ...bench.map(line),
    '',
    `Valor total plantilla: ${fmtM(starters.concat(bench).reduce((a, p) => a + (Number(p.price) || 0), 0))}`,
    'Dime: qué jugador merece la pena mantener/vender, chollos por posición y riesgo de bajada de precio.'
  ].join('\n');
}

export function fmtM(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return `${n}`;
}
