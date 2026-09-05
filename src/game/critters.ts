import { clamp01, damp, dampAngle, distance2D } from '../core/math'
import { mulberry32, randRange, type Rng } from '../core/rng'
import {
  CRITTER_BLOOM_TIME,
  CRITTER_COUNT,
  CRITTER_FOLLOW_GAP,
  CRITTER_HOPE_RANGE,
  CRITTER_KINDS,
  CRITTER_SPEED_FOLLOW,
  CRITTER_SPEED_HOPE,
  CRITTER_SPEED_LOST,
  CRITTER_WANDER_RADIUS,
  FLOCK_TRAIL_INTERVAL,
  FLOCK_TRAIL_RADIUS,
  SERVE_RADIUS,
  ZEST_RADIUS_BLOOM,
} from './constants'
import { stampBloom } from './bloom'
import type { Critter, GameState } from './types'
import { constrainToMeadow, isWalkable, type World } from './world'

/**
 * The lost creatures of the valley.
 *
 * Every critter starts grey and listless, wandering a small patch with its head
 * down. Give it a cup of lemonade and it blooms back into colour and falls in
 * behind Lammy, and from then on it trails a little colour of its own across the
 * grass. Freeing the whole valley is the win condition; the growing line of
 * animals behind you is the progress bar.
 */

const scratch = { x: 0, z: 0 }

export function spawnCritters(world: World, seed: number, count = CRITTER_COUNT): Critter[] {
  const rng = mulberry32(seed ^ 0x63a17e)
  const critters: Critter[] = []

  for (let index = 0; index < count; index += 1) {
    const spot = findHome(world, rng, critters)
    critters.push({
      id: index + 1,
      kind: CRITTER_KINDS[index % CRITTER_KINDS.length],
      x: spot.x,
      y: world.heightAt(spot.x, spot.z),
      z: spot.z,
      homeX: spot.x,
      homeZ: spot.z,
      facing: rng() * Math.PI * 2,
      state: 'lost',
      speed: 0,
      wanderTimer: randRange(rng, 0.5, 3),
      targetX: spot.x,
      targetZ: spot.z,
      bloomTimer: 0,
      followIndex: -1,
      gait: 0,
      trailTimer: randRange(rng, 0, FLOCK_TRAIL_INTERVAL),
      hue: rng(),
    })
  }

  return critters
}

/** Spread the lost ones around the meadow so the player has to explore for them. */
function findHome(world: World, rng: Rng, existing: Critter[]) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const angle = rng() * Math.PI * 2
    const radius = randRange(rng, 8, world.playRadius - 3.5)
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (!isWalkable(world, x, z, 2)) continue
    if (existing.some((critter) => distance2D(critter.homeX, critter.homeZ, x, z) < 8)) continue
    return { x, z }
  }
  return { x: 12, z: -12 }
}

export function updateCritters(state: GameState, dt: number) {
  let followSlot = 0

  for (const critter of state.critters) {
    switch (critter.state) {
      case 'lost':
        updateLost(state, critter, dt)
        break

      case 'blooming': {
        critter.bloomTimer -= dt
        // A little hop of delight while the colour floods back in.
        critter.gait += dt * 6
        critter.speed = damp(critter.speed, 0, 6, dt)
        if (critter.bloomTimer <= 0) {
          critter.state = 'follower'
          state.flockSize += 1
          state.events.push({
            type: 'flockJoin',
            x: critter.x,
            y: critter.y,
            z: critter.z,
            size: state.flockSize,
          })
        }
        break
      }

      case 'follower':
        critter.followIndex = followSlot
        followSlot += 1
        updateFollower(state, critter, dt)
        break
    }

    critter.y = state.world.heightAt(critter.x, critter.z)
  }

  // Followers paint the valley as they go — the flock is a brush, not a trophy.
  if (state.flockSize > 0 && state.phase === 'playing') {
    for (const critter of state.critters) {
      if (critter.state !== 'follower') continue
      critter.trailTimer -= dt
      if (critter.trailTimer > 0) continue
      critter.trailTimer = FLOCK_TRAIL_INTERVAL
      if (critter.speed < 0.6) continue
      stampBloom(state.bloomField, critter.x, critter.z, FLOCK_TRAIL_RADIUS, 0.28)
      state.events.push({
        type: 'zest',
        x: critter.x,
        z: critter.z,
        radius: FLOCK_TRAIL_RADIUS,
        strength: 0.28,
      })
    }
  }

}

function updateLost(state: GameState, critter: Critter, dt: number) {
  const player = state.player
  const toPlayer = distance2D(critter.x, critter.z, player.x, player.z)

  // Someone is coming, and she's carrying a cup. That's worth getting up for.
  // They shuffle over and stop just short, which turns the serve from "walk onto
  // a target" into two characters meeting each other halfway.
  if (state.inventory.cups > 0 && toPlayer < CRITTER_HOPE_RANGE) {
    const stop = SERVE_RADIUS * 0.8
    if (toPlayer > stop) {
      const t = (toPlayer - stop) / Math.max(0.001, CRITTER_HOPE_RANGE - stop)
      moveToward(
        state.world,
        critter,
        player.x,
        player.z,
        CRITTER_SPEED_HOPE * (1 - t * 0.45),
        dt,
        stop,
      )
    } else {
      critter.speed = damp(critter.speed, 0, 8, dt)
      critter.facing = dampAngle(
        critter.facing,
        Math.atan2(player.x - critter.x, player.z - critter.z),
        6,
        dt,
      )
    }
    // Wander somewhere fresh once she's gone rather than snapping back to a stale target.
    critter.wanderTimer = 0
    return
  }

  critter.wanderTimer -= dt

  if (critter.wanderTimer <= 0) {
    // Short, aimless shuffles around a home patch. They aren't going anywhere.
    critter.wanderTimer = randRange(Math.random, 1.6, 4.2)
    const angle = Math.random() * Math.PI * 2
    const distance = Math.random() * CRITTER_WANDER_RADIUS
    critter.targetX = critter.homeX + Math.cos(angle) * distance
    critter.targetZ = critter.homeZ + Math.sin(angle) * distance
  }

  moveToward(state.world, critter, critter.targetX, critter.targetZ, CRITTER_SPEED_LOST, dt, 1.1)
}

