import type { GameState } from './types'
import { isWalkable } from './world'
import { LEMON_PARTS_PER_CUP } from './constants'

export interface Guidance {
  icon: string
  title: string
  detail: string
  angle: number | null
  distance: number
}

/** A single useful next step, derived from the same inventory as the simulation. */
export function getGuidance(state: GameState): Guidance {
  const nearest = <T extends { x: number; z: number }>(items: T[]) =>
    items.reduce<T | undefined>(
      (best, item) =>
        !best ||
        Math.hypot(item.x - state.player.x, item.z - state.player.z) <
          Math.hypot(best.x - state.player.x, best.z - state.player.z)
          ? item
          : best,
      undefined,
    )
  let target: { x: number; z: number } | undefined
  let icon = '🍋',
    title = 'Find a lemon',
    detail = 'Move close, then smash!'
  const lost = state.critters.filter((c) => c.state === 'lost')
  const hasIngredients =
    state.inventory.lemons + state.inventory.juice >= LEMON_PARTS_PER_CUP
  if (lost.length > 0 && state.inventory.cups > 0) {
    target = nearest(lost)
    icon = '💛'
    title = 'Bring a friend some lemonade'
    detail = 'Follow the arrow. Tap Give when you’re close.'
  } else if (lost.length > 0 && hasIngredients) {
    target = state.stand
    icon = '🥤'
    title = 'Back to the lemonade stand'
    detail = 'Stand beside it to fill your cups.'
    if (Math.hypot(target.x - state.player.x, target.z - state.player.z) < 3) {
      title = 'Making lemonade…'
      detail = 'Stay here a moment. Lammy does the mixing.'
    }
  } else if (
    lost.length === 0 &&
    state.objectives.some(
      (o) => o.kind === 'breakTrees' && state.stats.treesBroken < o.count,
    )
  ) {
    target = nearest(state.trees.filter((t) => t.stage === 'full'))
    icon = '🌳'
    title = 'A few trees still need a shake'
    detail = 'Hold Smash beside a tree to keep swinging.'
  } else {
    target = nearest(state.lemons)
    if (!target) target = nearest(state.trees.filter((t) => t.stage === 'full'))
    if (lost.length === 0) {
      title = 'Spread a little more colour'
      detail = 'Smash lemons around the grey patches.'
    }
  }
  const pond = state.world.pond
  if (pond && target) {
    const dx = target.x - state.player.x,
      dz = target.z - state.player.z
    const lengthSquared = dx * dx + dz * dz
    const fraction = Math.max(
      0,
      Math.min(
        1,
        ((pond.x - state.player.x) * dx + (pond.z - state.player.z) * dz) /
          Math.max(0.01, lengthSquared),
      ),
    )
    const clearance = pond.radius * 0.82 + 1
    const crossesWater =
      Math.hypot(
        state.player.x + dx * fraction - pond.x,
        state.player.z + dz * fraction - pond.z,
      ) < clearance
    if (crossesWater) {
      const from = Math.atan2(state.player.z - pond.z, state.player.x - pond.x)
      const to = Math.atan2(target.z - pond.z, target.x - pond.x)
      const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from))
      const angle = from + Math.sign(turn || 1) * 0.4
      const waypoint = {
        x: pond.x + Math.cos(angle) * (clearance + 1.5),
        z: pond.z + Math.sin(angle) * (clearance + 1.5),
      }
      if (isWalkable(state.world, waypoint.x, waypoint.z, 0.5)) {
        target = waypoint
        detail = 'Around the water. The arrow shows the way.'
      }
    }
  }
  const dx = (target?.x ?? state.player.x) - state.player.x
  const dz = (target?.z ?? state.player.z) - state.player.z
  return {
    icon,
    title,
    detail,
    angle: target ? (Math.atan2(dx, -dz) * 180) / Math.PI : null,
    distance: Math.round(Math.hypot(dx, dz)),
  }
}
