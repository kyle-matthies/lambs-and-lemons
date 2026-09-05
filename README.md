# Lammy's Lemonade Smash 🐑🍋🔨

### *The Sour Valley*

A 3D game **designed by a 6-year-old game director**: the valley has gone grey
and sour, and Lammy the lamb is going to fix it with a mallet and a lemonade
stand.

Live production URL: https://lambs-and-lemons.vercel.app

---

## The idea

Colour has drained out of the valley. Lemons are the last bright things left in
it, and every time Lammy smashes one, a burst of **zest** paints colour back
into the grass around her. Somewhere out in the grey there are twelve creatures
who have forgotten how to be cheerful, each marked by a soft beam of light. Brew
them a cup of lemonade, walk it over, and they bloom back into colour and fall
in behind you — and from then on they trail a little colour of their own
wherever they run.

Free everyone before the sun goes down and the whole valley wakes up at once.

The point of the design is that **the graphics are the mechanic**. The recovery
number that paints the grass is the same number that drives the sun's height and
warmth, the fog, the exposure, the sky, and which layers of the soundtrack are
playing. Playing well doesn't so much score points as change the weather.

## Three ways to play

### The Journey

Five untimed chapters lead from Home Meadow to Sunset Hollow. The chapter map
shows which places are awake and unlocks the next place when its objectives are
complete. The field guide follows your inventory: find lemons, make lemonade at
the stand, then take a cup to a friend. Its arrow routes around the ponds.

The journey checkpoints every five seconds, when paused, and when leaving a
chapter. Reloading restores Lammy, ingredients, trees, friends, and the colour
already restored. Saves stay on this browser/device; they are not cloud saves.
Completing a chapter clears its checkpoint so you can replay it from the map.

Pause with the top-left button or Escape. Switching apps pauses automatically.
The game offers recovery if browser graphics become unavailable.


### 🔨 Smash! (the valley)

Run the meadow with the joystick, whack lemon trees until they burst, smash
loose lemons into juice, brew cups at the stand, and carry them out to whoever is
waiting. One button does both jobs — it becomes **Give!** whenever someone is
close enough to hand a cup to.

- **Touch**: left thumb joystick + right thumb action button; hold Smash for repeated swings
- **Keyboard**: WASD / arrows to move, Space to smash or give, Escape to pause/resume

A 2-minute round is the sweet spot: winnable, but you'll be running.

### 🥤 My Stand (lemonade tycoon)

A gentle money game staged at Lammy's stand: animal customers walk up and order,
you serve them, take their coins, and count out change by tapping 1 / 5 / 10
coins — no typed numbers, no fail state, a glowing hint if you're stuck. Days get
gradually trickier (counting → change from 5 → change from 10 + double orders).
Spend the takings on decorations, which show up on the stand in **both** modes.

## Tech

- React 19 + TypeScript + Vite, **three.js** for rendering — no game engine
- **Everything is generated at runtime.** No models, no textures, no audio files.
  Terrain, grass, trees, animals, the stand and its decorations are all built
  from primitives at boot; every sound is synthesized with the Web Audio API.
- No backend: progress and validated journey checkpoints live in `localStorage`
- Mobile-first: multi-touch, safe areas, portrait and landscape layouts, home-screen manifest. Launching requires a network connection.

### How it's put together

```
src/core/     pure maths, seeded noise, RNG — no DOM, no three.js
src/game/     the simulation: world generation, physics, creatures, bloom
src/render/   three.js: scene assembly, shaders, characters, effects
src/audio/    synthesized SFX, adaptive score, ambience bed
src/ui/       React overlays
```

`src/game/*` never imports three.js and never touches the DOM. That separation is
why the whole game can be played headlessly in Node (`npm run sim`), and it's
what made replacing the renderer tractable in the first place.

A few pieces worth knowing about:

- **`src/render/valleyShading.ts`** injects a shared shading language into stock
  three materials via `onBeforeCompile`: the grey→colour bloom lookup,
  world-space wind driven by a per-vertex `aSway` weight, grass that flattens
  away from the player, and a sun-driven translucency term so backlit foliage
  glows its own colour — while keeping real PBR lighting and shadows.
- **`src/game/bloom.ts`** is the authoritative record of how much of the valley
  has its colour back. The renderer paints the same splats into a texture for the
  shaders to sample, but the number the HUD reports comes from here, so it stays
  deterministic and testable without a GPU.
- **Quality tiers** (`src/render/quality.ts`) are guessed from the device and
  then corrected: the renderer watches frame time and drops a tier if the guess
  was wrong.

## Local development

```bash
npm install
```

```bash
npm run dev
```

Handy URL parameters:

| Parameter | Effect |
| --- | --- |
| `?mode=arcade\|stand` | Open a mode directly |
| `&go=1` | Skip the round-setup card |
| `&heal=0..1` | Pin how far the valley has recovered — for looking at the art at both ends of the range |
| `&dusk=0..1` | Pin how far through the round the light is, so the sunset can be looked at without waiting for it |
| `&flock=N` | Start with N creatures already following, which is otherwise the hardest thing in the game to get a look at |
| `&over=woke\|sunset` | Open straight onto the round-over card |

## Checks

```bash
npm run lint && npm run build
```

```bash
npm run test:sim
```

Plays whole rounds of the real simulation headlessly with a bot at the controls,
then asserts the loop is completable and self-consistent across seeds. Runs in
about a second, no browser required. Drop the assertions (`npm run sim`) to just
print what happened — that's what the pacing was tuned against.

```bash
npm run test:e2e
```

Playwright gameplay tests, iPhone-sized, on headless Chromium with SwiftShader.

```bash
npm run test:reliability
npm run test:platform
```

Checkpoint round trips cover all five chapters. Platform checks cover iPhone-sized
Chromium, iPhone-sized WebKit, and desktop Chromium: pause, multitouch ownership,
chapter unlocks, corrupt saves, reload recovery, short viewports, and WebGL failure.
Install the browser engines first with `npx playwright install chromium webkit`.
PRs run these checks in GitHub Actions.

WebKit emulation is a compatibility check, not a physical iPhone certification.
Before calling a release phone-ready, play a full journey on an actual iPhone in
Safari and from the home screen, including rotation, screen lock, audio, and a
long session. Native App Store packaging and offline play are not implemented.

```bash
npm run shots
```

Screenshots the running game so you can actually look at it. Software
rasterising runs at a few frames a second, so it's for *looking* — not for
judging feel or performance.

## Deploy

This folder is linked to the Vercel project `kyle-matthies-projects/lambs-and-lemons`.

```bash
vercel deploy --prod --scope kyle-matthies-projects
```
