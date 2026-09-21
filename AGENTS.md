# AGENTS.md — repo conventions (Fantasy DAZN Manager)

Read this before changing anything in this repo. The user speaks Spanish;
answer in Spanish unless asked otherwise.

## Stack
Vite + React + Firestore. Deployed as a project site to GitHub Pages
(`https://albertollamass.github.io/fantasy`, base `/fantasy/` in
`vite.config.js`). No Firebase Hosting.

## Commands
Node is managed with nvm. Prefix every npm/node command with:
`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && ...`
- `npm run dev -- --host 127.0.0.1 --port 5173` (Vite proxy `/api-fantasy`
  forwards to the official API to dodge CORS in the browser)
- `npm run build` (must pass before committing)
- `npm run sync && node tools/snapshot.mjs` (refresh `public/market.json`)

## Branches and deploys
- Work on `develop`. Merge to `main` only to publish; `deploy.yml` deploys
  solely from `main`.
- `refresh-market.yml` regenerates `public/market.json` every Monday.
- Never commit `.env` (gitignored). Secrets live in GitHub Actions secrets.

## Commits (mandatory)
Every commit MUST use Conventional Commits, in English, lowercase subject,
imperative mood: `feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `refactor:`.
Example: `feat: add swap popup filtered by line`.

## Firestore free-tier budget
- Persist ONLY the squad (`players` with `inSquad=true`) plus
  `meta/current`, `meta/finance`, `meta/lineup`.
- The 800+ player market lives in memory + `localStorage` cache +
  `public/market.json` snapshot. Never bulk-write it to Firestore.

## Product rules (verified)
- Official API base is `https://fantasy-api.llt-services.com/api` and every
  call needs headers `x-app: 2`, `x-lang: es`.
- Debt limit is automatic: 20% of squad market value. Never ask the user
  for it; compute it. Negative balance means no points that matchday.
- Formations allowed: 5-4-1, 5-3-2, 4-5-1, 4-4-2, 4-3-3, 3-5-2, 3-4-3.

## UI language and identity
- UI copy in Spanish, sentence case, no emojis as icons.
- Visual identity "noche de partido": pine/green background, chalk text,
  amber accent only on the scoreboard; Barlow Condensed for display and
  figures, Barlow for body.
