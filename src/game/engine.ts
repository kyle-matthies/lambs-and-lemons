import type { GameAssets } from './assets'
import { GAME_CONFIG } from './config'

export type GamePhase = 'ready' | 'playing' | 'ended'
export type RoundMinutes = 1 | 2 | 3 | 4 | 5
export type GameEvent =
  | 'smash-lemon'
  | 'pickup-lemon'
  | 'pickup-leaf'
  | 'tree-hit'
  | 'tree-break'
  | 'cup-sold'
  | 'round-end'

export interface GameInput {
  active: boolean
  x: number
  y: number
}

export interface GameSnapshot {
  phase: GamePhase
  roundMinutes: RoundMinutes
  timeLeft: number
  score: number
  cupsSold: number
  carriedLemons: number
  leaves: number
  lemonsSmashed: number
  lemonsPickedUp: number
  leavesPickedUp: number
  treeHits: number
  nearStand: boolean
  brewing: boolean
  brewProgress: number
}

export interface RoundResult {
  roundMinutes: RoundMinutes
  cupsSold: number
  score: number
  lemonsSmashed: number
  lemonsPickedUp: number
  leavesPickedUp: number
  treeHits: number
  date: string
}

type Player = {
  x: number
  y: number
  facingX: number
  facingY: number
  swingTimer: number
  swingCooldown: number
}

type GroundItem = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

type Tree = {
  x: number
  y: number
  health: number
  broken: boolean
  respawnTimer: number
  shakeTimer: number
}

type Effect = {
  id: number
  x: number
  y: number
  ttl: number
  maxTtl: number
  size: number
}

type Stats = {
  score: number
  cupsSold: number
  carriedLemons: number
  leaves: number
  lemonsSmashed: number
  lemonsPickedUp: number
  leavesPickedUp: number
  treeHits: number
}

export interface GameState {
  width: number
  height: number
  phase: GamePhase
  roundMinutes: RoundMinutes
  timeLeft: number
  player: Player
  stand: { x: number; y: number }
  tree: Tree
  lemons: GroundItem[]
  leaves: GroundItem[]
  effects: Effect[]
  stats: Stats
  brewProgress: number
  lemonSpawnTimer: number
  leafSpawnTimer: number
  nextId: number
  events: GameEvent[]
}

const initialLemonSpots = [
  [0.43, 0.46],
  [0.58, 0.5],
  [0.36, 0.61],
  [0.68, 0.62],
  [0.49, 0.72],
] as const

const initialLeafSpots = [
  [0.38, 0.54],
  [0.57, 0.58],
  [0.72, 0.48],
  [0.3, 0.74],
] as const

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
  const tree = { x: safeWidth * 0.27, y: safeHeight * 0.34 }
  const stand = { x: safeWidth * 0.76, y: safeHeight * 0.69 }

  return {
    width: safeWidth,
    height: safeHeight,
    phase,
    roundMinutes,
    timeLeft: roundMinutes * 60,
    player: {
      x: safeWidth * 0.5,
      y: safeHeight * 0.62,
      facingX: 1,
      facingY: 0,
      swingTimer: 0,
      swingCooldown: 0,
    },
    stand,
    tree: {
      ...tree,
      health: GAME_CONFIG.treeHitsToBreak,
      broken: false,
      respawnTimer: 0,
      shakeTimer: 0,
    },
    lemons: initialLemonSpots.map(([x, y]) => ({
      id: id(),
      x: x * safeWidth,
      y: y * safeHeight,
      vx: 0,
      vy: 0,
    })),
    leaves: initialLeafSpots.map(([x, y]) => ({
      id: id(),
      x: x * safeWidth,
      y: y * safeHeight,
      vx: 0,
      vy: 0,
    })),
    effects: [],
    stats: {
      score: 0,
      cupsSold: 0,
      carriedLemons: 0,
      leaves: 0,
      lemonsSmashed: 0,
      lemonsPickedUp: 0,
      leavesPickedUp: 0,
      treeHits: 0,
    },
    brewProgress: 0,
    lemonSpawnTimer: GAME_CONFIG.lemonSpawnSeconds,
    leafSpawnTimer: GAME_CONFIG.leafSpawnSeconds,
    nextId,
    events: [],
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
  scalePoint(state.tree)
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
  state.tree.shakeTimer = Math.max(0, state.tree.shakeTimer - dt)

  if (state.phase !== 'playing') {
    updateEffects(state, dt)
    return
  }

  state.timeLeft = Math.max(0, state.timeLeft - dt)
  if (state.timeLeft <= 0) {
    state.phase = 'ended'
    state.events.push('round-end')
    return
  }

  updateTree(state, dt)
  updateMovement(state, input, dt)
  updateRollingItems(state, dt)
  updateSpawns(state, dt)
  collectItems(state)
  brewAtStand(state, dt)
  updateEffects(state, dt)
}

