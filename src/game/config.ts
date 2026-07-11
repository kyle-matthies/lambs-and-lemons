import type { RoundMinutes } from './engine'

export const ROUND_OPTIONS: RoundMinutes[] = [1, 2, 3, 4, 5]
export const DEFAULT_ROUND_MINUTES: RoundMinutes = 2

export const GAME_CONFIG = {
  playerRadius: 28,
  playerSpeed: 205,
  pickupRadius: 34,
  smashRadius: 72,
  swingSeconds: 0.26,
  swingCooldownSeconds: 0.32,
  treeHitRadius: 96,
  treeHitsToBreak: 3,
  treeRespawnSeconds: 5.5,
  treePointsPerHit: 2,
  brewSeconds: 0.65,
  maxGroundLemons: 8,
  lemonSpawnSeconds: 2.1,
  maxLeaves: 6,
  leafSpawnSeconds: 3.2,
  leaderboardKey: 'lambs-and-lemons-leaderboard-v2',
  maxLeaderboardEntries: 8,
} as const
