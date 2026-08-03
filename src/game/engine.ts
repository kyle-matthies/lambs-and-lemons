import { clamp, damp, dampAngle, distance2D } from '../core/math'
import { mulberry32, randRange, type Rng } from '../core/rng'
import {
  CUP_CAPACITY,
  FLOCK_BREW_BONUS,
  FLOCK_BREW_BONUS_CAP,
  FLOCK_PICKUP_BONUS,
  FLOCK_PICKUP_BONUS_CAP,
  SCORE_BREW,
  SCORE_VALLEY_WOKE,
  BREW_TIME,
  BURST_ON_BREAK,
  BURST_PER_HIT,
  COMBO_MIN_LEVEL,
  COMBO_WINDOW,
  COUNTDOWN_TICKS_FROM,
  FOOTSTEP_STRIDE,
  GRAVITY,
  ITEM_DRAG_LAMBDA,
  ITEM_REST_SPEED,
  ITEM_RESTITUTION,
  LEAF_SPAWN_INTERVAL,
  LEMON_PARTS_PER_CUP,
  LEMON_SPAWN_INTERVAL,
  MAX_GROUND_LEAVES,
  MAX_GROUND_LEMONS,
  PICKUP_RADIUS,
  PLAYER_ACCEL_LAMBDA,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_TURN_LAMBDA,
  SCORE_COMBO_BONUS,
  SCORE_CUP,
  SCORE_PICKUP,
  SCORE_SMASH,
  SCORE_SPARKLE_CUP,
  SCORE_TREE_HIT,
  SELL_RADIUS,
  SMASH_BODY_RADIUS,
  SMASH_RADIUS,
  SWING_COOLDOWN,
  SWING_REACH,
  SWING_TIME,
  TREE_COUNT,
  TREE_HEALTH,
  TREE_HIT_RADIUS,
  TREE_REGROW_TIME,
  TREE_RESPAWN_TIME,
  TREE_WOBBLE_TIME,
  ZEST_RADIUS_CUP,
  ZEST_RADIUS_SMASH,
  ZEST_RADIUS_TREE_BREAK,
  ZEST_RADIUS_TREE_HIT,
} from './constants'
import { bloomCoverage, createBloomField, floodBloom, stampBloom } from './bloom'
import { canServeNow, countLost, serveNearestCritter, spawnCritters, updateCritters } from './critters'
import type {
  Critter,
  GameInput,
  GamePhase,
  GameSnapshot,
  GameState,
  GroundItem,
  RoundMinutes,
  Tree,
} from './types'
import { constrainToMeadow, createWorld, generateGroveLayout, isWalkable, type World } from './world'

const scratchPoint = { x: 0, z: 0 }

