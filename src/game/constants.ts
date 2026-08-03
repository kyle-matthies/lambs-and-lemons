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
export const LEMON_PARTS_PER_CUP = 3

// Combo: quick consecutive hits build a streak. Bonuses only, never a penalty.
export const COMBO_WINDOW = 1.4
export const COMBO_MIN_LEVEL = 3

// The lost creatures of the valley.
export const CRITTER_COUNT = 12
export const CRITTER_KINDS = ['lamb', 'bunny', 'piglet'] as const
export const CRITTER_SPEED_LOST = 1.05
export const CRITTER_SPEED_FOLLOW = 8.4
export const CRITTER_WANDER_RADIUS = 3.4
/** Spacing between animals in the line trailing Lammy. */
export const CRITTER_FOLLOW_GAP = 1.35
/** How long the colour takes to flood back through a served critter. */
export const CRITTER_BLOOM_TIME = 1.1
export const SERVE_RADIUS = 2.1
/** Cups Lammy can carry at once. Small on purpose — it forces round trips. */
export const CUP_CAPACITY = 3

// The flock leaves colour behind it as it runs.
export const FLOCK_TRAIL_INTERVAL = 0.35
export const FLOCK_TRAIL_RADIUS = 3.2
/** Each freed friend helps a little: wider reach, quicker brewing. */
export const FLOCK_PICKUP_BONUS = 0.13
export const FLOCK_PICKUP_BONUS_CAP = 1.05
export const FLOCK_BREW_BONUS = 0.055
export const FLOCK_BREW_BONUS_CAP = 0.4

// Zest — the colour a smash pours back into the valley.
export const ZEST_RADIUS_SMASH = 4.2
export const ZEST_RADIUS_TREE_HIT = 4.4
export const ZEST_RADIUS_TREE_BREAK = 7.5
export const ZEST_RADIUS_CUP = 6.5
export const ZEST_RADIUS_BLOOM = 15

// Scoring
export const SCORE_PICKUP = 1
export const SCORE_SMASH = 1
export const SCORE_TREE_HIT = 2
export const SCORE_CUP = 5
export const SCORE_SPARKLE_CUP = 10
export const SCORE_BREW = 2
/** Waking the whole valley before sunset is worth more than any single act. */
export const SCORE_VALLEY_WOKE = 50
export const SCORE_COMBO_BONUS = 1

export const COUNTDOWN_TICKS_FROM = 5
