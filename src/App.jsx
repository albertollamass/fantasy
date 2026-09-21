import React, { useEffect, useMemo, useState } from 'react';
import {
  listPlayers, savePlayer, removePlayer,
  syncMarketOnly, cleanupMarket, getCachedMarket, fetchMarketSnapshot,
  getFinance, saveFinance, getLineup, saveLineup,
  FORMATIONS, parseFormation,
  exportForAI, exportMarketForAI, exportLeagueForAI, fmtM, emptyPlayer, isCloud
} from './services/store';
import { FantasyAPI } from './services/fantasyApi';
import './styles.css';

const POSITIONS = ['POR', 'DEF', 'MED', 'DEL'];
const PAGE_SIZE = 48;
const TABS = [
  { id: 'equipo', label: 'Mi equipo' },
  { id: 'mercado', label: 'Por posición' },
  { id: 'analisis', label: 'Análisis subidas/bajadas' },
  { id: 'liga', label: 'Mi liga' }
];

function trendOf(p) {
  if (typeof p.priceDiff === 'number' && p.priceDiff !== 0) return p.priceDiff;
  const h = p.priceHistory || [];
  if (h.length < 2) return 0;
  return (h[h.length - 1].price || 0) - (h[h.length - 2].price || 0);
}
function prevOf(p) {
  if (typeof p.prevPrice === 'number') return p.prevPrice;
  const h = p.priceHistory || [];
  if (h.length < 2) return null;
  return h[h.length - 2].price;
}
function ppm(p) {
  if (!p.price) return 0;
  return Number(p.pointsTotal || 0) / (p.price / 1_000_000);
}
function fmtSigned(v) {
  const n = Number(v) || 0;
  return (n > 0 ? '+' : '') + fmtM(n);
}