export function swingHammer(state: GameState) {
  if (state.phase !== 'playing' || state.player.swingCooldown > 0) return

  const player = state.player
  player.swingTimer = GAME_CONFIG.swingSeconds
  player.swingCooldown = GAME_CONFIG.swingCooldownSeconds
  let hitSomething = false

  const smashedIds = new Set<number>()
  state.lemons.forEach((lemon) => {
    if (distance(lemon.x, lemon.y, player.x, player.y) <= GAME_CONFIG.smashRadius) {
      smashedIds.add(lemon.id)
      state.stats.lemonsSmashed += 1
      state.stats.score += 1
      addSplat(state, lemon.x, lemon.y, 70)
      state.events.push('smash-lemon')
      hitSomething = true
    }
  })
  state.lemons = state.lemons.filter((lemon) => !smashedIds.has(lemon.id))

  const leafIds = new Set<number>()
  state.leaves.forEach((leaf) => {
    if (distance(leaf.x, leaf.y, player.x, player.y) <= GAME_CONFIG.smashRadius * 0.72) {
      leafIds.add(leaf.id)
      state.stats.leaves += 1
      state.stats.leavesPickedUp += 1
      state.stats.score += 1
      state.events.push('pickup-leaf')
      hitSomething = true
    }
  })
  state.leaves = state.leaves.filter((leaf) => !leafIds.has(leaf.id))

  if (
    !state.tree.broken &&
    distance(state.tree.x, state.tree.y, player.x, player.y) <= GAME_CONFIG.treeHitRadius
  ) {
    hitTree(state)
    hitSomething = true
  }

  if (!hitSomething) {
    const length = Math.hypot(player.facingX, player.facingY) || 1
    addSplat(
      state,
      player.x + (player.facingX / length) * 46,
      player.y + (player.facingY / length) * 46,
      42,
    )
  }
}

export function takeSnapshot(state: GameState): GameSnapshot {
  return {
    phase: state.phase,
    roundMinutes: state.roundMinutes,
    timeLeft: state.timeLeft,
    score: state.stats.score,
    cupsSold: state.stats.cupsSold,
    carriedLemons: state.stats.carriedLemons,
    leaves: state.stats.leaves,
    lemonsSmashed: state.stats.lemonsSmashed,
    lemonsPickedUp: state.stats.lemonsPickedUp,
    leavesPickedUp: state.stats.leavesPickedUp,
    treeHits: state.stats.treeHits,
    nearStand: isNearStand(state),
    brewing: isNearStand(state) && state.stats.carriedLemons > 0,
    brewProgress: state.brewProgress,
  }
}

export function createRoundResult(state: GameState): RoundResult {
  return {
    roundMinutes: state.roundMinutes,
    cupsSold: state.stats.cupsSold,
    score: state.stats.score,
    lemonsSmashed: state.stats.lemonsSmashed,
    lemonsPickedUp: state.stats.lemonsPickedUp,
    leavesPickedUp: state.stats.leavesPickedUp,
    treeHits: state.stats.treeHits,
    date: new Date().toISOString(),
  }
}