export function createGame(
  roundMinutes: RoundMinutes,
  phase: GamePhase = 'ready',
  seed = 20260802,
): GameState {
  const world = createWorld(seed)
  const layout = generateGroveLayout(world, TREE_COUNT)
  const rng = mulberry32(seed ^ 0x27d4eb2f)
  let nextId = 1

  const trees: Tree[] = layout.trees.map((spot) => ({
    id: nextId++,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    rotation: spot.rotation,
    scale: spot.scale,
    variant: spot.variant,
    health: TREE_HEALTH,
    stage: 'full',
    respawnTimer: 0,
    regrowTimer: 0,
    wobbleTimer: 0,
    wobbleAngle: 0,
  }))

  const state: GameState = {
    world,
    layout,
    phase,
    roundMinutes,
    timeLeft: roundMinutes * 60,
    elapsed: 0,
    player: {
      x: 0,
      y: world.heightAt(0, 0),
      z: 2,
      vx: 0,
      vz: 0,
      facing: 0,
      speed: 0,
      swingTimer: 0,
      swingCooldown: 0,
      gait: 0,
      footstepPhase: 0,
    },
    stand: {
      x: layout.stand.x,
      y: layout.stand.y,
      z: layout.stand.z,
      rotation: layout.standRotation,
    },
    trees,
    lemons: [],
    leaves: [],
    critters: spawnCritters(world, seed),
    flockSize: 0,
    bloomField: createBloomField(),
    bloomCoverage: 0,
    outcome: null,
    inventory: { lemons: 0, juice: 0, leaves: 0, cups: 0, sparkleCups: 0, sold: 0, score: 0 },
    stats: {
      lemonsSmashed: 0,
      treeHits: 0,
      treesBroken: 0,
      lemonsCollected: 0,
      leavesCollected: 0,
      cupsSold: 0,
      sparkleCups: 0,
      crittersFreed: 0,
    },
    brewProgress: 0,
    comboCount: 0,
    comboTimer: 0,
    lemonSpawnTimer: LEMON_SPAWN_INTERVAL,
    leafSpawnTimer: LEAF_SPAWN_INTERVAL,
    lastWholeSecond: roundMinutes * 60,
    events: [],
    nextId,
  }

  // The stand keeps its own small patch of colour and Lammy stands in a scrap of
  // living grass — the valley is fading, not dead. Deliberately tight: a wide
  // pre-painted circle would swallow the first few smashes and rob the player of
  // the one piece of feedback the whole design rests on.
  stampBloom(state.bloomField, state.stand.x, state.stand.z, 9, 0.9)
  stampBloom(state.bloomField, state.player.x, state.player.z, 5, 0.55)

  // A ring of fruit within a couple of strides of the start, so the very first
  // swing always connects. Nothing kills an opening like whiffing at empty grass.
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 + 0.4
    const distance = randRange(rng, 2.6, 5.4)
    const x = state.player.x + Math.cos(angle) * distance
    const z = state.player.z + Math.sin(angle) * distance
    state.lemons.push(makeItem(state, x, world.heightAt(x, z) + 0.25, z, 0, 0, 0, rng))
  }

  // Seed the wider meadow so the opening shot has somewhere to run to.
  for (let index = 0; index < 10; index += 1) state.lemons.push(spawnLooseItem(state, rng))
  for (let index = 0; index < 6; index += 1) state.leaves.push(spawnLooseItem(state, rng))
  state.player.y = world.heightAt(state.player.x, state.player.z)

  return state
}

export function updateGame(state: GameState, input: GameInput, dt: number) {
  const player = state.player
  player.swingTimer = Math.max(0, player.swingTimer - dt)
  player.swingCooldown = Math.max(0, player.swingCooldown - dt)

  updateTrees(state, dt)
  updateItems(state, state.lemons, dt)
  updateItems(state, state.leaves, dt)

  if (state.phase === 'ready') {
    // Before the round starts you can still stroll around, and the menu's
    // backdrop drives the same path with a scripted input. Nothing is scored and
    // the clock hasn't started.
    state.elapsed += dt
    updatePlayer(state, input, dt)
    updateCritters(state, dt)
    return
  }

  if (state.phase !== 'playing') {
    player.speed = damp(player.speed, 0, 8, dt)
    state.elapsed += dt
    return
  }

  state.elapsed += dt
  state.timeLeft = Math.max(0, state.timeLeft - dt)
  const wholeSecond = Math.ceil(state.timeLeft)
  if (wholeSecond !== state.lastWholeSecond) {
    state.lastWholeSecond = wholeSecond
    if (wholeSecond > 0 && wholeSecond <= COUNTDOWN_TICKS_FROM) {
      state.events.push({ type: 'countdown', secondsLeft: wholeSecond })
    }
  }
  if (state.timeLeft <= 0) {
    endRound(state, 'sunset')
    return
  }

  updatePlayer(state, input, dt)
  updateCritters(state, dt)

  state.comboTimer = Math.max(0, state.comboTimer - dt)
  if (state.comboTimer === 0) state.comboCount = 0

  updateSpawning(state, dt)
  collectItems(state)
  updateBrewing(state, dt)
  state.bloomCoverage = bloomCoverage(state.bloomField, state.world.playRadius)
}

