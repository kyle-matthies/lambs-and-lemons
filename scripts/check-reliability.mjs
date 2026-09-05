import assert from 'node:assert/strict'
import { createGame, updateGame, serveCup, swingHammer, drainEvents } from '../src/game/engine.ts'
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
  for (let elapsed = 0; elapsed < 900 && game.phase === 'playing'; elapsed += 1 / 30) {
    const guidance = getGuidance(game)
    const angle = (guidance.angle ?? 0) * Math.PI / 180
    if (!serveCup(game)) swingHammer(game)
    updateGame(game, { active: guidance.angle !== null && guidance.distance > 0, x: Math.sin(angle), y: -Math.cos(angle) }, 1 / 30)
    drainEvents(game)
  }
  assert.equal(game.phase, 'ended', `The field guide must lead through ${chapter.id}`)
}
console.log('Following the field guide completes all five chapters, including pond navigation.')