export function drainEvents(state: GameState) {
  const events = [...state.events]
  state.events.length = 0
  return events
}

export function drawGame(
  context: CanvasRenderingContext2D,
  state: GameState,
  assets: GameAssets,
) {
  const { width, height } = state
  const scale = Math.max(0.82, Math.min(width / 390, height / 844))
  context.clearRect(0, 0, width, height)
  context.drawImage(assets.background, 0, 0, width, height)
  drawSprite(context, assets.sun, width * 0.02, height * 0.018, 74 * scale, 74 * scale)

  const drawables: { y: number; draw: () => void }[] = []

  drawables.push({
    y: state.tree.y + 58,
    draw: () => {
      const shake = state.tree.shakeTimer > 0 ? Math.sin(state.tree.shakeTimer * 90) * 5 : 0
      drawShadow(context, state.tree.x, state.tree.y + 55 * scale, 94 * scale, 24 * scale)
      drawSprite(
        context,
        state.tree.broken ? assets.stump : assets.tree,
        state.tree.x + shake,
        state.tree.y,
        (state.tree.broken ? 104 : 128) * scale,
        (state.tree.broken ? 94 : 146) * scale,
      )
    },
  })

  drawables.push({
    y: state.stand.y + 54,
    draw: () => {
      drawShadow(context, state.stand.x, state.stand.y + 56 * scale, 96 * scale, 20 * scale)
      drawSprite(context, assets.stand, state.stand.x, state.stand.y, 126 * scale, 118 * scale)
      if (state.brewProgress > 0 && state.phase === 'playing') {
        drawBrewMeter(context, state.stand.x, state.stand.y - 72 * scale, state.brewProgress, scale)
      }
    },
  })

  state.lemons.forEach((lemon) => {
    drawables.push({
      y: lemon.y + 15,
      draw: () => {
        drawShadow(context, lemon.x, lemon.y + 14 * scale, 25 * scale, 8 * scale)
        drawSprite(context, assets.lemon, lemon.x, lemon.y, 34 * scale, 34 * scale)
      },
    })
  })

  state.leaves.forEach((leaf) => {
    drawables.push({
      y: leaf.y + 13,
      draw: () => drawSprite(context, assets.leaf, leaf.x, leaf.y, 32 * scale, 28 * scale),
    })
  })

  drawables.push({
    y: state.player.y + 39,
    draw: () => {
      const swinging = state.player.swingTimer > 0
      drawShadow(context, state.player.x, state.player.y + 39 * scale, 58 * scale, 17 * scale)
      drawSprite(
        context,
        swinging ? assets.lambSwing : assets.lambIdle,
        state.player.x,
        state.player.y,
        (swinging ? 124 : 82) * scale,
        (swinging ? 94 : 88) * scale,
        state.player.facingX < -0.1,
      )
    },
  })

  drawables
    .sort((a, b) => a.y - b.y)
    .forEach((drawable) => {
      drawable.draw()
    })

  state.effects.forEach((effect) => {
    context.save()
    context.globalAlpha = Math.max(0, effect.ttl / effect.maxTtl)
    drawSprite(context, assets.splat, effect.x, effect.y, effect.size * scale, effect.size * scale)
    context.restore()
  })
}

function updateTree(state: GameState, dt: number) {
  if (!state.tree.broken) return
  state.tree.respawnTimer = Math.max(0, state.tree.respawnTimer - dt)
  if (state.tree.respawnTimer > 0) return
  state.tree.broken = false
  state.tree.health = GAME_CONFIG.treeHitsToBreak
  state.tree.shakeTimer = 0.18
}

