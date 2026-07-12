import type { RoundMinutes } from './types'

export const ROUND_OPTIONS: RoundMinutes[] = [1, 2, 3, 4, 5]

export const PLAYER_RADIUS = 28
export const PLAYER_SPEED = 185
export const PICKUP_RADIUS = 31
export const SELL_RADIUS = 96

// Smashing
export const SWING_TIME = 0.32
export const SWING_COOLDOWN = 0.2
export const SWING_REACH = 58
export const SMASH_RADIUS = 82
export const SMASH_BODY_RADIUS = 48
export const TREE_HIT_RADIUS = 96

// Trees (ported pacing from the Replit prototype)
export const TREE_HEALTH = 3
export const TREE_RESPAWN_TIME = 5.5
export const TREE_REGROW_POP = 0.4
export const TREE_WOBBLE_TIME = 0.45
export const BURST_PER_HIT = { lemons: 2, leaves: 1 }
export const BURST_ON_BREAK = { lemons: 4, leaves: 3 }

// Ambient spawning keeps the field lively
export const LEMON_SPAWN_INTERVAL = 2.1
export const LEAF_SPAWN_INTERVAL = 3.2
export const MAX_GROUND_LEMONS = 9
export const MAX_GROUND_LEAVES = 6

// Lemonade stand: auto-brew while standing close and carrying lemons.
// A leaf (when available) upgrades the cup to a double-value sparkle cup.
export const BREW_TIME = 0.7
export const LEMON_PARTS_PER_CUP = 2

// Combo: quick consecutive hits build a streak. Bonuses only, never a penalty.
export const COMBO_WINDOW = 1.2
export const COMBO_MIN_LEVEL = 3

// Scoring
export const SCORE_PICKUP = 1
export const SCORE_SMASH = 1
export const SCORE_TREE_HIT = 2
export const SCORE_CUP = 5
export const SCORE_SPARKLE_CUP = 10
export const SCORE_COMBO_BONUS = 1

export const COUNTDOWN_TICKS_FROM = 5
