# Fantasy DAZN Manager

**English (default)** | **[Español](README.es.md)**

*(Este fichero es la versión en español. La versión en inglés es la de por defecto: [README.md](README.md).)*

App personal (Vite + React + Firestore + GitHub Pages + GitHub Actions) para gestionar tu equipo de la liga fantasy de DAZN.

## Qué hace
- **Mi equipo:** alineación visual sobre el campo (1 portero + 7 dibujos: 5-4-1, 5-3-2, 4-5-1, 4-4-2, 4-3-3, 3-5-2, 3-4-3). Toca un titular para cambiarlo por un banquillo de su misma línea en un popup. Los huecos vacíos salen en rojo. El banquillo muestra puntos y precio por jugador.
- **Por posición:** ticker de mercado con buscador, filtros POR/DEF/MED/DEL y orden por precio, puntos, puntos por millón o tendencia. Paginado (48 por página).
- **Análisis de subidas y bajadas:** los que más suben, los que más bajan y chollos (puntos por millón), cada uno con precio anterior y diferencia.
- **Caja:** dinero en caja, endeudamiento automático (20% del valor del equipo, según el reglamento oficial), patrimonio y poder de compra. Avisa si entras en negativo (sin puntos esa jornada).
- **Copiar para IA:** un botón exporta todo el equipo como texto para ChatGPT/Claude/Gemini.
- **Sincronizar (API):** trae precios y puntos de la API oficial `fantasy-api.llt-services.com` (endpoints públicos, sin login). En local pasa por el proxy de Vite (`/api-fantasy`) para evitar CORS; en GitHub Pages la app usa la foto `public/market.json`.

## Base de datos: qué crear en Firebase
1. Ve a https://console.firebase.google.com → **Create project** (sin Analytics).
2. **Build → Firestore Database → Create database** → modo producción + región `europe-west`.
3. No hace falta crear colecciones a mano: la app las crea. Esquema (solo se guarda tu equipo, para no gastar el plan gratuito):
   - `players/{id}`: solo jugadores con `inSquad=true`
   - `meta/current`: jornada actual
   - `meta/finance`: dinero en caja
   - `meta/lineup`: dibujo elegido
4. Pega `firestore.rules` en Firestore → Reglas y publica.
5. **Project settings → General → Your apps → Web** → copia la config a tu `.env` (usa `.env.example`).

El mercado completo (800+ jugadores) vive en memoria + caché del navegador, nunca en Firestore: cada sync cuesta ~1 lectura + ~15-25 escrituras.

## Endpoints oficiales usados
- `GET /api/v1/competition/1/players` → 800+ jugadores con precio, puntos, estado. Público.
- `GET /api/v1/competition/1/player/{id}/market-value` → historial diario de valor. Público.
- `GET /api/v1/competition/1/week/current` → jornada actual. Público.
- Los endpoints privados de tu liga (`/leagues/{id}/...`) piden el token de la app y no se usan.

Todas las llamadas llevan las cabeceras de la app oficial (`x-app: 2`, `x-lang: es`).

## Desarrollo
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm install
npm run dev   # http://127.0.0.1:5173/
npm run sync && node tools/snapshot.mjs  # refresca public/market.json
```

## CI/CD: GitHub Actions → GitHub Pages
La web vive en `https://albertollamass.github.io/fantasy` (base `/fantasy/` en `vite.config.js`).
- `deploy.yml`: solo despliega con push o merge a `main`. Se trabaja en `develop` y al fusionar a `main` sale a Pages. Antes, activa en GitHub → Settings → Pages → Source: **GitHub Actions**.
- Secrets (Settings → Secrets → Actions) con tu config de Firebase para que la web use Firestore; sin ellos compila igual en modo local:
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `refresh-market.yml`: cada lunes regenera `public/market.json` y al hacer push redespliega solo.

## Licencia
MIT — ver [LICENSE](LICENSE). Si copias o bifurcas este repo debes conservar el aviso de copyright.
