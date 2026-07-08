import {
  BREW_TIME,
  BURST_ON_BREAK,
  BURST_PER_HIT,
  COMBO_MIN_LEVEL,
  COMBO_WINDOW,
  COUNTDOWN_TICKS_FROM,
  LEAF_SPAWN_INTERVAL,
  LEMON_PARTS_PER_CUP,
  LEMON_SPAWN_INTERVAL,
  MAX_GROUND_LEAVES,
  MAX_GROUND_LEMONS,
  PICKUP_RADIUS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
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
  TREE_HEALTH,
  TREE_HIT_RADIUS,
  TREE_REGROW_POP,
  TREE_RESPAWN_TIME,
  TREE_WOBBLE_TIME,
} from './constants'
import type {
  GameInput,
  GamePhase,
  GameSnapshot,
  GameState,
  RollingItem,
  RoundMinutes,
  Tree,
} from './types'

export function createGame(
  width: number,
  height: number,
  roundMinutes: RoundMinutes,
  phase: GamePhase = 'ready',
): GameState {
  const safeWidth = Math.max(width, 320)
  const safeHeight = Math.max(height, 620)
  let nextId = 1
  const id = () => nextId++

  const lemons: RollingItem[] = [
    [0.36, 0.42],
    [0.61, 0.45],
    [0.47, 0.56],
    [0.77, 0.58],
    [0.25, 0.63],
    [0.39, 0.74],
    [0.68, 0.76],
    [0.55, 0.67],
  ].map(([x, y]) => ({ id: id(), x: x * safeWidth, y: y * safeHeight, vx: 0, vy: 0 }))

  const leaves: RollingItem[] = [
    [0.31, 0.5],
    [0.53, 0.5],
    [0.73, 0.48],
    [0.2, 0.55],
    [0.42, 0.64],
    [0.59, 0.61],
    [0.75, 0.68],
    [0.28, 0.75],
  ].map(([x, y]) => ({ id: id(), x: x * safeWidth, y: y * safeHeight, vx: 0, vy: 0 }))

  const trees: Tree[] = [
    [0.17, 0.29],
    [0.82, 0.35],
    [0.18, 0.72],
    [0.84, 0.75],
    [0.52, 0.31],
  ].map(([x, y]) => ({
    id: id(),
    x: x * safeWidth,
    y: y * safeHeight,
    health: TREE_HEALTH,
    stage: 'full' as const,
    respawnTimer: 0,
    regrowTimer: 0,
    wobbleTimer: 0,
  }))

  return {
    width: safeWidth,
    height: safeHeight,
    phase,
    roundMinutes,
    timeLeft: roundMinutes * 60,
    player: {
      x: safeWidth * 0.5,
      y: safeHeight * 0.68,
      facingX: 0,
      facingY: -1,
      swingTimer: 0,
      swingCooldown: 0,
    },
    stand: { x: safeWidth * 0.73, y: safeHeight * 0.2 },
    trees,
    lemons,
    leaves,
    effects: [],
    inventory: { lemons: 0, juice: 0, leaves: 0, sold: 0, score: 0 },
    stats: {
      lemonsSmashed: 0,
      treeHits: 0,
      treesBroken: 0,
      lemonsCollected: 0,
      leavesCollected: 0,
      cupsSold: 0,
      sparkleCups: 0,
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
}

export function resizeGame(state: GameState, width: number, height: number) {
  const nextWidth = Math.max(width, 320)
  const nextHeight = Math.max(height, 620)
  const scaleX = nextWidth / state.width
  const scaleY = nextHeight / state.height
  const scalePoint = <T extends { x: number; y: number }>(point: T) => {
    point.x *= scaleX
    point.y *= scaleY
  }

  scalePoint(state.player)
  scalePoint(state.stand)
  state.trees.forEach(scalePoint)
  state.lemons.forEach(scalePoint)
  state.leaves.forEach(scalePoint)
  state.effects.forEach(scalePoint)
  state.width = nextWidth
  state.height = nextHeight
  clampPlayer(state)
}

export function updateGame(state: GameState, input: GameInput, dt: number) {
  const player = state.player
  player.swingTimer = Math.max(0, player.swingTimer - dt)
  player.swingCooldown = Math.max(0, player.swingCooldown - dt)
  updateTrees(state, dt)
  updateEffects(state, dt)

  if (state.phase !== 'playing') return

  state.timeLeft = Math.max(0, state.timeLeft - dt)
  const wholeSecond = Math.ceil(state.timeLeft)
  if (wholeSecond !== state.lastWholeSecond) {
    state.lastWholeSecond = wholeSecond
    if (wholeSecond > 0 && wholeSecond <= COUNTDOWN_TICKS_FROM) {
      state.events.push({ type: 'countdown', secondsLeft: wholeSecond })
    }
  }
  if (state.timeLeft <= 0) {
    state.phase = 'ended'
    state.brewProgress = 0
    state.events.push({ type: 'timeUp' })
    return
  }

  if (input.active) {
    player.x += input.x * PLAYER_SPEED * dt
    player.y += input.y * PLAYER_SPEED * dt
    if (Math.abs(input.x) + Math.abs(input.y) > 0.08) {
      player.facingX = input.x
      player.facingY = input.y
    }
    clampPlayer(state)
  }

  state.comboTimer = Math.max(0, state.comboTimer - dt)
  if (state.comboTimer === 0) state.comboCount = 0

  updateSpawning(state, dt)
  updateRollingItems(state, dt)
  collectItems(state)
  updateBrewing(state, dt)
}

export function swingHammer(state: GameState) {
  if (state.phase !== 'playing' || state.player.swingCooldown > 0) return

  const player = state.player
  player.swingTimer = SWING_TIME
  player.swingCooldown = SWING_COOLDOWN
  const length = Math.hypot(player.facingX, player.facingY) || 1
  const aimX = player.facingX / length
  const aimY = player.facingY / length
  const hitX = player.x + aimX * SWING_REACH
  const hitY = player.y + aimY * SWING_REACH
  let hitSomething = false

  const smashedIds = new Set<number>()
  state.lemons.forEach((lemon) => {
    if (
      distance(lemon.x, lemon.y, hitX, hitY) < SMASH_RADIUS ||
      distance(lemon.x, lemon.y, player.x, player.y) < SMASH_BODY_RADIUS
    ) {
      smashedIds.add(lemon.id)
      state.inventory.score += SCORE_SMASH
      state.inventory.juice += 1
      state.stats.lemonsSmashed += 1
      addSplat(state, lemon.x, lemon.y, 72)
      state.events.push({ type: 'smash', x: lemon.x, y: lemon.y })
      registerComboHit(state, lemon.x, lemon.y)
      hitSomething = true
    }
  })
  state.lemons = state.lemons.filter((lemon) => !smashedIds.has(lemon.id))

  state.trees.forEach((tree) => {
    if (tree.stage !== 'full' || distance(tree.x, tree.y, hitX, hitY) >= TREE_HIT_RADIUS) return

    tree.health -= 1
    tree.wobbleTimer = TREE_WOBBLE_TIME
    hitSomething = true
    state.inventory.score += SCORE_TREE_HIT
    state.stats.treeHits += 1
    registerComboHit(state, tree.x, tree.y)
    if (tree.health <= 0) {
      tree.stage = 'broken'
      tree.respawnTimer = TREE_RESPAWN_TIME
      state.stats.treesBroken += 1
      burstItems(state, tree.x, tree.y, BURST_ON_BREAK.lemons, BURST_ON_BREAK.leaves)
      state.events.push({ type: 'treeBreak', x: tree.x, y: tree.y })
    } else {
      burstItems(state, tree.x, tree.y, BURST_PER_HIT.lemons, BURST_PER_HIT.leaves)
      state.events.push({ type: 'treeHit', x: tree.x, y: tree.y })
    }
  })

  if (!hitSomething) {
    addSplat(state, hitX, hitY, 46)
    state.events.push({ type: 'whiff', x: hitX, y: hitY })
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
    nearStand: isNearStand(state),
    brewing: state.brewProgress > 0,
    combo: state.comboCount >= COMBO_MIN_LEVEL ? state.comboCount : 0,
    stats: { ...state.stats },
  }
}

function registerComboHit(state: GameState, x: number, y: number) {
  state.comboCount += 1
  state.comboTimer = COMBO_WINDOW
  if (state.comboCount >= COMBO_MIN_LEVEL) {
    state.inventory.score += SCORE_COMBO_BONUS
    state.events.push({ type: 'combo', x, y, level: state.comboCount })
  }
}

function lemonParts(state: GameState) {
  return state.inventory.lemons + state.inventory.juice
}

function updateBrewing(state: GameState, dt: number) {
  const canBrew = isNearStand(state) && lemonParts(state) >= LEMON_PARTS_PER_CUP
  if (!canBrew) {
    state.brewProgress = 0
    return
  }

  state.brewProgress += dt / BREW_TIME
  if (state.brewProgress < 1) return
  state.brewProgress = 0

  let partsNeeded = LEMON_PARTS_PER_CUP
  const juiceUsed = Math.min(state.inventory.juice, partsNeeded)
  state.inventory.juice -= juiceUsed
  partsNeeded -= juiceUsed
  state.inventory.lemons -= partsNeeded

  const sparkle = state.inventory.leaves > 0
  if (sparkle) {
    state.inventory.leaves -= 1
    state.stats.sparkleCups += 1
  }
  state.inventory.sold += 1
  state.stats.cupsSold += 1
  state.inventory.score += sparkle ? SCORE_SPARKLE_CUP : SCORE_CUP
  addSplat(state, state.stand.x, state.stand.y + 28, 62)
  state.events.push({ type: 'cupSold', x: state.stand.x, y: state.stand.y, sparkle })
}

function updateTrees(state: GameState, dt: number) {
  state.trees.forEach((tree) => {
    tree.wobbleTimer = Math.max(0, tree.wobbleTimer - dt)
    tree.regrowTimer = Math.max(0, tree.regrowTimer - dt)
    if (tree.stage !== 'broken' || state.phase !== 'playing') return

    tree.respawnTimer -= dt
    if (tree.respawnTimer <= 0) {
      tree.stage = 'full'
      tree.health = TREE_HEALTH
      tree.regrowTimer = TREE_REGROW_POP
      state.events.push({ type: 'treeRegrow', x: tree.x, y: tree.y })
    }
  })
}

function updateSpawning(state: GameState, dt: number) {
  state.lemonSpawnTimer -= dt
  if (state.lemonSpawnTimer <= 0) {
    state.lemonSpawnTimer = LEMON_SPAWN_INTERVAL
    if (state.lemons.length < MAX_GROUND_LEMONS) {
      state.lemons.push(spawnItem(state))
    }
  }

  state.leafSpawnTimer -= dt
  if (state.leafSpawnTimer <= 0) {
    state.leafSpawnTimer = LEAF_SPAWN_INTERVAL
    if (state.leaves.length < MAX_GROUND_LEAVES) {
      state.leaves.push(spawnItem(state))
    }
  }
}

function spawnItem(state: GameState): RollingItem {
  // Keep spawns out of the stand corner so pickups never feel accidental.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const x = 40 + Math.random() * (state.width - 80)
    const y = 120 + Math.random() * (state.height - 260)
    if (distance(x, y, state.stand.x, state.stand.y) > SELL_RADIUS * 1.1) {
      return { id: state.nextId++, x, y, vx: 0, vy: 0 }
    }
  }
  return {
    id: state.nextId++,
    x: state.width * 0.5,
    y: state.height * 0.6,
    vx: 0,
    vy: 0,
  }
}

function burstItems(state: GameState, x: number, y: number, lemons: number, leaves: number) {
  for (let index = 0; index < lemons; index += 1) {
    const angle = (Math.PI * 2 * index) / lemons + Math.random() * 0.3
    state.lemons.push({
      id: state.nextId++,
      x: x + Math.cos(angle) * 30,
      y: y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * (120 + Math.random() * 80),
      vy: Math.sin(angle) * (90 + Math.random() * 70),
    })
  }

  for (let index = 0; index < leaves; index += 1) {
    const angle = (Math.PI * 2 * index) / leaves + 0.5 + Math.random() * 0.4
    state.leaves.push({
      id: state.nextId++,
      x: x + Math.cos(angle) * 30,
      y: y + Math.sin(angle) * 24,
      vx: Math.cos(angle) * (90 + Math.random() * 70),
      vy: Math.sin(angle) * (90 + Math.random() * 60),
    })
  }
}

export function isNearStand(state: GameState) {
  return distance(state.player.x, state.player.y, state.stand.x, state.stand.y) < SELL_RADIUS
}

function clampPlayer(state: GameState) {
  // Keep the lamb below the two HUD rows (~200px) so she never hides under them.
  const top = Math.max(190, state.height * 0.22)
  const bottom = state.height - Math.max(118, state.height * 0.13)
  state.player.x = clamp(state.player.x, PLAYER_RADIUS, state.width - PLAYER_RADIUS)
  state.player.y = clamp(state.player.y, top, bottom)
}

function updateRollingItems(state: GameState, dt: number) {
  const friction = Math.pow(0.05, dt)
  const update = (item: RollingItem) => {
    item.x += item.vx * dt
    item.y += item.vy * dt
    item.vx *= friction
    item.vy *= friction
    if (item.x < 24 || item.x > state.width - 24) item.vx *= -0.55
    if (item.y < 96 || item.y > state.height - 128) item.vy *= -0.55
    item.x = clamp(item.x, 24, state.width - 24)
    item.y = clamp(item.y, 96, state.height - 128)
  }

  state.lemons.forEach(update)
  state.leaves.forEach(update)
}

function collectItems(state: GameState) {
  const keptLemons: RollingItem[] = []
  state.lemons.forEach((lemon) => {
    if (distance(lemon.x, lemon.y, state.player.x, state.player.y) < PICKUP_RADIUS) {
      state.inventory.lemons += 1
      state.inventory.score += SCORE_PICKUP
      state.stats.lemonsCollected += 1
      state.events.push({ type: 'pickupLemon', x: lemon.x, y: lemon.y })
    } else {
      keptLemons.push(lemon)
    }
  })
  state.lemons = keptLemons

  const keptLeaves: RollingItem[] = []
  state.leaves.forEach((leaf) => {
    if (distance(leaf.x, leaf.y, state.player.x, state.player.y) < PICKUP_RADIUS) {
      state.inventory.leaves += 1
      state.inventory.score += SCORE_PICKUP
      state.stats.leavesCollected += 1
      state.events.push({ type: 'pickupLeaf', x: leaf.x, y: leaf.y })
    } else {
      keptLeaves.push(leaf)
    }
  })
  state.leaves = keptLeaves
}

function updateEffects(state: GameState, dt: number) {
  state.effects.forEach((effect) => {
    effect.ttl -= dt
  })
  state.effects = state.effects.filter((effect) => effect.ttl > 0)
}

function addSplat(state: GameState, x: number, y: number, size: number) {
  state.effects.push({ id: state.nextId++, x, y, ttl: 0.44, maxTtl: 0.44, size })
}

function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
