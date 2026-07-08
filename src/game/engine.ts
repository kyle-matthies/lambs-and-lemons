import type { GameAssets } from './assets'

export type GamePhase = 'ready' | 'playing' | 'ended'
export type RoundMinutes = 1 | 2 | 3 | 4 | 5

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
  sold: number
  lemons: number
  juice: number
  leaves: number
  nearStand: boolean
  canSell: boolean
}

export interface BestRound {
  sold: number
  score: number
}

type Inventory = {
  lemons: number
  juice: number
  leaves: number
  sold: number
  score: number
}

type Player = {
  x: number
  y: number
  facingX: number
  facingY: number
  swingTimer: number
  swingCooldown: number
}

type Lemon = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

type Leaf = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

type Tree = {
  id: number
  x: number
  y: number
  health: number
  broken: boolean
}

type Effect = {
  id: number
  x: number
  y: number
  ttl: number
  maxTtl: number
  size: number
}

export interface GameState {
  width: number
  height: number
  phase: GamePhase
  roundMinutes: RoundMinutes
  timeLeft: number
  player: Player
  stand: { x: number; y: number }
  trees: Tree[]
  lemons: Lemon[]
  leaves: Leaf[]
  effects: Effect[]
  inventory: Inventory
  nextId: number
}

const PLAYER_RADIUS = 28
const PICKUP_RADIUS = 31
const SELL_RADIUS = 96
const LEMONS_PER_CUP = 3
const LEAVES_PER_CUP = 1

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

  const lemons: Lemon[] = [
    [0.36, 0.42],
    [0.61, 0.45],
    [0.47, 0.56],
    [0.77, 0.58],
    [0.25, 0.63],
    [0.39, 0.74],
    [0.68, 0.76],
    [0.55, 0.67],
  ].map(([x, y]) => ({
    id: id(),
    x: x * safeWidth,
    y: y * safeHeight,
    vx: 0,
    vy: 0,
  }))

  const leaves: Leaf[] = [
    [0.31, 0.5],
    [0.53, 0.5],
    [0.73, 0.48],
    [0.2, 0.55],
    [0.42, 0.64],
    [0.59, 0.61],
    [0.75, 0.68],
    [0.28, 0.75],
  ].map(([x, y]) => ({
    id: id(),
    x: x * safeWidth,
    y: y * safeHeight,
    vx: 0,
    vy: 0,
  }))

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
    health: 3,
    broken: false,
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
    inventory: {
      lemons: 0,
      juice: 0,
      leaves: 0,
      sold: 0,
      score: 0,
    },
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

  if (state.phase !== 'playing') {
    updateEffects(state, dt)
    return
  }

  state.timeLeft = Math.max(0, state.timeLeft - dt)
  if (state.timeLeft <= 0) {
    state.phase = 'ended'
    return
  }

  if (input.active) {
    const speed = 185
    player.x += input.x * speed * dt
    player.y += input.y * speed * dt
    if (Math.abs(input.x) + Math.abs(input.y) > 0.08) {
      player.facingX = input.x
      player.facingY = input.y
    }
    clampPlayer(state)
  }

  updateRollingItems(state, dt)
  collectItems(state)
  updateEffects(state, dt)
}

export function swingHammer(state: GameState) {
  if (state.phase !== 'playing' || state.player.swingCooldown > 0) return

  const player = state.player
  player.swingTimer = 0.32
  player.swingCooldown = 0.2
  const length = Math.hypot(player.facingX, player.facingY) || 1
  const aimX = player.facingX / length
  const aimY = player.facingY / length
  const hitX = player.x + aimX * 58
  const hitY = player.y + aimY * 58
  let hitSomething = false

  const smashedIds = new Set<number>()
  state.lemons.forEach((lemon) => {
    if (
      distance(lemon.x, lemon.y, hitX, hitY) < 74 ||
      distance(lemon.x, lemon.y, player.x, player.y) < 48
    ) {
      smashedIds.add(lemon.id)
      state.inventory.score += 1
      state.inventory.juice += 1
      addSplat(state, lemon.x, lemon.y, 72)
      hitSomething = true
    }
  })
  state.lemons = state.lemons.filter((lemon) => !smashedIds.has(lemon.id))

  state.trees.forEach((tree) => {
    if (tree.broken || distance(tree.x, tree.y, hitX, hitY) >= 96) return

    tree.health -= 1
    hitSomething = true
    addSplat(state, tree.x, tree.y - 20, 92)
    if (tree.health <= 0) {
      tree.broken = true
      state.inventory.score += 2
      dropFromTree(state, tree)
    }
  })

  if (!hitSomething) {
    addSplat(state, hitX, hitY, 46)
  }
}