function endRound(state: GameState, outcome: GameState['outcome']) {
  state.phase = 'ended'
  state.outcome = outcome
  state.brewProgress = 0
  if (outcome === 'valleyWoke') {
    state.inventory.score += SCORE_VALLEY_WOKE
    // The last cup tips it over: colour rushes out to every corner at once.
    floodBloom(state.bloomField)
    state.bloomCoverage = bloomCoverage(state.bloomField, state.world.playRadius)
    state.events.push({
      type: 'valleyWoke',
      x: state.player.x,
      y: state.player.y,
      z: state.player.z,
    })
  } else {
    state.events.push({ type: 'timeUp' })
  }
}

/** Each freed friend widens Lammy's reach a little. */
function pickupRadius(state: GameState) {
  return (
    PICKUP_RADIUS + Math.min(FLOCK_PICKUP_BONUS_CAP, state.flockSize * FLOCK_PICKUP_BONUS)
  )
}

/** ...and lends a hoof at the stand. */
function brewDuration(state: GameState) {
  const help = Math.min(FLOCK_BREW_BONUS_CAP, state.flockSize * FLOCK_BREW_BONUS)
  return BREW_TIME * (1 - help)
}

function updatePlayer(state: GameState, input: GameInput, dt: number) {
  const player = state.player
  const world = state.world

  // Screen-space stick → world XZ. The camera looks down -Z, so "up" is -Z.
  const targetVx = input.active ? input.x * PLAYER_SPEED : 0
  const targetVz = input.active ? input.y * PLAYER_SPEED : 0
  player.vx = damp(player.vx, targetVx, PLAYER_ACCEL_LAMBDA, dt)
  player.vz = damp(player.vz, targetVz, PLAYER_ACCEL_LAMBDA, dt)

  const nextX = player.x + player.vx * dt
  const nextZ = player.z + player.vz * dt
  constrainToMeadow(world, nextX, nextZ, PLAYER_RADIUS, scratchPoint)
  // Bleed off velocity we didn't get to use so we don't grind against the edge.
  if (Math.abs(scratchPoint.x - nextX) > 1e-4) player.vx *= 0.3
  if (Math.abs(scratchPoint.z - nextZ) > 1e-4) player.vz *= 0.3
  player.x = scratchPoint.x
  player.z = scratchPoint.z
  player.y = world.heightAt(player.x, player.z)

  player.speed = Math.hypot(player.vx, player.vz)
  if (player.speed > 0.35) {
    player.facing = dampAngle(
      player.facing,
      Math.atan2(player.vx, player.vz),
      PLAYER_TURN_LAMBDA,
      dt,
    )
  }

  // Gait advances with distance travelled, so the legs never skate.
  const stride = player.speed * dt
  player.gait += stride
  player.footstepPhase += stride
  if (player.footstepPhase >= FOOTSTEP_STRIDE) {
    player.footstepPhase -= FOOTSTEP_STRIDE
    state.events.push({ type: 'footstep', x: player.x, y: player.y, z: player.z })
  }
}

