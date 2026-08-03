/**
 * Headless playtest.
 *
 * Runs whole rounds of the real simulation at a fixed timestep with a simple bot
 * at the controls, and prints what happened. Because `src/game/*` is pure and
 * DOM-free, this needs no browser and no GPU — which makes it the only sane way
 * to tune pacing (how long a round takes, whether the flock is reachable, how far
 * the colour spreads) without eyeballing a 3 fps software rasteriser.
 *
 *   npm run sim            # a few rounds at each length
 *   npm run sim -- 3 5     # 5 rounds of 3 minutes
 *
 * The bot is deliberately mediocre: it beelines, never plans, and wastes swings.
 * If *it* can wake the valley in the time given, the round is too easy.
 */
import { createGame, drainEvents, serveCup, swingHammer, updateGame } from '../src/game/engine.ts'
import { nearestLostCritter } from '../src/game/critters.ts'
import { CUP_CAPACITY, LEMON_PARTS_PER_CUP, SELL_RADIUS } from '../src/game/constants.ts'

const STEP = 1 / 60

function distance(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz)
}

/** Drive toward a world point; returns the stick vector the engine expects. */
function steer(state, targetX, targetZ) {
  const dx = targetX - state.player.x
  const dz = targetZ - state.player.z
  const length = Math.hypot(dx, dz)
  if (length < 0.15) return { active: false, x: 0, y: 0 }
  return { active: true, x: dx / length, y: dz / length }
}

function nearestLemon(state) {
  let best = null
  let bestDistance = Infinity
  for (const lemon of state.lemons) {
    const d = distance(lemon.x, lemon.z, state.player.x, state.player.z)
    if (d < bestDistance) {
      bestDistance = d
      best = lemon
    }
  }
  return best
}

function playRound(minutes, seed) {
  const state = createGame(minutes, 'playing', seed)
  const counts = {}
  let swingCooldown = 0
  let freedAt = null

  while (state.phase === 'playing') {
    const player = state.player
    const parts = state.inventory.lemons + state.inventory.juice
    const lost = nearestLostCritter(state)

    let input
    if (state.inventory.cups > 0 && lost) {
      // Deliver.
      input = steer(state, lost.x, lost.z)
      if (distance(player.x, player.z, lost.x, lost.z) < 1.8) serveCup(state)
    } else if (parts >= LEMON_PARTS_PER_CUP && state.inventory.cups < CUP_CAPACITY) {
      // Go brew.
      input = steer(state, state.stand.x, state.stand.z)
      if (distance(player.x, player.z, state.stand.x, state.stand.z) < SELL_RADIUS * 0.6) {
        input = { active: false, x: 0, y: 0 }
      }
    } else {
      // Gather. Walk at the nearest lemon and swing on the way in.
      const lemon = nearestLemon(state)
      if (lemon) {
        input = steer(state, lemon.x, lemon.z)
        if (swingCooldown <= 0 && distance(player.x, player.z, lemon.x, lemon.z) < 2.4) {
          swingHammer(state)
          swingCooldown = 0.5
        }
      } else {
        input = { active: false, x: 0, y: 0 }
      }
    }

    swingCooldown -= STEP
    updateGame(state, input, STEP)

    for (const event of drainEvents(state)) {
      counts[event.type] = (counts[event.type] ?? 0) + 1
    }
    if (freedAt === null && state.stats.crittersFreed === state.critters.length) {
      freedAt = minutes * 60 - state.timeLeft
    }
  }

  return { state, counts, freedAt }
}

const args = process.argv.slice(2)
const assertMode = args.includes('--assert')
const numbers = args.filter((arg) => !arg.startsWith('--')).map(Number)
const lengths = Number.isFinite(numbers[0]) ? [numbers[0]] : [1, 2, 3]
const rounds = Number.isFinite(numbers[1]) ? numbers[1] : 3

const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

for (const minutes of lengths) {
  console.log(`\n=== ${minutes} minute round ===`)
  for (let index = 0; index < rounds; index += 1) {
    const seed = 20260802 + index * 7919
    const { state, counts, freedAt } = playRound(minutes, seed)
    const pct = (value) => `${Math.round(value * 100)}%`
    console.log(
      [
        `seed ${seed}`,
        `outcome=${state.outcome}`,
        `friends=${state.stats.crittersFreed}/${state.critters.length}`,
        freedAt === null ? 'freedAt=—' : `freedAt=${freedAt.toFixed(1)}s`,
        `bloom=${pct(state.bloomCoverage)}`,
        `score=${state.inventory.score}`,
        `smashed=${state.stats.lemonsSmashed}`,
        `brewed=${counts.cupBrewed ?? 0}`,
      ].join('  '),
    )

    if (!assertMode) continue

    // Correctness, not taste: the loop must be completable and self-consistent.
    check(state.phase === 'ended', `${minutes}min/${seed}: round never ended`)
    check(state.stats.crittersFreed > 0, `${minutes}min/${seed}: nobody was served`)
    check(
      state.inventory.cups >= 0 && state.inventory.sparkleCups >= 0,
      `${minutes}min/${seed}: cup counts went negative`,
    )
    check(
      state.stats.crittersFreed <= state.critters.length,
      `${minutes}min/${seed}: served more creatures than exist`,
    )
    if (state.outcome === 'valleyWoke') {
      check(
        state.stats.crittersFreed === state.critters.length,
        `${minutes}min/${seed}: valley woke with creatures still lost`,
      )
      check(state.bloomCoverage > 0.999, `${minutes}min/${seed}: valley woke but colour < 100%`)
    }
    if (minutes >= 3) {
      check(
        state.outcome === 'valleyWoke',
        `${minutes}min/${seed}: a ${minutes}-minute round should be winnable`,
      )
    }
  }
}

if (assertMode) {
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('\nAll simulation checks passed.')
}
