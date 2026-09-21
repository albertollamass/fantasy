# Fantasy DAZN Manager

App personal (Vite + React + Firestore + GitHub Pages + GitHub Actions) para gestionar tu equipo de la liga fantasy de DAZN.

## Qué hace (v1)
- **Mi equipo (captura):** titulares + banquillo en la misma pestaña, agrupados por posición como en la app (POR/DEF/MED/DEL). Fondo claro para captura limpia + botón **Copiar equipo para IA** (genera texto listo para ChatGPT/Claude/Gemini).
- **Por posición:** buscador + filtros + orden por precio / puntos / pts por millón / tendencia.
- **Análisis:** subidas, bajadas y chollos (puntos por millón). El histórico de precio se guarda solo en cada jugador (últimos 60 cambios).
- **Añadir manual:** jugadores y precios a mano.
- **Sincronizar (API):** botón que trae precios + puntos desde la API oficial `fantasy-api.llt-services.com` (endpoints públicos, sin login). Si el navegador bloquea CORS: `npm run sync` e importa el JSON.

## Base de datos: qué crear en Firebase
1. Ve a https://console.firebase.google.com → **Create project** (sin Analytics, da igual).
2. **Build → Firestore Database → Create database** → modo producción + región `europe-west` (Madrid).
3. No hace falta crear colecciones a mano: la app crea `players` y `meta` solas. Esquema:
   - `players/{id}`: `name, team, position(POR|DEF|MED|DEL), price, pointsTotal, pointsLastWeek, externalId(id API oficial), inSquad(bool), isStarter(bool), priceHistory[{date,price,source}], weeklyPoints[{week,points}], updatedAt`
   - `meta/current`: `currentWeek, updatedAt`
4. **Build → Hosting → Get started** (instala `npm i -g firebase-tools` y `firebase login` una vez).
5. **Project settings → General → Your apps → Web (`</>`)** → copia la config a tu `.env` (usa `.env.example`).

Solo la usas tú: `firestore.rules` está abierto (sin login, como pediste). Cuando quieras lo cerramos con Auth.

## API: ¿se puede automatizar puntos y precios?
Sí, a medias (verificado):
- **Oficial LaLiga Fantasy** `fantasy-api.llt-services.com` (la que usa la app DAZN):
  - `GET /v1/competition/1/players` → 700+ jugadores con precio, puntos, estado. PÚBLICO.
  - `GET /v1/competition/1/player/{id}/market-value` → historial diario de valor. PÚBLICO.
  - `GET /v1/competition/1/week/current` + `/calendar?weekNumber=N` → jornada. PÚBLICO.
  - Lo de TU LIGA privada (`/leagues/{id}/...`) pide token de la app (login Azure B2C 24h). No lo usamos en v1.
- **Alternativas gratis:** scraping `futbolfantasy.com`, `analiticafantasy.com`, `guiafantasy.com` (subidas/bajadas del día, % titularidad). De pago: API-Football, Statorium.
- Estrategia v1: **híbrido** = botón sync API oficial (precios+puntos) + edición manual (lo que la API no dé). El historial permite ver subidas/bajadas y pts/M para decidir quién merece la pena.

## Desarrollo
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm install
npm run dev
```

## CI/CD GitHub Actions → GitHub Pages
La web vive en `https://albertollamass.github.io/fantasy` (base `/fantasy/` en `vite.config.js`).
- Workflow `deploy.yml`: push a `master` (o manual) → build → Pages. Antes, activa en GitHub → Settings → Pages → Source: **GitHub Actions**.
- Secrets (Settings → Secrets → Actions) con tu config de Firebase para que la web use Firestore; sin ellos compila igual en modo local:
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- Workflow `refresh-market.yml`: cada lunes regenera `public/market.json` (foto del mercado para Pages, donde el navegador no puede llamar a la API por CORS) y al hacer push redespliega solo.

Sin Firebase configurado la app funciona en **modo local** (localStorage), así que puedes probarla ya.
