/**
 * Seeded randomness. Every grove is generated from a seed so the same valley
 * looks identical on every device and across reloads — terrain, tree placement,
 * grass scatter and flower colours all pull from here rather than Math.random.
 */

export type Rng = () => number

/** mulberry32 — tiny, fast, good enough distribution for world generation. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randRange(rng: Rng, min: number, max: number) {
  return min + rng() * (max - min)
}

export function randInt(rng: Rng, min: number, max: number) {
  return Math.floor(randRange(rng, min, max + 1))
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