export function sellLemonade(state: GameState) {
  if (!canSell(state)) return false

  let lemonPartsNeeded = LEMONS_PER_CUP
  const juiceUsed = Math.min(state.inventory.juice, lemonPartsNeeded)
  state.inventory.juice -= juiceUsed
  lemonPartsNeeded -= juiceUsed
  state.inventory.lemons -= lemonPartsNeeded
  state.inventory.leaves -= LEAVES_PER_CUP
  state.inventory.sold += 1
  addSplat(state, state.stand.x, state.stand.y + 28, 62)
  return true
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
    canSell: canSell(state),
  }
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
    y: state.stand.y + 52,
    draw: () =>
      drawSprite(context, assets.stand, state.stand.x, state.stand.y, 126 * scale, 118 * scale),
  })

  state.trees.forEach((tree) => {
    drawables.push({
      y: tree.y + 54,
      draw: () =>
        drawSprite(
          context,
          tree.broken ? assets.stump : assets.tree,
          tree.x,
          tree.y,
          (tree.broken ? 100 : 122) * scale,
          (tree.broken ? 92 : 132) * scale,
        ),
    })
  })

  state.lemons.forEach((lemon) => {
    drawables.push({
      y: lemon.y + 15,
      draw: () => drawSprite(context, assets.lemon, lemon.x, lemon.y, 34 * scale, 34 * scale),
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
      drawSprite(
        context,
        swinging ? assets.lambSwing : assets.lambIdle,
        state.player.x,
        state.player.y,
        (swinging ? 122 : 82) * scale,
        (swinging ? 92 : 88) * scale,
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

function canSell(state: GameState) {
  return (
    state.phase === 'playing' &&
    isNearStand(state) &&
    state.inventory.lemons + state.inventory.juice >= LEMONS_PER_CUP &&
    state.inventory.leaves >= LEAVES_PER_CUP
  )
}

function isNearStand(state: GameState) {
  return distance(state.player.x, state.player.y, state.stand.x, state.stand.y) < SELL_RADIUS
}

function clampPlayer(state: GameState) {
  const top = Math.max(88, state.height * 0.1)
  const bottom = state.height - Math.max(118, state.height * 0.13)
  state.player.x = clamp(state.player.x, PLAYER_RADIUS, state.width - PLAYER_RADIUS)
  state.player.y = clamp(state.player.y, top, bottom)
}

function updateRollingItems(state: GameState, dt: number) {
  const friction = Math.pow(0.05, dt)
  const update = (item: Lemon | Leaf) => {
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
  const keptLemons: Lemon[] = []
  state.lemons.forEach((lemon) => {
    if (distance(lemon.x, lemon.y, state.player.x, state.player.y) < PICKUP_RADIUS) {
      state.inventory.lemons += 1
      state.inventory.score += 1
      addSplat(state, lemon.x, lemon.y, 42)
    } else {
      keptLemons.push(lemon)
    }
  })
  state.lemons = keptLemons

  const keptLeaves: Leaf[] = []
  state.leaves.forEach((leaf) => {
    if (distance(leaf.x, leaf.y, state.player.x, state.player.y) < PICKUP_RADIUS) {
      state.inventory.leaves += 1
      state.inventory.score += 1
      addSplat(state, leaf.x, leaf.y, 34)
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

function dropFromTree(state: GameState, tree: Tree) {
  const lemonDrops = 4
  const leafDrops = 3

  for (let index = 0; index < lemonDrops; index += 1) {
    const angle = (Math.PI * 2 * index) / lemonDrops + Math.random() * 0.3
    state.lemons.push({
      id: state.nextId++,
      x: tree.x + Math.cos(angle) * 30,
      y: tree.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * (120 + Math.random() * 80),
      vy: Math.sin(angle) * (90 + Math.random() * 70),
    })
  }

  for (let index = 0; index < leafDrops; index += 1) {
    const angle = (Math.PI * 2 * index) / leafDrops + 0.5 + Math.random() * 0.4
    state.leaves.push({
      id: state.nextId++,
      x: tree.x + Math.cos(angle) * 30,
      y: tree.y + Math.sin(angle) * 24,
      vx: Math.cos(angle) * (90 + Math.random() * 70),
      vy: Math.sin(angle) * (90 + Math.random() * 60),
    })
  }
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

function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
