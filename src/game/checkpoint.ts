import type { GameState } from './types'

const key = (chapter: string) => `lammy-checkpoint-v1:${chapter}`
function liveState(state: GameState) {
  const {
    world: _world,
    layout: _layout,
    events: _events,
    bloomField: _bloom,
    objectives: _objectives,
    ...live
  } = state
  return live
}

/** Checkpoints contain simulation data only. Worlds and GPU objects are rebuilt. */
export function saveCheckpoint(state: GameState): boolean {
  if (!state.chapterId) return false
  try {
    if (state.phase === 'ended') {
      localStorage.removeItem(key(state.chapterId))
    } else if (state.phase === 'playing') {
      localStorage.setItem(
        key(state.chapterId),
        JSON.stringify({
          version: 1,
          seed: state.world.seed,
          live: liveState(state),
          cells: Array.from(state.bloomField.cells),
        }),
      )
    }
    return true
  } catch {
    return false
  }
}

// Validate against a freshly generated chapter rather than trusting parsed JSON.
// A damaged or incompatible save is ignored as a whole, never partially applied.
function matchesShape(value: unknown, sample: unknown): boolean {
  if (typeof sample === 'number')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) < 1e7
    )
  if (sample === null) return value === null
  if (typeof sample !== 'object') return typeof value === typeof sample
  if (Array.isArray(sample))
    return (
      Array.isArray(value) &&
      value.length <= 512 &&
      (sample.length === 0
        ? value.length === 0
        : value.every((item) => matchesShape(item, sample[0])))
    )
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>,
    b = sample as Record<string, unknown>
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(([k, v]) => matchesShape(a[k], v))
  )
}

export function restoreCheckpoint(state: GameState): boolean {
  if (!state.chapterId) return false
  try {
    const raw = localStorage.getItem(key(state.chapterId))
    if (!raw || raw.length > 1_000_000) return false
    const saved = JSON.parse(raw)
    if (
      saved?.version !== 1 ||
      saved.seed !== state.world.seed ||
      !matchesShape(saved.live, liveState(state))
    )
      return false
    const live = saved.live as ReturnType<typeof liveState>
    if (
      live.chapterId !== state.chapterId ||
      live.mode !== 'story' ||
      live.phase !== 'playing' ||
      live.outcome !== null
    )
      return false
    if (
      live.trees.length !== state.trees.length ||
      live.critters.length !== state.critters.length
    )
      return false
    if (
      live.trees.some(
        (t, i) =>
          t.id !== state.trees[i].id || !['full', 'broken'].includes(t.stage),
      )
    )
      return false
    if (
      live.critters.some(
        (c, i) =>
          c.id !== state.critters[i].id ||
          c.kind !== state.critters[i].kind ||
          !['lost', 'blooming', 'follower'].includes(c.state),
      )
    )
      return false
    if (
      Object.values(live.inventory).some(
        (n) => !Number.isInteger(n) || n < 0,
      ) ||
      live.inventory.cups > 3
    )
      return false
    if (
      !Array.isArray(saved.cells) ||
      saved.cells.length !== state.bloomField.cells.length ||
      !saved.cells.every(
        (n: unknown) =>
          typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
      )
    )
      return false
    Object.assign(state, live)
    state.bloomField.cells.set(saved.cells)
    state.bloomField.dirty = true
    state.player.vx = 0
    state.player.vz = 0
    state.player.speed = 0
    return true
  } catch {
    return false
  }
}