export function swingHammer(state: GameState) {
  if (state.phase !== 'playing' || state.player.swingCooldown > 0) return

  const player = state.player
  player.swingTimer = SWING_TIME
  player.swingCooldown = SWING_COOLDOWN

  const hitX = player.x + Math.sin(player.facing) * SWING_REACH
  const hitZ = player.z + Math.cos(player.facing) * SWING_REACH
  let hitSomething = false

  const smashed = new Set<number>()
  for (const lemon of state.lemons) {
    const inArc = distance2D(lemon.x, lemon.z, hitX, hitZ) < SMASH_RADIUS
    const underfoot = distance2D(lemon.x, lemon.z, player.x, player.z) < SMASH_BODY_RADIUS
    if (!inArc && !underfoot) continue

    smashed.add(lemon.id)
    state.inventory.score += SCORE_SMASH
    state.inventory.juice += 1
    state.stats.lemonsSmashed += 1
    state.events.push({ type: 'smash', x: lemon.x, y: lemon.y, z: lemon.z })
    pourZest(state, lemon.x, lemon.z, ZEST_RADIUS_SMASH, 0.85)
    registerComboHit(state, lemon.x, lemon.y, lemon.z)
    hitSomething = true
  }
  if (smashed.size > 0) state.lemons = state.lemons.filter((lemon) => !smashed.has(lemon.id))

  for (const tree of state.trees) {
    if (tree.stage !== 'full') continue
    if (distance2D(tree.x, tree.z, hitX, hitZ) >= TREE_HIT_RADIUS * tree.scale) continue

    tree.health -= 1
    tree.wobbleTimer = TREE_WOBBLE_TIME
    tree.wobbleAngle = Math.atan2(tree.x - player.x, tree.z - player.z)
    hitSomething = true
    state.inventory.score += SCORE_TREE_HIT
    state.stats.treeHits += 1
    registerComboHit(state, tree.x, tree.y, tree.z)

    if (tree.health <= 0) {
      tree.stage = 'broken'
      tree.respawnTimer = TREE_RESPAWN_TIME
      state.stats.treesBroken += 1
      burstItems(state, tree, BURST_ON_BREAK.lemons, BURST_ON_BREAK.leaves)
      state.events.push({ type: 'treeBreak', x: tree.x, y: tree.y, z: tree.z })
      pourZest(state, tree.x, tree.z, ZEST_RADIUS_TREE_BREAK, 1)
    } else {
      burstItems(state, tree, BURST_PER_HIT.lemons, BURST_PER_HIT.leaves)
      state.events.push({ type: 'treeHit', x: tree.x, y: tree.y, z: tree.z, health: tree.health })
      pourZest(state, tree.x, tree.z, ZEST_RADIUS_TREE_HIT, 0.7)
    }
  }

  if (!hitSomething) {
    state.events.push({
      type: 'whiff',
      x: hitX,
      y: state.world.heightAt(hitX, hitZ),
      z: hitZ,
    })
  }
}

export function drainEvents(state: GameState) {
  if (state.events.length === 0) return []
  const events = state.events
  state.events = []
  return events
}

export function takeSnapshot(state: GameState): GameSnapshot {
  return {
    phase: state.phase,
    roundMinutes: state.roundMinutes,
    timeLeft: state.timeLeft,
    score: state.inventory.score,
    sold: state.inventory.sold,
    lemons: state.inventory.lemons,
    juice: state.inventory.juice,
    leaves: state.inventory.leaves,
    cups: state.inventory.cups,
    sparkleCups: state.inventory.sparkleCups,
    nearStand: isNearStand(state),
    brewing: state.brewProgress > 0,
    brewProgress: state.brewProgress,
    combo: state.comboCount >= COMBO_MIN_LEVEL ? state.comboCount : 0,
    flockSize: state.flockSize,
    lostCritters: countLost(state.critters),
    bloomCoverage: state.bloomCoverage,
    canServe: canServeNow(state),
    outcome: state.outcome,
    stats: { ...state.stats },
  }
}

export function isNearStand(state: GameState) {
  return distance2D(state.player.x, state.player.z, state.stand.x, state.stand.z) < SELL_RADIUS
}

function pourZest(state: GameState, x: number, z: number, radius: number, strength: number) {
  stampBloom(state.bloomField, x, z, radius, strength)
  state.events.push({ type: 'zest', x, z, radius, strength })
}

function registerComboHit(state: GameState, x: number, y: number, z: number) {
  state.comboCount += 1
  state.comboTimer = COMBO_WINDOW
  if (state.comboCount >= COMBO_MIN_LEVEL) {
    state.inventory.score += SCORE_COMBO_BONUS
    state.events.push({ type: 'combo', x, y, z, level: state.comboCount })
  }
}

function lemonParts(state: GameState) {
  return state.inventory.lemons + state.inventory.juice
}