function updateMovement(state: GameState, input: GameInput, dt: number) {
  if (!input.active) return
  const player = state.player
  player.x += input.x * GAME_CONFIG.playerSpeed * dt
  player.y += input.y * GAME_CONFIG.playerSpeed * dt
  if (Math.abs(input.x) + Math.abs(input.y) > 0.08) {
    player.facingX = input.x
    player.facingY = input.y
  }
  clampPlayer(state)
}

function updateRollingItems(state: GameState, dt: number) {
  const friction = Math.pow(0.04, dt)
  const update = (item: GroundItem) => {
    item.x += item.vx * dt
    item.y += item.vy * dt
    item.vx *= friction
    item.vy *= friction
    if (item.x < 24 || item.x > state.width - 24) item.vx *= -0.55
    if (item.y < getTopBound(state) || item.y > getBottomBound(state)) item.vy *= -0.55
    item.x = clamp(item.x, 24, state.width - 24)
    item.y = clamp(item.y, getTopBound(state), getBottomBound(state))
  }

  state.lemons.forEach(update)
  state.leaves.forEach(update)
}

function updateSpawns(state: GameState, dt: number) {
  state.lemonSpawnTimer -= dt
  state.leafSpawnTimer -= dt

  if (state.lemonSpawnTimer <= 0) {
    state.lemonSpawnTimer += GAME_CONFIG.lemonSpawnSeconds
    spawnLemon(state, randomFieldPoint(state), 0)
  }

  if (state.leafSpawnTimer <= 0) {
    state.leafSpawnTimer += GAME_CONFIG.leafSpawnSeconds
    spawnLeaf(state, randomPointNear(state, state.tree.x, state.tree.y, 160), 0)
  }
}

function collectItems(state: GameState) {
  const keptLemons: GroundItem[] = []
  state.lemons.forEach((lemon) => {
    if (distance(lemon.x, lemon.y, state.player.x, state.player.y) < GAME_CONFIG.pickupRadius) {
      state.stats.carriedLemons += 1
      state.stats.lemonsPickedUp += 1
      state.stats.score += 1
      addSplat(state, lemon.x, lemon.y, 36)
      state.events.push('pickup-lemon')
    } else {
      keptLemons.push(lemon)
    }
  })
  state.lemons = keptLemons

  const keptLeaves: GroundItem[] = []
  state.leaves.forEach((leaf) => {
    if (distance(leaf.x, leaf.y, state.player.x, state.player.y) < GAME_CONFIG.pickupRadius) {
      state.stats.leaves += 1
      state.stats.leavesPickedUp += 1
      state.stats.score += 1
      state.events.push('pickup-leaf')
    } else {
      keptLeaves.push(leaf)
    }
  })
  state.leaves = keptLeaves
}

function brewAtStand(state: GameState, dt: number) {
  if (!isNearStand(state) || state.stats.carriedLemons <= 0) {
    state.brewProgress = 0
    return
  }

  state.brewProgress += dt / GAME_CONFIG.brewSeconds
  while (state.brewProgress >= 1 && state.stats.carriedLemons > 0) {
    state.brewProgress -= 1
    state.stats.carriedLemons -= 1
    state.stats.cupsSold += 1
    state.events.push('cup-sold')
    addSplat(state, state.stand.x, state.stand.y + 22, 48)
  }
}

function updateEffects(state: GameState, dt: number) {
  state.effects.forEach((effect) => {
    effect.ttl -= dt
  })
  state.effects = state.effects.filter((effect) => effect.ttl > 0)
}

function hitTree(state: GameState) {
  state.tree.health -= 1
  state.tree.shakeTimer = 0.4
  state.stats.treeHits += 1
  state.stats.score += GAME_CONFIG.treePointsPerHit
  state.events.push('tree-hit')
  addSplat(state, state.tree.x, state.tree.y - 18, 76)

  const breaking = state.tree.health <= 0
  const lemonDrops = breaking ? 4 : 2
  const leafDrops = breaking ? 3 : 1
  for (let index = 0; index < lemonDrops; index += 1) {
    spawnLemon(state, randomPointNear(state, state.tree.x, state.tree.y + 28, 82), 165)
  }
  for (let index = 0; index < leafDrops; index += 1) {
    spawnLeaf(state, randomPointNear(state, state.tree.x, state.tree.y + 22, 92), 135)
  }

  if (!breaking) return
  state.tree.broken = true
  state.tree.respawnTimer = GAME_CONFIG.treeRespawnSeconds
  state.events.push('tree-break')
}

