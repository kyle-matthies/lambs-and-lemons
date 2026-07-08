export type GamePhase = 'ready' | 'playing' | 'ended'
export type RoundMinutes = 1 | 2 | 3 | 4 | 5

export interface GameInput {
  active: boolean
  x: number
  y: number
}

export type GameEvent =
  | { type: 'smash'; x: number; y: number }
  | { type: 'whiff'; x: number; y: number }
  | { type: 'treeHit'; x: number; y: number }
  | { type: 'treeBreak'; x: number; y: number }
  | { type: 'treeRegrow'; x: number; y: number }
  | { type: 'pickupLemon'; x: number; y: number }
  | { type: 'pickupLeaf'; x: number; y: number }
  | { type: 'cupSold'; x: number; y: number; sparkle: boolean }
  | { type: 'combo'; x: number; y: number; level: number }
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'timeUp' }

export interface Player {
  x: number
  y: number
  facingX: number
  facingY: number
  swingTimer: number
  swingCooldown: number
}

export interface RollingItem {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

export type TreeStage = 'full' | 'broken'

export interface Tree {
  id: number
  x: number
  y: number
  health: number
  stage: TreeStage
  respawnTimer: number
  regrowTimer: number
  wobbleTimer: number
}

export interface Effect {
  id: number
  x: number
  y: number
  ttl: number
  maxTtl: number
  size: number
}

export interface Inventory {
  lemons: number
  juice: number
  leaves: number
  sold: number
  score: number
}

export interface RoundStats {
  lemonsSmashed: number
  treeHits: number
  treesBroken: number
  lemonsCollected: number
  leavesCollected: number
  cupsSold: number
  sparkleCups: number
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
  lemons: RollingItem[]
  leaves: RollingItem[]
  effects: Effect[]
  inventory: Inventory
  stats: RoundStats
  brewProgress: number
  comboCount: number
  comboTimer: number
  lemonSpawnTimer: number
  leafSpawnTimer: number
  lastWholeSecond: number
  events: GameEvent[]
  nextId: number
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
  brewing: boolean
  combo: number
  stats: RoundStats
}

export interface BestRound {
  sold: number
  score: number
}
