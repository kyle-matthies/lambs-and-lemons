import type { Objective } from './types'
import type { GroveRecipe } from './world'

/**
 * The journey — five places along the way home, each its own recipe.
 *
 * The rule this file follows is that a chapter is *data*. Nothing here knows
 * about three.js, the DOM, or the renderer: a place is a width, a rim profile,
 * some water or none, and a handful of scatter counts. That is deliberate. It
 * means a new place costs a paragraph rather than a system, and it means the bot
 * in `scripts/simulate.mjs` can play every chapter without a GPU.
 */

export interface Chapter {
  id: string
  /** Shown on the map and the chapter card. */
  title: string
  /** One line of what this place is, read before you arrive. */
  blurb: string
  seed: number
  recipe: GroveRecipe
  /** How many creatures are lost here. Small at first, everyone at the end. */
  critters: number
  objectives: Objective[]
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'home-meadow',
    title: 'Home Meadow',
    blurb: 'Where Lammy lives. Small, soft, and only a little bit grey.',
    seed: 10_010,
    // Cosy: you can see the whole place from the middle of it. Low rounded hills,
    // no water to walk around, and more flowers than anywhere else — this is the
    // chapter that teaches the loop, so nothing should be in the way of it.
    recipe: {
      playRadius: 20,
      rim: { start: 0.78, end: 1.75, height: 5, rock: 0.9 },
      terrain: { rolling: 1.05, dimple: 0.3 },
      pond: null,
      stand: { x: 0.5, z: 6.5 },
      scatter: { trees: 6, treeSpacing: 5.4, bushes: 30, rocks: 10, flowers: 240, reeds: 0 },
    },
    critters: 3,
    objectives: [
      { kind: 'smash', count: 8 },
      { kind: 'brew', count: 2 },
      { kind: 'freeCount', count: 3 },
    ],
  },
  {
    id: 'pond-hollow',
    title: 'The Pond Hollow',
    blurb: 'Reeds, still water, and someone hiding on the far bank.',
    seed: 20_020,
    // The water is nearly central and far too wide to cross, so every trip is a
    // decision about which way round. Reeds are the signature of the place.
    recipe: {
      playRadius: 28,
      rim: { start: 0.86, end: 1.55, height: 6.5, rock: 1.6 },
      terrain: { rolling: 1.3, dimple: 0.42 },
      pond: { x: -4, z: -3.5, radius: 11.5, depth: 2.8 },
      stand: { x: 3, z: 12 },
      scatter: { trees: 11, treeSpacing: 6.4, bushes: 52, rocks: 22, flowers: 150, reeds: 190 },
    },
    critters: 6,
    objectives: [
      { kind: 'freeCount', count: 4 },
      // Water counts toward coverage but can never take colour, and the pond is
      // a sixth of this meadow — so the target is set below what it looks like.
      { kind: 'bloom', target: 0.42 },
    ],
  },
  {
    id: 'old-orchard',
    title: 'The Old Orchard',
    blurb: 'Someone planted these in rows, long ago. There is fruit everywhere.',
    seed: 30_030,
    // Planted ground: level underfoot, and trunks close enough that you lose
    // sight of where you are going. Lemons are abundant, so the chapter is about
    // the trees themselves rather than about scarcity.
    recipe: {
      playRadius: 30,
      rim: { start: 0.9, end: 1.6, height: 7, rock: 1.8 },
      terrain: { rolling: 0.95, dimple: 0.24 },
      pond: { x: 14.5, z: -12, radius: 4, depth: 1.6 },
      stand: { x: 1.5, z: 11.5 },
      scatter: { trees: 34, treeSpacing: 4.2, bushes: 30, rocks: 14, flowers: 120, reeds: 40 },
    },
    critters: 7,
    objectives: [
      { kind: 'freeCount', count: 5 },
      { kind: 'breakTrees', count: 10 },
    ],
  },
  {
    id: 'grey-ridge',
    title: 'The Grey Ridge',
    blurb: 'Bare stone and hardly a lemon tree. The hardest walk of the journey.',
    seed: 40_040,
    // The hills come in close and go up high, the ground is broken, and there is
    // almost nothing growing. Every lemon has to be worked for, which is what
    // makes this the chapter you remember.
    recipe: {
      playRadius: 26,
      rim: { start: 0.62, end: 1.4, height: 13, rock: 5.5 },
      terrain: { rolling: 2.6, dimple: 0.55 },
      pond: null,
      stand: { x: 0, z: 9.5 },
      scatter: { trees: 7, treeSpacing: 7.5, bushes: 14, rocks: 95, flowers: 40, reeds: 0 },
    },
    critters: 7,
    objectives: [
      { kind: 'freeCount', count: 5 },
      // The ridge is the long one. Dry ground makes every cell reachable, so the
      // target can go high — and with seven trees on the whole hillside, the
      // lemons to do it with have to be hunted.
      { kind: 'bloom', target: 0.68 },
    ],
  },
  {
    id: 'sunset-hollow',
    title: 'Sunset Hollow',
    blurb: 'The last place, and the widest. Everyone is here.',
    seed: 50_050,
    // The payoff: the biggest meadow, the most of everything, and every creature
    // in the valley waiting in it.
    recipe: {
      playRadius: 32,
      rim: { start: 0.88, end: 1.65, height: 8.5, rock: 2.2 },
      terrain: { rolling: 1.6, dimple: 0.36 },
      pond: { x: -12.5, z: -11, radius: 8.5, depth: 2.4 },
      stand: { x: 2, z: 12 },
      scatter: { trees: 20, treeSpacing: 5.8, bushes: 60, rocks: 34, flowers: 260, reeds: 120 },
    },
    critters: 12,
    // One objective, and it is the one the whole journey has been about. A bloom
    // target here would only be a grind after the last friend is found — and it
    // would be redundant anyway, because waking the valley floods the colour to
    // every corner as the chapter ends.
    objectives: [{ kind: 'freeAll' }],
  },
]

export const FIRST_CHAPTER = CHAPTERS[0].id

export function chapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.id === id)
}

export function chapterIndex(id: string) {
  return CHAPTERS.findIndex((chapter) => chapter.id === id)
}

/** The chapter after this one, or undefined when the journey is over. */
export function nextChapter(id: string): Chapter | undefined {
  const index = chapterIndex(id)
  return index >= 0 ? CHAPTERS[index + 1] : undefined
}