function spawnLemon(state: GameState, point: { x: number; y: number }, kick = 0) {
  if (state.lemons.length >= GAME_CONFIG.maxGroundLemons) return
  const angle = Math.random() * Math.PI * 2
  state.lemons.push({
    id: state.nextId++,
    x: point.x,
    y: point.y,
    vx: Math.cos(angle) * kick,
    vy: Math.sin(angle) * kick,
  })
}

function spawnLeaf(state: GameState, point: { x: number; y: number }, kick = 0) {
  if (state.leaves.length >= GAME_CONFIG.maxLeaves) return
  const angle = Math.random() * Math.PI * 2
  state.leaves.push({
    id: state.nextId++,
    x: point.x,
    y: point.y,
    vx: Math.cos(angle) * kick,
    vy: Math.sin(angle) * kick,
  })
}

function isNearStand(state: GameState) {
  return distance(state.player.x, state.player.y, state.stand.x, state.stand.y) < 88
}

function clampPlayer(state: GameState) {
  state.player.x = clamp(state.player.x, GAME_CONFIG.playerRadius, state.width - GAME_CONFIG.playerRadius)
  state.player.y = clamp(state.player.y, getTopBound(state), getBottomBound(state))
}

function randomFieldPoint(state: GameState) {
  return {
    x: randomBetween(state.width * 0.14, state.width * 0.86),
    y: randomBetween(getTopBound(state) + 30, getBottomBound(state) - 20),
  }
}

function randomPointNear(state: GameState, x: number, y: number, radius: number) {
  const angle = Math.random() * Math.PI * 2
  const distanceFromCenter = Math.random() * radius
  return {
    x: clamp(x + Math.cos(angle) * distanceFromCenter, 28, state.width - 28),
    y: clamp(y + Math.sin(angle) * distanceFromCenter, getTopBound(state), getBottomBound(state)),
  }
}

function getTopBound(state: GameState) {
  return Math.max(118, state.height * 0.14)
}

function getBottomBound(state: GameState) {
  return state.height - Math.max(174, state.height * 0.2)
}

function addSplat(state: GameState, x: number, y: number, size: number) {
  state.effects.push({
    id: state.nextId++,
    x,
    y,
    ttl: 0.44,
    maxTtl: 0.44,
    size,
  })
}

function drawSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  flip = false,
) {
  context.save()
  if (flip) {
    context.translate(x, y)
    context.scale(-1, 1)
    context.drawImage(image, -width / 2, -height / 2, width, height)
  } else {
    context.drawImage(image, x - width / 2, y - height / 2, width, height)
  }
  context.restore()
}

function drawShadow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save()
  context.fillStyle = 'rgba(51, 85, 21, 0.18)'
  context.beginPath()
  context.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawBrewMeter(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  scale: number,
) {
  const width = 76 * scale
  const height = 10 * scale
  const radius = height / 2
  context.save()
  context.fillStyle = 'rgba(255, 255, 255, 0.82)'
  roundedRect(context, x - width / 2, y, width, height, radius)
  context.fill()
  context.fillStyle = '#45d638'
  roundedRect(context, x - width / 2, y, width * clamp(progress, 0, 1), height, radius)
  context.fill()
  context.strokeStyle = 'rgba(74, 42, 18, 0.22)'
  context.lineWidth = 1
  roundedRect(context, x - width / 2, y, width, height, radius)
  context.stroke()
  context.restore()
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