function updateFollower(state: GameState, critter: Critter, dt: number) {
  const player = state.player
  const slot = critter.followIndex

  // Fan out behind Lammy rather than queueing up. A pure single-file line reads
  // as a totem pole from the game's camera — the animals behind simply stack up
  // the screen. Alternating sides, widening with distance, and a slow weave on
  // top gives it the shape of a flock.
  const rank = Math.floor(slot / 2)
  const back = CRITTER_FOLLOW_GAP * (rank + 1) + (slot % 2) * 0.45
  const side = (slot % 2 === 0 ? 1 : -1) * (0.55 + rank * 0.42)
  const weave = Math.sin(state.elapsed * 1.1 + slot * 1.7) * 0.42
  const lateral = side + weave

  const behindX = player.x - Math.sin(player.facing) * back + Math.cos(player.facing) * lateral
  const behindZ = player.z - Math.cos(player.facing) * back - Math.sin(player.facing) * lateral

  const gap = distance2D(critter.x, critter.z, behindX, behindZ)
  // Hang back when close, sprint when left behind — that catch-up scramble is
  // most of the charm.
  const urgency = clamp01((gap - 0.6) / 3.2)
  const speed = CRITTER_SPEED_FOLLOW * urgency
  moveToward(state.world, critter, behindX, behindZ, speed, dt, 0.35)
}

function moveToward(
  world: World,
  critter: Critter,
  targetX: number,
  targetZ: number,
  maxSpeed: number,
  dt: number,
  arriveRadius: number,
) {
  const dx = targetX - critter.x
  const dz = targetZ - critter.z
  const distance = Math.hypot(dx, dz)

  if (distance < arriveRadius || maxSpeed <= 0) {
    critter.speed = damp(critter.speed, 0, 7, dt)
  } else {
    critter.speed = damp(critter.speed, maxSpeed, 5, dt)
    critter.facing = dampAngle(critter.facing, Math.atan2(dx, dz), 8, dt)
  }

  if (critter.speed > 0.01) {
    const step = critter.speed * dt
    const nextX = critter.x + Math.sin(critter.facing) * step
    const nextZ = critter.z + Math.cos(critter.facing) * step
    constrainToMeadow(world, nextX, nextZ, 0.45, scratch)
    critter.x = scratch.x
    critter.z = scratch.z
    critter.gait += step
  }
}

export interface ServeResult {
  critter: Critter
  sparkle: boolean
}

/**
 * Hand a cup to the nearest lost critter in range. Returns null if nobody was
 * close enough or Lammy is empty-hoofed.
 */
export function serveNearestCritter(state: GameState): ServeResult | null {
  if (state.inventory.cups <= 0) return null

  let best: Critter | null = null
  let bestDistance = SERVE_RADIUS

  for (const critter of state.critters) {
    if (critter.state !== 'lost') continue
    const distance = distance2D(critter.x, critter.z, state.player.x, state.player.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = critter
    }
  }

  if (!best) return null

  // Sparkle cups go first — they're worth more and the payoff should feel eager.
  const sparkle = state.inventory.sparkleCups > 0
  if (sparkle) state.inventory.sparkleCups -= 1
  state.inventory.cups -= 1

  best.state = 'blooming'
  best.bloomTimer = CRITTER_BLOOM_TIME
  best.speed = 0

  state.events.push({
    type: 'critterServed',
    critterId: best.id,
    x: best.x,
    y: best.y,
    z: best.z,
    kind: best.kind,
    sparkle,
  })
  const bloomRadius = ZEST_RADIUS_BLOOM * (sparkle ? 1.35 : 1)
  stampBloom(state.bloomField, best.x, best.z, bloomRadius, 1)
  state.events.push({ type: 'zest', x: best.x, z: best.z, radius: bloomRadius, strength: 1 })

  return { critter: best, sparkle }
}

/** True when a lost critter is close enough to hand a cup to. */
export function canServeNow(state: GameState) {
  if (state.inventory.cups <= 0) return false
  return state.critters.some(
    (critter) =>
      critter.state === 'lost' &&
      distance2D(critter.x, critter.z, state.player.x, state.player.z) < SERVE_RADIUS,
  )
}

/** The nearest lost critter, for the HUD's "who still needs you" pointer. */
export function nearestLostCritter(state: GameState) {
  let best: Critter | null = null
  let bestDistance = Infinity
  for (const critter of state.critters) {
    if (critter.state !== 'lost') continue
    const distance = distance2D(critter.x, critter.z, state.player.x, state.player.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = critter
    }
  }
  return best
}

/**
 * Put the first `count` creatures straight into the flock. Used by the `?flock=`
 * debug link so the trailing line can be looked at without playing a whole
 * round — it's the hardest part of the game to inspect any other way.
 */
export function preFreeCritters(state: GameState, count: number) {
  for (const critter of state.critters) {
    if (state.flockSize >= count) break
    if (critter.state !== 'lost') continue
    critter.state = 'follower'
    critter.x = state.player.x
    critter.z = state.player.z
    state.flockSize += 1
    state.stats.crittersFreed += 1
    state.inventory.sold += 1
  }
}

export function countLost(critters: Critter[]) {
  let lost = 0
  for (const critter of critters) if (critter.state === 'lost') lost += 1
  return lost
}
