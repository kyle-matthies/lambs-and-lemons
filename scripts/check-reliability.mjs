import assert from 'node:assert/strict'
import {
  createGame,
  updateGame,
  serveCup,
  swingHammer,
  drainEvents,
} from '../src/game/engine.ts'
import { CHAPTERS } from '../src/game/campaign.ts'
import { saveCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts'
import { getGuidance } from '../src/game/guidance.ts'
const saved = new Map()
globalThis.localStorage = {
  getItem: (k) => saved.get(k) ?? null,
  setItem: (k, v) => saved.set(k, v),
  removeItem: (k) => saved.delete(k),
}
for (const chapter of CHAPTERS) {
  const state = createGame(2, 'playing', chapter.seed, chapter)
  state.inventory.cups = 1
  const friend = state.critters[0]
  state.player.x = friend.x
  state.player.z = friend.z
  assert.ok(serveCup(state))
  for (let i = 0; i < 90; i++)
    updateGame(state, { active: false, x: 0, y: 0 }, 1 / 60)
  assert.equal(saveCheckpoint(state), true)
  const restored = createGame(2, 'playing', chapter.seed, chapter)
  assert.equal(restoreCheckpoint(restored), true, chapter.id)
  assert.deepEqual(restored.inventory, state.inventory)
  assert.deepEqual(restored.stats, state.stats)
  assert.deepEqual(restored.critters, state.critters)
  assert.deepEqual(restored.bloomField.cells, state.bloomField.cells)
  assert.equal(restored.player.x, state.player.x)
  assert.equal(restored.player.vx, 0)
  const guide = getGuidance(restored)
  assert.ok(guide.title.length > 0)
  assert.ok(Number.isFinite(guide.distance))
}
const state = createGame(2, 'playing', 10, CHAPTERS[0])
const k = 'lammy-checkpoint-v1:home-meadow'
for (const bad of [
  'null',
  '{}',
  '{',
  JSON.stringify({ version: 1, live: { phase: 'playing' }, cells: [] }),
]) {
  saved.set(k, bad)
  assert.equal(restoreCheckpoint(state), false)
}
saveCheckpoint(state)
const corrupt = JSON.parse(saved.get(k))
corrupt.cells[0] = -1
saved.set(k, JSON.stringify(corrupt))
assert.equal(restoreCheckpoint(state), false)
state.phase = 'ended'
saveCheckpoint(state)
assert.equal(saved.has(k), false)
globalThis.localStorage.setItem = () => {
  throw new Error('Quota exceeded')
}
state.phase = 'playing'
assert.equal(saveCheckpoint(state), false)
console.log(
  'All five chapters round-trip friends, inventory, world colour, and position. Corrupt saves, completion cleanup, and unavailable storage passed.',
)

// Follow only the field guide, with no map knowledge, through every chapter.
for (const chapter of CHAPTERS) {
  const game = createGame(2, 'playing', chapter.seed, chapter)
  for (
    let elapsed = 0;
    elapsed < 900 && game.phase === 'playing';
    elapsed += 1 / 30
  ) {
    const guidance = getGuidance(game)
    const angle = ((guidance.angle ?? 0) * Math.PI) / 180
    if (!serveCup(game)) swingHammer(game)
    updateGame(
      game,
      {
        active: guidance.angle !== null && guidance.distance > 0,
        x: Math.sin(angle),
        y: -Math.cos(angle),
      },
      1 / 30,
    )
    drainEvents(game)
  }
  assert.equal(
    game.phase,
    'ended',
    `The field guide must lead through ${chapter.id}`,
  )
}
console.log(
  'Following the field guide completes all five chapters, including pond navigation.',
)

// A restored place remains playable across reloads and never awards completion twice.
const { finishRound, stayInChapter } = await import('../src/game/engine.ts')
globalThis.localStorage.setItem = (k, v) => saved.set(k, v)
for (const chapter of CHAPTERS) {
  const place = createGame(2, 'playing', chapter.seed, chapter)
  finishRound(place, 'valleyWoke')
  const score = place.inventory.score
  assert.equal(saveCheckpoint(place), true)
  const visit = createGame(2, 'playing', chapter.seed, chapter)
  assert.equal(restoreCheckpoint(visit), true)
  assert.equal(visit.phase, 'playing')
  assert.equal(visit.outcome, 'valleyWoke')
  assert.equal(stayInChapter(place), true)
  visit.lemons = []
  visit.leaves = []
  visit.lemonSpawnTimer = visit.leafSpawnTimer = 60
  const before = visit.player.x
  for (let frame = 0; frame < 60; frame++)
    updateGame(visit, { active: true, x: 1, y: 0 }, 1 / 60)
  assert.equal(visit.phase, 'playing')
  assert.ok(visit.player.x > before)
  assert.equal(
    visit.inventory.score,
    score,
    'Returning must not farm completion rewards',
  )
  assert.ok(visit.bloomCoverage > 0.99)
}
const arcade = createGame(2, 'playing')
assert.equal(stayInChapter(arcade), false)
// Same deliberate swings: harvest an adventure tree, fell an arcade tree.
for (const chapter of [CHAPTERS[2], undefined]) {
  const game = createGame(2, 'playing', 10, chapter)
  const tree = game.trees[0]
  game.player.x = tree.x
  game.player.z = tree.z - 1
  game.player.facing = 0
  for (let hit = 0; hit < 8; hit++) {
    swingHammer(game)
    for (let frame = 0; frame < 50; frame++)
      updateGame(game, { active: false, x: 0, y: 0 }, 1 / 60)
  }
  if (chapter) {
    assert.equal(tree.stage, 'full')
    assert.equal(game.stats.treesBroken, 0)
    assert.ok(game.stats.treeHits > 0)
  } else assert.ok(game.stats.treesBroken > 0)
}
const { RESIDENTS, residentFor } = await import('../src/game/residents.ts')
const { readJournal, rememberResident } = await import('../src/lib/journal.ts')
assert.equal(new Set(RESIDENTS.map((r) => r.id)).size, 35)
for (const chapter of CHAPTERS) {
  for (const critter of createGame(2, 'playing', chapter.seed, chapter)
    .critters)
    assert.equal(residentFor(chapter.id, critter.id).kind, critter.kind)
}
assert.equal(rememberResident('unknown', true), false)
assert.equal(rememberResident(RESIDENTS[0].id, false), true)
assert.deepEqual(readJournal().met, [RESIDENTS[0].id])
assert.deepEqual(readJournal().shared, [])
rememberResident(RESIDENTS[0].id, true)
rememberResident(RESIDENTS[0].id, true)
assert.deepEqual(readJournal().shared, [RESIDENTS[0].id])
saved.set('lammy-neighbours-v1', '{"met":{},"shared":["not-a-neighbour"]}')
assert.deepEqual(readJournal(), { met: [], shared: [] })
globalThis.localStorage.setItem = () => {
  throw new Error('Quota exceeded')
}
assert.equal(rememberResident(RESIDENTS[1].id, true), false)
console.log(
  'Restored visits, one-time completion, gentle harvesting, 35 stable residents, and journal validation passed.',
)

// Adventure can be completed by walking, gathering, and sharing alone.
for (const chapter of CHAPTERS) {
  const game = createGame(2, 'playing', chapter.seed, chapter)
  for (
    let elapsed = 0;
    elapsed < 900 && game.phase === 'playing';
    elapsed += 1 / 30
  ) {
    const guide = getGuidance(game)
    const angle = ((guide.angle ?? 0) * Math.PI) / 180
    serveCup(game)
    updateGame(
      game,
      {
        active: guide.angle !== null && guide.distance > 0,
        x: Math.sin(angle),
        y: -Math.cos(angle),
      },
      1 / 30,
    )
    drainEvents(game)
  }
  assert.equal(
    game.phase,
    'ended',
    `Gathering without smashing must complete ${chapter.id}`,
  )
  assert.equal(game.stats.lemonsSmashed, 0)
  assert.equal(game.stats.treesBroken, 0)
}
console.log('All five adventures also complete without a single mallet swing.')