function updateBrewing(state: GameState, dt: number) {
  const hasRoom = state.inventory.cups < CUP_CAPACITY
  const canBrew = isNearStand(state) && hasRoom && lemonParts(state) >= LEMON_PARTS_PER_CUP
  if (!canBrew) {
    state.brewProgress = 0
    return
  }

  state.brewProgress += dt / brewDuration(state)
  if (state.brewProgress < 1) return
  state.brewProgress = 0

  let partsNeeded = LEMON_PARTS_PER_CUP
  const juiceUsed = Math.min(state.inventory.juice, partsNeeded)
  state.inventory.juice -= juiceUsed
  partsNeeded -= juiceUsed
  state.inventory.lemons -= partsNeeded

  // A leaf on hand turns this into a sparkle cup, worth double when it's given.
  const sparkle = state.inventory.leaves > 0
  if (sparkle) {
    state.inventory.leaves -= 1
    state.inventory.sparkleCups += 1
  }
  state.inventory.cups += 1
  state.inventory.score += SCORE_BREW
  state.events.push({
    type: 'cupBrewed',
    x: state.stand.x,
    y: state.stand.y,
    z: state.stand.z,
    sparkle,
  })
  pourZest(state, state.stand.x, state.stand.z, ZEST_RADIUS_CUP * (sparkle ? 1.3 : 1), 0.9)
}

/**
 * Give a cup to the nearest lost creature. Brewing is the chore; this is the
 * point of the round, and the moment the valley gets a piece of itself back.
 */
export function serveCup(state: GameState): Critter | null {
  if (state.phase !== 'playing') return null
  const served = serveNearestCritter(state)
  if (!served) return null

  state.inventory.sold += 1
  state.stats.cupsSold += 1
  state.stats.crittersFreed += 1
  if (served.sparkle) state.stats.sparkleCups += 1
  state.inventory.score += served.sparkle ? SCORE_SPARKLE_CUP : SCORE_CUP

  if (countLost(state.critters) === 0) endRound(state, 'valleyWoke')
  return served.critter
}

function updateTrees(state: GameState, dt: number) {
  for (const tree of state.trees) {
    tree.wobbleTimer = Math.max(0, tree.wobbleTimer - dt)
    tree.regrowTimer = Math.max(0, tree.regrowTimer - dt)
    if (tree.stage !== 'broken' || state.phase !== 'playing') continue

    tree.respawnTimer -= dt
    if (tree.respawnTimer <= 0) {
      tree.stage = 'full'
      tree.health = TREE_HEALTH
      tree.regrowTimer = TREE_REGROW_TIME
      state.events.push({ type: 'treeRegrow', x: tree.x, y: tree.y, z: tree.z })
    }
  }
}

function updateSpawning(state: GameState, dt: number) {
  state.lemonSpawnTimer -= dt
  if (state.lemonSpawnTimer <= 0) {
    state.lemonSpawnTimer = LEMON_SPAWN_INTERVAL
    if (state.lemons.length < MAX_GROUND_LEMONS) state.lemons.push(spawnLooseItem(state))
  }

  state.leafSpawnTimer -= dt
  if (state.leafSpawnTimer <= 0) {
    state.leafSpawnTimer = LEAF_SPAWN_INTERVAL
    if (state.leaves.length < MAX_GROUND_LEAVES) state.leaves.push(spawnLooseItem(state))
  }
}

/** Drops a fresh item somewhere walkable, never right on top of the stand. */
function spawnLooseItem(state: GameState, rng: Rng = Math.random): GroundItem {
  const world = state.world
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * (world.playRadius - 2.5)
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (!isWalkable(world, x, z, 1)) continue
    if (distance2D(x, z, state.stand.x, state.stand.z) < SELL_RADIUS * 1.2) continue
    return makeItem(state, x, world.heightAt(x, z) + 0.25, z, 0, 0, 0, rng)
  }
  return makeItem(state, 0, world.heightAt(0, 0) + 0.25, 0, 0, 0, 0, rng)
}

function makeItem(
  state: GameState,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  rng: Rng = Math.random,
): GroundItem {
  return {
    id: state.nextId++,
    x,
    y,
    z,
    vx,
    vy,
    vz,
    spin: rng() * Math.PI * 2,
    spinSpeed: randRange(rng, -6, 6),
    resting: false,
    age: 0,
  }
}

