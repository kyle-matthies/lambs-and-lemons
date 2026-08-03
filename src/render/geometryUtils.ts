import { BufferAttribute, Color, type BufferGeometry } from 'three'
import { clamp01 } from '../core/math'
import type { Rng } from '../core/rng'

/**
 * Helpers for the procedural prop pipeline.
 *
 * Every mesh in the valley is merged from primitives, and the merge only works if
 * all the parts share an identical attribute set. `dress`/`paint` guarantee that:
 * position + normal + uv + colour + `aSway` (the wind weight the shared shader
 * reads, 0 at the root and 1 at the tips).
 */

/** Per-vertex colour with a little brightness jitter, plus a wind weight ramp. */
export function dress(
  geometry: BufferGeometry,
  color: Color,
  swayFor: (y: number) => number,
  rng: Rng,
  variation = 0.07,
) {
  const position = geometry.attributes.position as BufferAttribute
  const count = position.count
  const colors = new Float32Array(count * 3)
  const sway = new Float32Array(count)
  const shade = new Color()

  for (let index = 0; index < count; index += 1) {
    // A touch of per-vertex brightness noise keeps large blobs from going plastic.
    const jitter = 1 + (rng() - 0.5) * variation
    shade.copy(color).multiplyScalar(jitter)
    colors[index * 3] = shade.r
    colors[index * 3 + 1] = shade.g
    colors[index * 3 + 2] = shade.b
    sway[index] = clamp01(swayFor(position.getY(index)))
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('aSway', new BufferAttribute(sway, 1))
  ensureUv(geometry)
  return geometry
}

/** Flat colour, constant wind weight — for hard-surface props like the stand. */
export function paint(geometry: BufferGeometry, color: Color, sway = 0) {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  const sways = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
    sways[index] = sway
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('aSway', new BufferAttribute(sways, 1))
  ensureUv(geometry)
  return geometry
}

export function ensureUv(geometry: BufferGeometry) {
  if (geometry.attributes.uv) return geometry
  const count = geometry.attributes.position.count
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
  return geometry
}

/** Crumple a sphere/icosahedron with cheap trig noise so nothing reads as a ball. */
export function crumple(
  geometry: BufferGeometry,
  amount: number,
  frequency: number,
  rng: Rng,
) {
  const position = geometry.attributes.position as BufferAttribute
  const seed = rng() * 100
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const wobble =
      Math.sin(x * frequency + seed) * Math.cos(z * frequency * 1.3 - seed) +
      Math.sin(y * frequency * 0.8 + seed * 2) * 0.6
    const scale = 1 + wobble * amount
    position.setXYZ(index, x * scale, y * scale, z * scale)
  }
  geometry.computeVertexNormals()
  return geometry
}
