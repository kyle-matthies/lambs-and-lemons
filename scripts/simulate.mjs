/**
 * Headless playtest.
 *
 * Runs whole rounds of the real simulation at a fixed timestep with a simple bot
 * at the controls, and prints what happened. Because `src/game/*` is pure and
 * DOM-free, this needs no browser and no GPU — which makes it the only sane way
 * to tune pacing (how long a round takes, whether the flock is reachable, how far
 * the colour spreads) without eyeballing a 3 fps software rasteriser.
 *
 *   npm run sim              # a few rounds at each length
 *   npm run sim -- 3 5       # 5 rounds of 3 minutes
 *   npm run sim -- --campaign  # play every story chapter
 *
 * The bot is deliberately mediocre: it beelines, never plans, and wastes swings.
 * If *it* can wake the valley in the time given, the round is too easy.
 *
 * Note that only world *generation* is seeded — critter wandering and the burst
 * directions off a smashed lemon read `Math.random` at runtime, so two runs of
 * the same seed differ. Assertions here therefore test properties (does it
 * finish, do the objectives resolve, do the counters stay sane) rather than
 * exact numbers. `scripts/worldhash.mjs` is what pins generation down.
 */
import { createGame, drainEvents, serveCup, swingHammer, updateGame } from '../src/game/engine.ts'
import { nearestLostCritter } from '../src/game/critters.ts'
import { evaluateObjectives } from '../src/game/objectives.ts'
import { CHAPTERS } from '../src/game/campaign.ts'
import { CUP_CAPACITY, LEMON_PARTS_PER_CUP, SELL_RADIUS } from '../src/game/constants.ts'

const STEP = 1 / 60
/** A chapter has no clock, so the bot needs its own stop before it loops forever. */
const CHAPTER_TIME_LIMIT = 15 * 60

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

function nearestTree(state) {
  let best = null
  let bestDistance = Infinity
  for (const tree of state.trees) {
    if (tree.stage !== 'full') continue
    const d = distance(tree.x, tree.z, state.player.x, state.player.z)
    if (d < bestDistance) {
      bestDistance = d
      best = tree
    }
  }
  return best
}

/** True while the chapter still wants trees brought down. */
function wantsTrees(state) {
  if (state.objectives.length === 0) return false
  return evaluateObjectives(state).some(
    (line, index) => state.objectives[index].kind === 'breakTrees' && !line.done,
  )
}

/**
 * One round, arcade or story. `chapter` switches it: a chapter has no clock, so
 * it runs until the objectives resolve or the bot's own patience runs out.
 */
function playRound(minutes, seed, chapter) {
  const state = createGame(minutes, 'playing', seed, chapter)
  const counts = {}
  let swingCooldown = 0
  let freedAt = null

  while (state.phase === 'playing' && state.elapsed < CHAPTER_TIME_LIMIT) {
    const player = state.player
    const parts = state.inventory.lemons + state.inventory.juice
    const lost = nearestLostCritter(state)
    const tree = wantsTrees(state) ? nearestTree(state) : null

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
    } else if (tree) {
      // The orchard chapter asks for trees, and whacking one drops fruit anyway,
      // so this doubles as gathering.
      input = steer(state, tree.x, tree.z)
      if (swingCooldown <= 0 && distance(player.x, player.z, tree.x, tree.z) < 2.4) {
        swingHammer(state)
        swingCooldown = 0.5
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
      freedAt = chapter ? state.elapsed : minutes * 60 - state.timeLeft
    }
  }

  return { state, counts, freedAt }
}

const args = process.argv.slice(2)
const assertMode = args.includes('--assert')
const campaignOnly = args.includes('--campaign')
const numbers = args.filter((arg) => !arg.startsWith('--')).map(Number)
const lengths = Number.isFinite(numbers[0]) ? [numbers[0]] : [1, 2, 3]
const rounds = Number.isFinite(numbers[1]) ? numbers[1] : 3
// `--assert` is the full guard and covers both modes; `--campaign` is for
// iterating on chapter tuning without waiting for the arcade rounds.
const runArcade = !campaignOnly
const runCampaign = campaignOnly || assertMode

const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

for (const minutes of runArcade ? lengths : []) {
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

if (runCampaign) {
  console.log('\n=== the journey ===')
  const attempts = campaignOnly ? rounds : 2

  for (const chapter of CHAPTERS) {
    const times = []
    for (let index = 0; index < attempts; index += 1) {
      const { state, freedAt } = playRound(2, 20260802 + index * 7919, chapter)
      const lines = evaluateObjectives(state)
      const done = lines.filter((line) => line.done).length
      times.push(state.elapsed)

      console.log(
        [
          chapter.id.padEnd(14),
          `outcome=${state.outcome ?? 'unfinished'}`,
          `took=${state.elapsed.toFixed(0)}s`,
          `objectives=${done}/${lines.length}`,
          `friends=${state.stats.crittersFreed}/${state.critters.length}`,
          `bloom=${Math.round(state.bloomCoverage * 100)}%`,
          `trees=${state.stats.treesBroken}`,
          freedAt === null ? '' : `allFreedAt=${freedAt.toFixed(0)}s`,
        ]
          .filter(Boolean)
          .join('  '),
      )

      if (!assertMode && !campaignOnly) continue

      // A chapter has no fail state, so the only real question is whether it can
      // be finished at all — an objective that can't be met would hang forever.
      check(
        state.elapsed < CHAPTER_TIME_LIMIT,
        `${chapter.id}: never finished — an objective is probably unreachable`,
      )
      check(state.phase === 'ended', `${chapter.id}: chapter never ended`)
      check(
        lines.every((line) => line.done),
        `${chapter.id}: ended with objectives outstanding (${done}/${lines.length})`,
      )
      check(
        state.stats.crittersFreed <= state.critters.length,
        `${chapter.id}: served more creatures than exist`,
      )
      check(
        state.critters.length === chapter.critters,
        `${chapter.id}: spawned ${state.critters.length} creatures, recipe asks for ${chapter.critters}`,
      )
    }

    // Tuning signal rather than a pass/fail: the ridge is meant to be the long one.
    const average = times.reduce((sum, value) => sum + value, 0) / times.length
    console.log(`${''.padEnd(14)}  average ${average.toFixed(0)}s`)
  }
}

if (assertMode || (campaignOnly && failures.length > 0)) {
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('\nAll simulation checks passed.')
}