export default function App() {
  const [players, setPlayers] = useState([]);
  const [market, setMarket] = useState([]);
  const [marketInfo, setMarketInfo] = useState(null);
  const [finance, setFinance] = useState({ cash: 0 });
  const [formation, setFormation] = useState('4-4-2');
  const [tab, setTab] = useState('equipo');
  const [posFilter, setPosFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('price');
  const [page, setPage] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [swapPick, setSwapPick] = useState(null);
  const [popupFor, setPopupFor] = useState(null);
  const [msg, setMsg] = useState('');
  const [aiText, setAiText] = useState('');
  const [leagueText, setLeagueText] = useState('');
  const [league, setLeague] = useState(null);

  async function reload() {
    try {
      const [squad, fin, lin] = await Promise.all([listPlayers(), getFinance(), getLineup()]);
      setPlayers(squad);
      setFinance(fin);
      setFormation(lin.formation);
    } catch (e) {
      console.error(e);
      if (/permission|permissions|denied/i.test(e.message || '')) {
        setMsg('Firestore bloquea la lectura: ve a Firebase Console, Firestore Database, Reglas, pega el contenido de firestore.rules y publica. Detalle: ' + e.message);
      } else {
        setMsg('No pude leer Firestore. Detalle: ' + (e.message || e));
      }
    }
  }
  useEffect(() => {
    reload();
    const cached = getCachedMarket();
    if (cached?.players?.length) {
      setMarket(cached.players);
      setMarketInfo({ updatedAt: cached.updatedAt, week: cached.week, fromCache: true });
    } else {
      fetchMarketSnapshot().then((snap) => {
        if (snap) {
          setMarket(snap.players);
          setMarketInfo({ updatedAt: snap.updatedAt, week: snap.week, snapshot: true });
        }
      });
    }
  }, []);

  const explore = market.length ? market : players;

  const filtered = useMemo(() => {
    let list = [...explore];
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => (p.name + ' ' + p.team).toLowerCase().includes(q));
    }
    const by = {
      price: (a, b) => (b.price || 0) - (a.price || 0),
      points: (a, b) => (b.pointsTotal || 0) - (a.pointsTotal || 0),
      ppm: (a, b) => ppm(b) - ppm(a),
      trend: (a, b) => trendOf(b) - trendOf(a),
      name: (a, b) => (a.name || '').localeCompare(b.name || '')
    }[sortBy];
    return list.sort(by);
  }, [explore, posFilter, query, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const squad = useMemo(() => players.filter((p) => p.inSquad), [players]);
  const starters = useMemo(() => squad.filter((p) => p.isStarter), [squad]);
  const bench = useMemo(() => squad.filter((p) => !p.isStarter), [squad]);
  const totalValue = useMemo(() => squad.reduce((a, p) => a + (Number(p.price) || 0), 0), [squad]);
  const netWorth = (Number(finance.cash) || 0) + totalValue;
  // Regla oficial del Fantasy: endeudamiento maximo = 20% del valor del equipo.
  const debtLimit = Math.floor(totalValue * 0.2);
  const buyingPower = (Number(finance.cash) || 0) + debtLimit;
  const cashNum = Number(finance.cash) || 0;

  const photoByExt = useMemo(() => {
    const map = {};
    const grab = (list) => {
      for (const p of list || []) {
        if (p && p.externalId && p.photo) map[String(p.externalId)] = p.photo;
      }
    };
    grab(market);
    grab(players);
    return map;
  }, [market, players]);
  const photoOf = (p) => (p && (p.photo || photoByExt[String(p.externalId)])) || null;

  const analysis = useMemo(() => {
    const withTrend = explore.map((p) => ({ p, trend: trendOf(p), ppm: ppm(p) }));
    return {
      up: [...withTrend].sort((a, b) => b.trend - a.trend).slice(0, 10),
      down: [...withTrend].sort((a, b) => a.trend - b.trend).slice(0, 10),
      value: [...withTrend].sort((a, b) => b.ppm - a.ppm).slice(0, 10)
    };
  }, [explore]);

  async function handleSync() {
    setSyncing(true);
    setMsg('');
    try {
      const [apiPlayers, week] = await Promise.all([
        FantasyAPI.fetchAllPlayers(),
        FantasyAPI.fetchCurrentWeek().catch(() => null)
      ]);
      const weekLabel = week?.weekNumber ?? week?.number ?? week?.name ?? new Date().toISOString().slice(0, 10);
      const { market: full } = await syncMarketOnly(apiPlayers, String(weekLabel));
      setMarket(full);
      setMarketInfo({ updatedAt: new Date().toISOString(), week: String(weekLabel), fromCache: false });
      setPage(0);
      await reload();
      setMsg(`Mercado descargado: ${full.length} jugadores de la jornada ${weekLabel}. Tu equipo queda actualizado.`);
    } catch (e) {
      console.error(e);
      const m = e.message || String(e);
      const snap = await fetchMarketSnapshot().catch(() => null);
      if (snap) {
        setMarket(snap.players);
        setMarketInfo({ updatedAt: snap.updatedAt, week: snap.week, snapshot: true });
        setPage(0);
        setMsg(`La API no responde desde esta pagina. Cargo la foto del mercado del ${String(snap.updatedAt).slice(0, 10)}. Sincroniza en local para datos frescos.`);
      } else if (/permission|permissions|denied/i.test(m)) {
        setMsg('Firestore rechaza la escritura. Abre Firebase Console, Firestore Database, Reglas, pega firestore.rules y publica.');
      } else {
        setMsg('Fallo la descarga de la API. Alternativa: npm run sync e importa el JSON en Añadir. Detalle: ' + m);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleCleanup() {
    if (!confirm('Borrar de Firestore los jugadores que no estan en tu equipo? Libera almacenamiento del plan gratuito.')) return;
    const n = await cleanupMarket();
    await reload();
    setMsg(`Limpieza hecha: ${n} restos de mercado borrados de Firestore. Tu equipo intacto.`);
  }

  async function handleFinanceSave(e) {
    e.preventDefault();
    const data = await saveFinance(finance);
    setFinance(data);
    setMsg('Caja guardada');
  }

  async function handleSwapClick(p) {
    setPopupFor(p);
    setSwapPick(p.id);
  }

  async function handleSwapPick(candidate) {
    const all = players.filter((x) => x.inSquad);
    const a = all.find((x) => x.id === (popupFor && popupFor.id));
    const b = all.find((x) => x.id === candidate.id);
    setPopupFor(null);
    setSwapPick(null);
    if (!a || !b || a.id === b.id) return;
    if (!!a.isStarter === !!b.isStarter) return;
    await savePlayer({ ...a, isStarter: !a.isStarter });
    await savePlayer({ ...b, isStarter: !b.isStarter });
    await reload();
    const entra = b.isStarter ? a : b;
    const sale = b.isStarter ? b : a;
    setMsg(`${entra.name} entra por ${sale.name}`);
  }

  function popupCandidates() {
    if (!popupFor) return [];
    const all = players.filter((x) => x.inSquad);
    return all
      .filter((x) => x.position === popupFor.position && !!x.isStarter !== !!popupFor.isStarter)
      .sort((x, y) => (y.pointsTotal || 0) - (x.pointsTotal || 0));
  }

  async function handleFormationChange(f) {
    setFormation(f);
    await saveLineup({ formation: f });
  }

  const shape = parseFormation(formation);
  const byLine = (pos) =>
    starters
      .filter((p) => p.position === pos)
      .sort((a, b) => (b.pointsTotal || 0) - (a.pointsTotal || 0));
  const slotsFor = (pos, count) => {
    const list = byLine(pos);
    return Array.from({ length: count }, (_, i) => list[i] || null);
  };

  async function toggleSquad(p, field) {
    if (field === 'inSquad' && p.inSquad) {
      if (!confirm(`Quitar a ${p.name} de tu equipo? Se borrara de Firestore.`)) return;
      const squadDoc = players.find((x) => String(x.externalId) === String(p.externalId) || x.id === p.id);
      if (squadDoc) await removePlayer(squadDoc.id);
      setMarket((m) => m.map((x) => (String(x.externalId) === String(p.externalId) ? { ...x, inSquad: false } : x)));
      await reload();
      return;
    }
    if (field === 'inSquad' && !p.inSquad) {
      await savePlayer({ ...emptyPlayer(), name: p.name, team: p.team, position: p.position, price: p.price, pointsTotal: p.pointsTotal, externalId: String(p.externalId || p.id), inSquad: true, isStarter: false, priceHistory: p.priceHistory || [] });
      setMarket((m) => m.map((x) => (String(x.externalId) === String(p.externalId) ? { ...x, inSquad: true, isStarter: false } : x)));
      await reload();
      setMsg(`${p.name} entra en tu equipo`);
      return;
    }
    await savePlayer({ ...p, [field]: !p[field] });
    await reload();
  }

  function copyAI() {
    const t = exportForAI(players);
    setAiText(t);
    navigator.clipboard?.writeText(t).then(() => setMsg('Resumen copiado para tu IA')).catch(() => setMsg('Texto generado abajo, copialo a mano'));
  }

  function copyMarketAI() {
    const src = market.length ? market : players;
    if (!src.length) { setMsg('No hay mercado: sincroniza primero.'); return; }
    const t = exportMarketForAI(src, marketInfo?.week || '');
    setAiText(t);
    navigator.clipboard?.writeText(t).then(() => setMsg(`Mercado copiado: ${src.length} jugadores para tu IA`)).catch(() => setMsg('Texto generado abajo, copialo a mano'));
  }

  function copyLeagueAI() {
    if (!league?.listings?.length) { setMsg('Pega primero el mercado de tu liga.'); return; }
    const t = exportLeagueForAI(league.listings, league.leagueName);
    setAiText(t);
    navigator.clipboard?.writeText(t).then(() => setMsg(`Mercado de liga copiado: ${league.listings.length} lotes`)).catch(() => setMsg('Texto generado abajo, copialo a mano'));
  }

  function loadLeague() {
    try {
      const data = JSON.parse(leagueText);
      const rawList = Array.isArray(data) ? data : data.listings || [];
      const listings = rawList.map((l, i) => ({
        marketId: String(l.marketId ?? l.id ?? l.externalId ?? i),
        name: l.name || '?',
        position: l.position || '?',
        team: l.team || '',
        price: Number(l.price) || 0,
        points: Number(l.points ?? l.pointsTotal) || 0,
        salePrice: Number(l.salePrice) || 0,
        bids: Number(l.bids) || 0,
        expires: l.expires || '',
        seller: l.seller || '',
        photo: l.photo || null
      }));
      if (!listings.length) { setMsg('JSON vacio o sin lotes.'); return; }
      setLeague({ leagueName: data.leagueName || '', updatedAt: data.updatedAt || '', listings });
      setMsg(`Mercado de liga cargado: ${listings.length} lotes. Solo en memoria: nada va a Firestore y nada puja.`);
    } catch (e) { setMsg('JSON invalido: ' + e.message); }
  }

  return (
    <div className="app">
      <header className="marcador">
        <div className="marcador-fila">
          <div>
            <h1 className="marca">Fantasy DAZN Manager</h1>
            <span className="jornada">Jornada <b>{marketInfo?.week || 'sin datos'}</b></span>
            <span className="jornada-dim">{market.length > 0 ? `${market.length} jugadores en mercado` : 'Pulsa sincronizar para traer el mercado'}</span>
            {!isCloud && <span className="jornada-dim">Modo local</span>}
          </div>
          <div className="acciones">
            <button onClick={handleSync} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar mercado'}</button>
            <button className="ghost" onClick={copyAI}>Copiar equipo para IA</button>
            <button className="ghost" onClick={copyMarketAI}>Copiar mercado para IA</button>
          </div>
        </div>
        <div className="cifras">
          <div className="cifra destacada"><span>Valor del equipo</span><strong>{fmtM(totalValue)}</strong></div>
          <div className="cifra"><span>Dinero en caja</span><strong>{fmtM(Number(finance.cash) || 0)}</strong></div>
          <div className="cifra"><span>Poder de compra</span><strong>{fmtM(buyingPower)}</strong></div>
          <div className="cifra"><span>Jugadores</span><strong>{squad.length}</strong></div>
        </div>
      </header>

      {msg && <div className="banner">{msg}</div>}
      {cashNum < 0 && (
        <div className="banner">
          Caja en negativo ({fmtM(cashNum)}). Con saldo negativo no puntuas la jornada: sube a cero antes del cierre.
          {cashNum < -debtLimit ? ' Ademas superas el endeudamiento maximo, el juego no te dejara fichar.' : ' Margen restante para fichar: ' + fmtM(debtLimit + cashNum) + '.'}
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <TabError key={tab}>

      {tab === 'equipo' && (
        <>
          <section className="caja">
            <form onSubmit={handleFinanceSave}>
              <label>Dinero en caja (euros)<input type="number" value={finance.cash} onChange={(e) => setFinance({ cash: e.target.value })} /></label>
              <span className="aviso">Endeudamiento maximo permitido: {fmtM(debtLimit)}, el 20% del valor del equipo.</span>
              <span className="aviso">Patrimonio, caja mas equipo: {fmtM(netWorth)}</span>
              <button type="submit">Guardar caja</button>
            </form>
          </section>
          <section className="campo-wrap">
            <div className="campo-head">
              <h2>Alineacion {formation}</h2>
              <select value={formation} onChange={(e) => handleFormationChange(e.target.value)}>
                {FORMATIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="campo">
              <PitchRow label="DEL" slots={slotsFor('DEL', shape.del)} onPick={handleSwapClick} pickedId={swapPick} photoOf={photoOf} />
              <PitchRow label="MED" slots={slotsFor('MED', shape.med)} onPick={handleSwapClick} pickedId={swapPick} photoOf={photoOf} />
              <PitchRow label="DEF" slots={slotsFor('DEF', shape.def)} onPick={handleSwapClick} pickedId={swapPick} photoOf={photoOf} />
              <PitchRow label="POR" slots={slotsFor('POR', 1)} onPick={handleSwapClick} pickedId={swapPick} photoOf={photoOf} />
            </div>
            <div className="banquillo">
              <h3>Banquillo</h3>
              <div className="tick-mini">
                {bench.length === 0 && <span className="aviso">Banquillo vacio.</span>}
                {bench.map((p) => (
                  <button key={p.id} type="button" className={'mini' + (swapPick === p.id ? ' elegido' : '')} onClick={() => handleSwapClick(p)}>
                    <Avatar src={photoOf(p)} name={p.name} />
                    <strong>{p.name} ({p.position})</strong>
                    <span>{p.pointsTotal ?? 0} pts, {fmtM(p.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section id="equipo-completo" className="hoja">
            <h2>Mi equipo completo</h2>
            {POSITIONS.map((pos) => {
              const line = [...starters.filter((p) => p.position === pos), ...bench.filter((p) => p.position === pos)];
              return (
                <div key={pos} className="linea">
                  <h3>{pos}</h3>
                  {line.map((p) => (
                    <div key={p.id}>
                      <div className="ficha">
                        <span className="quien"><Avatar src={photoOf(p)} name={p.name} /><span className="txt"><span className="nombre">{p.name}</span> <span className="equipo"> {p.team || ''}</span>
                          <span className="rol">{p.isStarter ? 'Titular' : 'Banquillo'}</span></span>
                        </span>
                        <span><DiffBadge p={p} /> <span className="precio">{fmtM(p.price)}</span></span>
                      </div>
                      <div className="ficha-acciones">
                        <button onClick={() => toggleSquad(p, 'inSquad')}>Quitar</button>
                        <button onClick={() => toggleSquad(p, 'isStarter')}>{p.isStarter ? 'A banquillo' : 'A titular'}</button>
                      </div>
                    </div>
                  ))}
                  {line.length === 0 && <p className="vacio">Sin jugadores en esta linea.</p>}
                </div>
              );
            })}
            {squad.length === 0 && (
              <p className="nota">Aun no tienes equipo. Sincroniza el mercado y marca al equipo, o añade a mano.</p>
            )}
          </section>
        </>
      )}

      {tab === 'mercado' && (
        <section>
          <div className="filtros">
            <div className="pos-tabs">
              {['ALL', ...POSITIONS].map((p) => (
                <button key={p} className={posFilter === p ? 'active' : ''} onClick={() => { setPosFilter(p); setPage(0); }}>
                  {p === 'ALL' ? 'Todos' : p}
                </button>
              ))}
            </div>
            <input placeholder="Buscar jugador o equipo" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="price">Orden: precio</option>
              <option value="points">Orden: puntos totales</option>
              <option value="ppm">Orden: puntos por millon</option>
              <option value="trend">Orden: tendencia de precio</option>
              <option value="name">Orden: nombre</option>
            </select>
          </div>
          <p className="aviso">
            {market.length
              ? `${filtered.length} jugadores a la vista, jornada ${marketInfo?.week || 'sin datos'}. Pagina ${safePage + 1} de ${totalPages}.`
              : 'Sin mercado descargado: sincroniza para traerlo todo.'}
          </p>
          <p className="aviso"><button className="ghost sm" onClick={handleCleanup}>Liberar Firestore, dejar solo mi equipo</button></p>
          <div className="ticker">
            {paged.map((p) => (
              <TickerRow key={p.externalId || p.id} p={p} onToggleSquad={() => toggleSquad(p, 'inSquad')} photoOf={photoOf} />
            ))}
          </div>
          <div className="pager">
            <button className="ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</button>
            <span>Pagina {safePage + 1} de {totalPages}, {filtered.length} jugadores</span>
            <button className="ghost" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Siguiente</button>
          </div>
          {filtered.length === 0 && <p className="aviso">Sin jugadores con ese filtro.</p>}
        </section>
      )}

      {tab === 'analisis' && (
        <section className="cols3">
          <div>
            <h3>Subidas de precio</h3>
            {analysis.up.map(({ p, trend }) => (
              <Row key={p.externalId || p.id} p={p} trend={trend} />
            ))}
          </div>
          <div>
            <h3>Bajadas de precio</h3>
            {analysis.down.map(({ p, trend }) => (
              <Row key={p.externalId || p.id} p={p} trend={trend} />
            ))}
          </div>
          <div>
            <h3>Chollos por punto</h3>
            {analysis.value.map(({ p, ppm: v }) => (
              <Row key={p.externalId || p.id} p={p} trend={null} extra={`${v.toFixed(2)} pts por millon`} />
            ))}
          </div>
        </section>
      )}

      {tab === 'liga' && (
        <section>
          <h3>Mercado de mi liga (solo lectura)</h3>
          <p className="aviso">Generalo en tu PC: node tools/league-auth.mjs una vez, luego node tools/league-market.mjs. Pega aqui el contenido de tools/output-league-market.json.</p>
          <textarea rows={5} style={{ width: '100%' }} value={leagueText} onChange={(e) => setLeagueText(e.target.value)} placeholder="Pega aqui el JSON del mercado de tu liga" />
          <div className="form-actions">
            <button type="button" onClick={loadLeague}>Ver mercado</button>
            <button type="button" className="ghost" onClick={copyLeagueAI}>Copiar mercado de liga para IA</button>
          </div>
          {league && <p className="aviso">{league.leagueName} · {league.listings.length} lotes · {String(league.updatedAt).slice(0, 16).replace('T', ' ')}</p>}
          {league && league.listings.map((l) => (
            <div key={l.marketId} className="row row-liga">
              <span className="quien"><Avatar src={l.photo} name={l.name} /><span className="txt"><strong>{l.name}</strong> <span className="muted">({l.position}, vende {l.seller})</span></span>
              </span><span>{fmtM(l.price)} · {l.bids} pujas · {String(l.expires).slice(5, 16).replace('T', ' ')}</span>
            </div>
          ))}
        </section>
      )}

      </TabError>
      {aiText && (
        <section>
          <h3>Texto para la IA</h3>
          <textarea rows={14} readOnly value={aiText} style={{ width: '100%' }} />
        </section>
      )}

      {popupFor && (
        <div className="popup-fondo" onClick={() => { setPopupFor(null); setSwapPick(null); }}>
          <div className="popup" onClick={(e) => e.stopPropagation()}>
            <h3>Cambio en {popupFor.position}: {popupFor.name}</h3>
            {popupFor.isStarter
              ? <p className="aviso">Elige del banquillo quien entra por el.</p>
              : <p className="aviso">Elige del once a quien sustituye.</p>}
            <div className="popup-lista">
              {popupCandidates().length === 0 && (
                <p className="aviso">No hay jugadores de {popupFor.position} en el otro bloque.</p>
              )}
              {popupCandidates().map((c) => (
                <button key={c.id} type="button" className="popup-opcion" onClick={() => handleSwapPick(c)}>
                  <Avatar src={photoOf(c)} name={c.name} />
                  <strong>{c.name}</strong>
                  <span>{c.team}, {fmtM(c.price)}, {c.pointsTotal ?? 0} pts</span>
                </button>
              ))}
            </div>
            <button type="button" className="ghost" onClick={() => { setPopupFor(null); setSwapPick(null); }}>Cancelar</button>
          </div>
        </div>
      )}

    </div>
  );
}

function Avatar({ src, name }) {
  const [ko, setKo] = useState(false);
  if (!src || ko) return null;
  return <img className="avatar" src={src} alt={name} loading="lazy" onError={() => setKo(true)} />;
}

class TabError extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e) {
    return { error: e };
  }
  componentDidCatch(e) {
    console.error(e);
  }
  render() {
    if (this.state.error) {
      return <div className="banner">Esta vista fallo: {String((this.state.error && this.state.error.message) || this.state.error)}. Haz captura y pasamela.</div>;
    }
    return this.props.children;
  }
}

function PitchRow({ label, slots, onPick, pickedId, photoOf }) {
  return (
    <div className="fila-campo">
      {slots.map((p, i) =>
        p ? (
          <button key={p.id} type="button" className={'jugador' + (pickedId === p.id ? ' elegido' : '')} onClick={() => onPick(p)} title="Toca para marcar el cambio">
            <Avatar src={photoOf(p)} name={p.name} />
            <strong>{p.name}</strong>
            <span>{p.team}, {fmtM(p.price)}</span>
          </button>
        ) : (
          <span key={'hueco-' + label + '-' + i} className="hueco">Falta jugador ({label})</span>
        )
      )}
    </div>
  );
}

function DiffBadge({ p }) {
  const trend = trendOf(p);
  const prev = prevOf(p);
  if (prev == null || trend === 0) return <span className="dif plano">sin cambio</span>;
  return (
    <span className={`dif ${trend > 0 ? 'sube' : 'baja'}`}>
      {fmtSigned(trend)}, antes {fmtM(prev)}
    </span>
  );
}

function TickerRow({ p, onToggleSquad, photoOf }) {
  const trend = trendOf(p);
  return (
    <div className="tick">
      <span className="dorsal">{p.position}</span>
      <div className="quien">
        <Avatar src={photoOf(p)} name={p.name} />
        <div className="txt">
          <strong>{p.name}</strong>
          <span>{p.team || 'Sin equipo'}, {p.pointsTotal ?? 0} puntos, {ppm(p).toFixed(2)} por millon</span>
          {p.inSquad && <span className="marca-equipo"> En tu equipo{p.isStarter ? ', titular' : ', banquillo'}</span>}
        </div>
      </div>
      <div className="numeros">
        <div className="p">{fmtM(p.price)}</div>
        <DiffBadge p={p} />
        <div className="tick-acciones">
          <button className="ghost sm" onClick={onToggleSquad}>{p.inSquad ? 'Quitar' : 'Al equipo'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ p, trend, extra }) {
  const t = trend ?? trendOf(p);
  const prev = prevOf(p);
  return (
    <div className={`row ${t > 0 ? 'up' : t < 0 ? 'down' : ''}`}>
      <span><strong>{p.name}</strong> <span className="muted">({p.position}, {p.team})</span></span>
      <span>{fmtM(p.price)}{prev != null && t !== 0 ? `, antes ${fmtM(prev)}` : ''}, {extra || fmtSigned(t)}</span>
    </div>
  );
}