/** Fruit and leaves fly out of a struck tree in a shallow cone. */
function burstItems(state: GameState, tree: Tree, lemons: number, leaves: number) {
  const canopyY = tree.y + 2.6 * tree.scale
  for (let index = 0; index < lemons; index += 1) {
    const angle = (Math.PI * 2 * index) / lemons + Math.random() * 0.5
    const speed = randRange(Math.random, 2.4, 5.2)
    state.lemons.push(
      makeItem(
        state,
        tree.x + Math.cos(angle) * 0.5,
        canopyY,
        tree.z + Math.sin(angle) * 0.5,
        Math.cos(angle) * speed,
        randRange(Math.random, 2.5, 5),
        Math.sin(angle) * speed,
      ),
    )
  }

  for (let index = 0; index < leaves; index += 1) {
    const angle = (Math.PI * 2 * index) / leaves + 0.6 + Math.random() * 0.5
    const speed = randRange(Math.random, 1.2, 3)
    state.leaves.push(
      makeItem(
        state,
        tree.x + Math.cos(angle) * 0.5,
        canopyY + 0.4,
        tree.z + Math.sin(angle) * 0.5,
        Math.cos(angle) * speed,
        randRange(Math.random, 1.5, 3),
        Math.sin(angle) * speed,
      ),
    )
  }
}

function updateItems(state: GameState, items: GroundItem[], dt: number) {
  const world = state.world

  for (const item of items) {
    item.age += dt
    if (item.resting) {
      item.spinSpeed = damp(item.spinSpeed, 0, 6, dt)
      item.spin += item.spinSpeed * dt
      continue
    }

    item.vy -= GRAVITY * dt
    item.x += item.vx * dt
    item.y += item.vy * dt
    item.z += item.vz * dt
    item.spin += item.spinSpeed * dt

    constrainToMeadow(world, item.x, item.z, 0.25, scratchPoint)
    if (scratchPoint.x !== item.x) item.vx *= -0.5
    if (scratchPoint.z !== item.z) item.vz *= -0.5
    item.x = scratchPoint.x
    item.z = scratchPoint.z

    const ground = world.heightAt(item.x, item.z) + 0.22
    if (item.y <= ground) {
      item.y = ground
      if (item.vy < -0.6) {
        item.vy = -item.vy * ITEM_RESTITUTION
        item.spinSpeed = randRange(Math.random, -7, 7)
      } else {
        item.vy = 0
      }
      // Rolling drag only applies once the fruit is touching grass.
      const drag = Math.exp(-ITEM_DRAG_LAMBDA * dt)
      item.vx *= drag
      item.vz *= drag
      if (Math.hypot(item.vx, item.vy, item.vz) < ITEM_REST_SPEED) {
        item.resting = true
        item.vx = 0
        item.vy = 0
        item.vz = 0
      }
    }
  }
}

function collectItems(state: GameState) {
  const player = state.player
  const reach = pickupRadius(state)

  const keptLemons: GroundItem[] = []
  for (const lemon of state.lemons) {
    if (distance2D(lemon.x, lemon.z, player.x, player.z) < reach) {
      state.inventory.lemons += 1
      state.inventory.score += SCORE_PICKUP
      state.stats.lemonsCollected += 1
      state.events.push({ type: 'pickupLemon', x: lemon.x, y: lemon.y, z: lemon.z })
    } else {
      keptLemons.push(lemon)
    }
  }
  state.lemons = keptLemons

  const keptLeaves: GroundItem[] = []
  for (const leaf of state.leaves) {
    if (distance2D(leaf.x, leaf.z, player.x, player.z) < reach) {
      state.inventory.leaves += 1
      state.inventory.score += SCORE_PICKUP
      state.stats.leavesCollected += 1
      state.events.push({ type: 'pickupLeaf', x: leaf.x, y: leaf.y, z: leaf.z })
    } else {
      keptLeaves.push(leaf)
    }
  }
  state.leaves = keptLeaves
}

/** Progress of the current swing, 0 → 1. The renderer drives the mallet arc from this. */
export function swingProgress(state: GameState) {
  return state.player.swingTimer <= 0 ? 1 : 1 - state.player.swingTimer / SWING_TIME
}

export function normalizedSpeed(state: GameState) {
  return clamp(state.player.speed / PLAYER_SPEED, 0, 1)
}

export type { World }
export { canServeNow, nearestLostCritter } from './critters'
