/**
 * How much of the valley has its colour back.
 *
 * This lives in the simulation rather than the renderer on purpose: "the valley
 * is 62% awake" is a *game* fact — it drives the HUD, the round summary and the
 * weather — so it has to be deterministic and testable without a GPU. The
 * renderer paints the same splats into a texture for the shaders to sample; this
 * is the authoritative, headless mirror of that texture.
 */

/** Side length in metres of the square the bloom field covers. */
export const BLOOM_AREA = 96
export const BLOOM_ORIGIN = -BLOOM_AREA / 2

/** ~1.5 m per cell — far finer than the question needs. */
const RESOLUTION = 64
const CELL_SIZE = BLOOM_AREA / RESOLUTION

export interface BloomField {
  cells: Float32Array
  coverage: number
  dirty: boolean
}

export function createBloomField(): BloomField {
  return { cells: new Float32Array(RESOLUTION * RESOLUTION), coverage: 0, dirty: true }
}

export function resetBloomField(field: BloomField) {
  field.cells.fill(0)
  field.coverage = 0
  field.dirty = true
}

/**
 * Stamp a burst of colour. The falloff matches the renderer's splat shader
 * exactly, so the number on the HUD agrees with what the player can see.
 */
export function stampBloom(
  field: BloomField,
  x: number,
  z: number,
  radius: number,
  strength: number,
) {
  const minX = Math.max(0, Math.floor((x - radius - BLOOM_ORIGIN) / CELL_SIZE))
  const maxX = Math.min(RESOLUTION - 1, Math.ceil((x + radius - BLOOM_ORIGIN) / CELL_SIZE))
  const minZ = Math.max(0, Math.floor((z - radius - BLOOM_ORIGIN) / CELL_SIZE))
  const maxZ = Math.min(RESOLUTION - 1, Math.ceil((z + radius - BLOOM_ORIGIN) / CELL_SIZE))

  for (let gz = minZ; gz <= maxZ; gz += 1) {
    const worldZ = BLOOM_ORIGIN + (gz + 0.5) * CELL_SIZE
    for (let gx = minX; gx <= maxX; gx += 1) {
      const worldX = BLOOM_ORIGIN + (gx + 0.5) * CELL_SIZE
      const distance = Math.hypot(worldX - x, worldZ - z)
      if (distance > radius) continue
      const falloff = 1 - distance / radius
      const value = falloff * falloff * (0.55 + 0.45 * falloff) * strength
      const index = gz * RESOLUTION + gx
      const next = field.cells[index] + value
      field.cells[index] = next > 1 ? 1 : next
    }
  }
  field.dirty = true
}

/**
 * Fill the whole field. Used at the moment the valley wakes: the last cup should
 * push colour into every corner, not leave a feathered edge at the rim.
 */
export function floodBloom(field: BloomField) {
  field.cells.fill(1)
  field.dirty = true
}

/** Fraction of the playable meadow that has colour again, 0-1. Cached. */
export function bloomCoverage(field: BloomField, playRadius: number) {
  if (!field.dirty) return field.coverage

  let inside = 0
  let healed = 0
  for (let gz = 0; gz < RESOLUTION; gz += 1) {
    const worldZ = BLOOM_ORIGIN + (gz + 0.5) * CELL_SIZE
    for (let gx = 0; gx < RESOLUTION; gx += 1) {
      const worldX = BLOOM_ORIGIN + (gx + 0.5) * CELL_SIZE
      if (Math.hypot(worldX, worldZ) > playRadius) continue
      inside += 1
      healed += field.cells[gz * RESOLUTION + gx]
    }
  }

  field.coverage = inside === 0 ? 0 : healed / inside
  field.dirty = false
  return field.coverage
}
