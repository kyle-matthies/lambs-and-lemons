import type { RoundMinutes } from './types'

/**
 * Tuning values. Everything is metres, seconds and m/s now that the simulation
 * lives in world space instead of canvas pixels.
 */

export const ROUND_OPTIONS: RoundMinutes[] = [1, 2, 3, 4, 5]

// Lammy
export const PLAYER_RADIUS = 0.55
export const PLAYER_SPEED = 7.2
/** Exponential approach rate toward the stick vector — higher is snappier. */
export const PLAYER_ACCEL_LAMBDA = 13
export const PLAYER_TURN_LAMBDA = 15
/** Distance travelled per footfall, used to pace the gait and footstep sounds. */
export const FOOTSTEP_STRIDE = 1.15

// Smashing
export const SWING_TIME = 0.34
export const SWING_COOLDOWN = 0.16
/** How far ahead of the lamb the mallet lands. */
export const SWING_REACH = 1.5
export const SMASH_RADIUS = 2.0
/** Lemons right under Lammy's hooves count too, so smashing never feels finicky. */
export const SMASH_BODY_RADIUS = 1.25
export const TREE_HIT_RADIUS = 2.5

// Physics
export const GRAVITY = 24
export const ITEM_RESTITUTION = 0.42
/** Exponential ground drag for rolling fruit. */
export const ITEM_DRAG_LAMBDA = 3.2
export const ITEM_REST_SPEED = 0.35

// Pickups
export const PICKUP_RADIUS = 1.15
export const SELL_RADIUS = 3.4

// Trees
export const TREE_COUNT = 15
export const TREE_HEALTH = 3
export const TREE_RESPAWN_TIME = 6
export const TREE_REGROW_TIME = 0.75
export const TREE_WOBBLE_TIME = 0.55
export const BURST_PER_HIT = { lemons: 2, leaves: 1 }
export const BURST_ON_BREAK = { lemons: 5, leaves: 3 }

// Ambient spawning keeps the meadow lively between tree hits.
export const LEMON_SPAWN_INTERVAL = 2.1
export const LEAF_SPAWN_INTERVAL = 3.2
export const MAX_GROUND_LEMONS = 22
export const MAX_GROUND_LEAVES = 14

// Lemonade stand: auto-brews while Lammy stands close and carries lemon parts.
// A leaf (when available) upgrades the cup to a double-value sparkle cup.
export const BREW_TIME = 0.7
export const LEMON_PARTS_PER_CUP = 2

// Combo: quick consecutive hits build a streak. Bonuses only, never a penalty.
export const COMBO_WINDOW = 1.4
export const COMBO_MIN_LEVEL = 3

// Zest — the colour a smash pours back into the valley.
export const ZEST_RADIUS_SMASH = 3.6
export const ZEST_RADIUS_TREE_HIT = 4.4
export const ZEST_RADIUS_TREE_BREAK = 7.5
export const ZEST_RADIUS_CUP = 9

// Scoring
export const SCORE_PICKUP = 1
export const SCORE_SMASH = 1
export const SCORE_TREE_HIT = 2
export const SCORE_CUP = 5
export const SCORE_SPARKLE_CUP = 10
export const SCORE_COMBO_BONUS = 1

export const COUNTDOWN_TICKS_FROM = 5
