# Lambs and Lemons

A mobile-first arcade game built with React, TypeScript, Vite, and canvas.

Live production URL: https://lambs-and-lemons.vercel.app

## Game Loop

- Pick a 1, 2, 3, 4, or 5 minute round.
- Drag the left joystick to move the lamb.
- Tap Smash to splat lemons or knock lemon trees.
- Pick up lemons and leaves for points.
- Break trees for 2 points and extra ingredient drops.
- Sell lemonade at the stand with 3 lemon parts and 1 leaf.

## Local Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run build
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
