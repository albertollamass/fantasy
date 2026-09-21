# Fantasy DAZN Manager

**[Español](README.es.md)** | English (default)

Personal app (Vite + React + Firestore + GitHub Pages + GitHub Actions) to manage a DAZN fantasy league team.

## What it does
- **My team:** visual lineup picker on a pitch (1 keeper + 7 drawings: 5-4-1, 5-3-2, 4-5-1, 4-4-2, 4-3-3, 3-5-2, 3-4-3). Tap a starter to swap with a benched player from the same line in a popup. Missing slots show in red. Bench lists points and price per player.
- **By position:** transfer ticker with search, POR/DEF/MED/DEL filters and sorting by price, points, points per million or price trend. Paginated (48 per page).
- **Rises and falls analysis:** top risers, top fallers and best value (points per million), each showing previous price and difference.
- **Money box:** cash balance, auto debt limit (20% of squad value, per the official rules), net worth and buying power. Warns when the balance goes negative (no points that matchday).
- **Copy for AI:** one button exports the whole squad as text for ChatGPT/Claude/Gemini.
- **Sync (API):** pulls prices and points from the official `fantasy-api.llt-services.com` API (public endpoints, no login). In local dev it goes through a Vite proxy (`/api-fantasy`) to avoid CORS; on GitHub Pages the app falls back to the bundled `public/market.json` snapshot.

## Database: what to create in Firebase
1. Go to https://console.firebase.google.com → **Create project** (Analytics not needed).
2. **Build → Firestore Database → Create database** → production mode + `europe-west` region.
3. No need to create collections by hand: the app creates them. Schema (only your squad is stored, to stay on the free tier):
   - `players/{id}`: squad players only (`inSquad=true`)
   - `meta/current`: current matchday
   - `meta/finance`: cash balance
   - `meta/lineup`: selected drawing
4. Paste `firestore.rules` into Firestore → Rules and Publish.
5. **Project settings → General → Your apps → Web** → copy the config into your `.env` (see `.env.example`).

The full 800+ player market lives in memory + browser cache, never in Firestore: each sync costs ~1 read + ~15-25 writes.

## Official API endpoints used
- `GET /api/v1/competition/1/players` → 800+ players with price, points, status. Public.
- `GET /api/v1/competition/1/player/{id}/market-value` → daily value history. Public.
- `GET /api/v1/competition/1/week/current` → current matchday. Public.
- Private league endpoints (`/leagues/{id}/...`) need the app token and are not used.

All calls send the official app headers (`x-app: 2`, `x-lang: es`).

## Development
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm install
npm run dev   # http://127.0.0.1:5173/
npm run sync && node tools/snapshot.mjs  # refresh public/market.json
```

## CI/CD: GitHub Actions → GitHub Pages
Live at `https://albertollamass.github.io/fantasy` (base `/fantasy/` in `vite.config.js`).
- `deploy.yml`: only deploys on push or merge to `main`. Work happens on `develop`; merging to `main` publishes. First enable Settings → Pages → Source: **GitHub Actions**.
- Secrets (Settings → Secrets → Actions) with the Firebase web config so the site uses Firestore; without them it still builds and runs in local mode:
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `refresh-market.yml`: every Monday it regenerates `public/market.json` and pushing it redeploys automatically.

## License
MIT — see [LICENSE](LICENSE). If you copy or fork this repo you must keep the copyright notice.
