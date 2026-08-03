import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three'
import { clamp01, smoothstep } from '../core/math'
import { createNoise2D, fbm } from '../core/noise'
import { mulberry32 } from '../core/rng'
import type { World } from '../game/world'
import { PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * The meadow floor.
 *
 * Built as a *radial* grid rather than a square one: rings are packed tightly near
 * the middle where Lammy actually runs and stretch out toward the rim, so we spend
 * vertices where the camera can see them. Heights come straight from
 * `World.heightAt`, which is also what the simulation collides against — the ground
 * you see is exactly the ground you walk on.
 *
 * Colour is baked per-vertex (grass / dry / rock / shore) and multiplied by a tiling
 * procedural detail texture, then run through the valley bloom shader.
 */

export interface TerrainOptions {
  rings: number
  segments: number
  maxRadius: number
}

export const TERRAIN_TIERS: Record<'low' | 'medium' | 'high', TerrainOptions> = {
  low: { rings: 56, segments: 84, maxRadius: 58 },
  medium: { rings: 80, segments: 120, maxRadius: 62 },
  high: { rings: 110, segments: 168, maxRadius: 68 },
}

export function createTerrain(
  world: World,
  options: TerrainOptions,
  uniforms: ValleyUniforms,
  detailTexture: Texture,
) {
  const { rings, segments, maxRadius } = options
  const noise = createNoise2D(mulberry32(world.seed ^ 0x51ab1e))

  const vertexCount = 1 + rings * segments
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const colors = new Float32Array(vertexCount * 3)

  const color = new Color()
  const shore = new Color()
  const normal = { x: 0, y: 1, z: 0 }

  const writeVertex = (index: number, x: number, z: number) => {
    const y = world.heightAt(x, z)
    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = z

    world.normalAt(x, z, normal)
    normals[index * 3] = normal.x
    normals[index * 3 + 1] = normal.y
    normals[index * 3 + 2] = normal.z

    // World-locked UVs so the detail texture never stretches on the outer rings.
    uvs[index * 2] = x * 0.085
    uvs[index * 2 + 1] = z * 0.085

    // --- vertex colour -------------------------------------------------------
    const patch = fbm(noise, x * 0.06, z * 0.06, { octaves: 3 }) * 0.5 + 0.5
    const fine = fbm(noise, x * 0.31, z * 0.31, { octaves: 2 }) * 0.5 + 0.5

    color.copy(PALETTE.grassDeep).lerp(PALETTE.grassMid, clamp01(patch * 1.25))
    // Sun-catching tips on the crowns of gentle rises.
    color.lerp(PALETTE.grassLight, clamp01((normal.y - 0.93) * 6) * 0.55 + fine * 0.18)

    // Warm, sun-bleached patches out in the meadow so it isn't one flat green.
    const warm = fbm(noise, x * 0.021 + 55, z * 0.021 - 12, { octaves: 2 }) * 0.5 + 0.5
    color.lerp(PALETTE.grassDry, clamp01(warm - 0.52) * 0.55)

    // Dry, sun-bleached grass creeping up the sheltering hills.
    const radius = Math.hypot(x, z)
    const dryness = smoothstep(world.playRadius * 0.86, world.playRadius * 1.35, radius)
    color.lerp(PALETTE.grassDry, dryness * 0.55 * (0.6 + patch * 0.6))

    // Rock breaks through wherever the slope gets too steep for soil.
    const steep = smoothstep(0.86, 0.58, normal.y)
    color.lerp(PALETTE.rock, steep * 0.85)
    color.lerp(PALETTE.rockDark, clamp01(steep - 0.55) * 0.7)

    // Damp shoreline ring around the pond.
    const pondDistance = Math.hypot(x - world.pond.x, z - world.pond.z)
    const nearWater = 1 - smoothstep(world.pond.radius * 0.7, world.pond.radius * 1.18, pondDistance)
    if (nearWater > 0) {
      const submerged = smoothstep(world.waterLevel + 0.35, world.waterLevel - 0.6, y)
      shore.copy(PALETTE.path).lerp(PALETTE.soil, submerged)
      color.lerp(shore, clamp01(nearWater * (0.35 + submerged * 0.65)))
    }

    // A worn dirt apron where the stand sits — it should look walked-on.
    for (const flat of world.flats) {
      const distance = Math.hypot(x - flat.x, z - flat.z)
      const worn = 1 - smoothstep(flat.radius * 0.55, flat.falloff, distance)
      if (worn > 0) color.lerp(PALETTE.path, worn * 0.62)
    }

    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }

  writeVertex(0, 0, 0)
  for (let ring = 1; ring <= rings; ring += 1) {
    // Non-linear ring spacing: dense in the meadow, coarse out on the hills.
    const radius = Math.pow(ring / rings, 1.55) * maxRadius
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2
      const index = 1 + (ring - 1) * segments + segment
      writeVertex(index, Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
  }

  const triangleCount = segments + (rings - 1) * segments * 2
  const indices = new Uint32Array(triangleCount * 3)
  let cursor = 0

  // Fan from the centre vertex to the first ring.
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments
    indices[cursor++] = 0
    indices[cursor++] = 1 + next
    indices[cursor++] = 1 + segment
  }

  for (let ring = 1; ring < rings; ring += 1) {
    const inner = 1 + (ring - 1) * segments
    const outer = 1 + ring * segments
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments
      const a = inner + segment
      const b = inner + next
      const c = outer + segment
      const d = outer + next
      indices[cursor++] = a
      indices[cursor++] = d
      indices[cursor++] = c
      indices[cursor++] = a
      indices[cursor++] = b
      indices[cursor++] = d
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: detailTexture,
    roughness: 0.96,
    metalness: 0,
  })
  applyValleyShading(material, uniforms, { bloom: true, rim: 0.35 })

  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.name = 'terrain'
  return mesh
}

