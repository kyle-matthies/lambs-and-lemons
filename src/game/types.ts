import type { BloomField } from './bloom'
import type { GroveLayout, World } from './world'

export type GamePhase = 'ready' | 'playing' | 'ended'
export type RoundMinutes = 1 | 2 | 3 | 4 | 5

/** How a round finished: ran out of light, or woke the whole valley. */
export type RoundOutcome = 'sunset' | 'valleyWoke'

export type CritterKind = 'lamb' | 'bunny' | 'piglet'
export type CritterState = 'lost' | 'blooming' | 'follower'

/**
 * Normalized stick vector in *screen* space: x is right, y is up-the-screen
 * (so y = -1 means "away from the camera"). The engine maps it to world XZ.
 */
export interface GameInput {
  active: boolean
  x: number
  y: number
}

export type GameEvent =
  | { type: 'smash'; x: number; y: number; z: number }
  | { type: 'whiff'; x: number; y: number; z: number }
  | { type: 'treeHit'; x: number; y: number; z: number; health: number }
  | { type: 'treeBreak'; x: number; y: number; z: number }
  | { type: 'treeRegrow'; x: number; y: number; z: number }
  | { type: 'pickupLemon'; x: number; y: number; z: number }
  | { type: 'pickupLeaf'; x: number; y: number; z: number }
  | { type: 'cupBrewed'; x: number; y: number; z: number; sparkle: boolean }
  | {
      type: 'critterServed'
      x: number
      y: number
      z: number
      kind: CritterKind
      sparkle: boolean
    }
  | { type: 'flockJoin'; x: number; y: number; z: number; size: number }
  | { type: 'valleyWoke'; x: number; y: number; z: number }
  | { type: 'combo'; x: number; y: number; z: number; level: number }
  | { type: 'footstep'; x: number; y: number; z: number }
  /** A burst of colour poured back into the valley — drives the bloom map. */
  | { type: 'zest'; x: number; z: number; radius: number; strength: number }
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'timeUp' }

export interface Player {
  x: number
  y: number
  z: number
  vx: number
  vz: number
  /** Yaw in radians, three.js convention: 0 faces +Z. */
  facing: number
  /** Planar speed in m/s, cached for the animation layer. */
  speed: number
  swingTimer: number
  swingCooldown: number
  /** Monotonic walk-cycle phase; the renderer reads it for the gait. */
  gait: number
  footstepPhase: number
}

export interface GroundItem {
  id: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  spin: number
  spinSpeed: number
  resting: boolean
  age: number
}

export type TreeStage = 'full' | 'broken'

export interface Tree {
  id: number
  x: number
  y: number
  z: number
  rotation: number
  scale: number
  variant: number
  health: number
  stage: TreeStage
  respawnTimer: number
  regrowTimer: number
  wobbleTimer: number
  /** Direction the canopy rocks after a hit, in radians. */
  wobbleAngle: number
}

export interface Inventory {
  lemons: number
  juice: number
  leaves: number
  /** Cups brewed and carried, waiting to be given to someone. */
  cups: number
  /** How many of the carried cups are the double-value sparkle kind. */
  sparkleCups: number
  /** Creatures served — the old "cups sold" number, now an act of kindness. */
  sold: number
  score: number
}

export interface Critter {
  id: number
  kind: CritterKind
  x: number
  y: number
  z: number
  homeX: number
  homeZ: number
  facing: number
  state: CritterState
  speed: number
  wanderTimer: number
  targetX: number
  targetZ: number
  bloomTimer: number
  /** Position in the line behind Lammy; -1 while still lost. */
  followIndex: number
  gait: number
  trailTimer: number
  /** Stable 0-1 value for per-critter colour and size variation. */
  hue: number
}

export interface RoundStats {
  lemonsSmashed: number
  treeHits: number
  treesBroken: number
  lemonsCollected: number
  leavesCollected: number
  cupsSold: number
  sparkleCups: number
  crittersFreed: number
}

export interface GameState {
  world: World
  layout: GroveLayout
  phase: GamePhase
  roundMinutes: RoundMinutes
  timeLeft: number
  /** Seconds since the round began — animation phases hang off this. */
  elapsed: number
  player: Player
  stand: { x: number; y: number; z: number; rotation: number }
  trees: Tree[]
  lemons: GroundItem[]
  leaves: GroundItem[]
  critters: Critter[]
  flockSize: number
  /** Authoritative, headless mirror of the colour painted back into the valley. */
  bloomField: BloomField
  /** Fraction of the meadow that has colour again, 0-1. */
  bloomCoverage: number
  outcome: RoundOutcome | null
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
  cups: number
  sparkleCups: number
  nearStand: boolean
  brewing: boolean
  brewProgress: number
  combo: number
  flockSize: number
  lostCritters: number
  bloomCoverage: number
  /** A lost critter is within serving range and Lammy is carrying a cup. */
  canServe: boolean
  outcome: RoundOutcome | null
  stats: RoundStats
}

export interface BestRound {
  sold: number
  score: number
}
