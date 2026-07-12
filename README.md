# Lammy's Lemonade Smash 🐑🍋🔨

A quirky mobile web game **designed by a 6-year-old game director**: Lammy the
lamb whacks lemon trees with a mallet, smashes lemons, and sells lemonade.

Live production URL: https://lambs-and-lemons.vercel.app

## Two ways to play

### 🔨 Smash! (arcade)
Run around the meadow with the joystick, whack trees (they burst lemons and
grow back!), smash loose lemons into juice, and stand by the stand to brew
cups automatically. Adding a leaf makes a double-value **sparkle cup** ✨.
Chain hits for combos. Most cups sold wins the leaderboard.

- **Touch**: left thumb joystick + right thumb SMASH button
- **Keyboard**: WASD / arrows to move, Space to smash

### 🥤 My Stand (lemonade tycoon)
A gentle money game: animal customers order cups, you serve them, take their
coins, and count out change by tapping 1 / 5 / 10 coins — no typed numbers,
no fail state, a glowing hint if you're stuck. Days get gradually trickier
(counting → change from 5 → change from 10 + double orders). Spend your
earnings on stand decorations that show up in both modes!

## Tech

- React 19 + TypeScript + Vite, Canvas 2D rendering — no game engine
- All sound effects synthesized live with the Web Audio API — no audio files
- No backend: progress lives in `localStorage`
- Mobile-first: multi-touch, safe areas, landscape support, installable
  (web app manifest)

Game logic lives in pure, framework-free modules (`src/game/engine.ts`,
`src/game/tycoon/tycoonEngine.ts`) with React hosts on top; gameplay events
flow through an outbox that drives sound and particle effects.

## Local Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run build
npm run test:e2e   # Playwright smoke tests (iPhone-sized, Chromium)
```

## Deploy

This folder is linked to the Vercel project `kyle-matthies-projects/lambs-and-lemons`.

```bash
vercel deploy --prod --scope kyle-matthies-projects
```

GitHub Actions also deploys production from pushes to `main`. The workflow expects these repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
