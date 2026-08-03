import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { clamp01, smoothstep } from '../core/math'
import { createNoise2D, fbm } from '../core/noise'
import { mulberry32, randRange } from '../core/rng'
import type { World } from '../game/world'
import { PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * Instanced meadow grass — one draw call for the whole field.
 *
 * Each blade is a four-segment tapered strip carrying an `aSway` weight that ramps
 * from 0 at the root to 1 at the tip, which the shared wind shader uses to bend it.
 * Blades also flatten away from Lammy as she runs through them, which does more for
 * the sense of "this is a real place" than any amount of texture detail.
 */

const BLADE_SEGMENTS = 4
/**
 * Blades per instance. Grouping them into a tuft triples apparent density for the
 * same instance count and matrix upload — the difference between "a field" and
 * "some spikes stuck in mud".
 */
const BLADES_PER_TUFT = 3

function createTuftGeometry() {
  const rows = BLADE_SEGMENTS + 1
  const perBlade = rows * 2 - 1 // the tip collapses to a single point
  const vertexCount = perBlade * BLADES_PER_TUFT

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const colors = new Float32Array(vertexCount * 3)
  const sway = new Float32Array(vertexCount)
  const indices: number[] = []

  // Deliberately greyscale: the geometry only carries the root→tip *lighting*
  // gradient. Hue comes from the per-instance colour, so the two never multiply
  // into mud.
  const root = new Color(0.58, 0.58, 0.58)
  const tip = new Color(0.98, 0.98, 0.98)
  const shade = new Color()
  const normal = new Vector3()

  let cursor = 0
  const rng = mulberry32(0xb1ade)

  for (let blade = 0; blade < BLADES_PER_TUFT; blade += 1) {
    const base = cursor
    // Each blade in the tuft gets its own heading, lean and height.
    const heading = (blade / BLADES_PER_TUFT) * Math.PI * 2 + randRange(rng, -0.4, 0.4)
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    const height = randRange(rng, 0.74, 1)
    const arc = randRange(rng, 0.14, 0.34)
    const offsetX = cos * randRange(rng, 0, 0.19)
    const offsetZ = sin * randRange(rng, 0, 0.19)
    const bright = randRange(rng, 0.88, 1.12)

    // Tilt the blade normal outward and up so grass catches sky light instead of
    // going black edge-on — the standard stylised-grass cheat, and it reads well.
    normal.set(sin * 0.55, 0.78, cos * 0.55).normalize()

    const push = (across: number, t: number) => {
      // Blades curve over as they rise rather than standing bolt upright.
      const lean = arc * t * t
      positions[cursor * 3] = offsetX + across * cos + lean * sin
      positions[cursor * 3 + 1] = t * height
      positions[cursor * 3 + 2] = offsetZ - across * sin + lean * cos
      normals[cursor * 3] = normal.x
      normals[cursor * 3 + 1] = normal.y
      normals[cursor * 3 + 2] = normal.z
      uvs[cursor * 2] = across + 0.5
      uvs[cursor * 2 + 1] = t
      shade.copy(root).lerp(tip, t * t * 0.7 + t * 0.3).multiplyScalar(bright)
      colors[cursor * 3] = shade.r
      colors[cursor * 3 + 1] = shade.g
      colors[cursor * 3 + 2] = shade.b
      // Cubic ramp keeps the base planted while the tip whips.
      sway[cursor] = t * t * (0.35 + 0.65 * t)
      cursor += 1
    }

    for (let row = 0; row < rows; row += 1) {
      const t = row / BLADE_SEGMENTS
      const halfWidth = 0.1 * (1 - t * 0.5) * (1 - t * 0.34)
      if (row === BLADE_SEGMENTS) {
        push(0, t)
      } else {
        push(-halfWidth, t)
        push(halfWidth, t)
      }
    }

    for (let row = 0; row < BLADE_SEGMENTS - 1; row += 1) {
      const a = base + row * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const lastPair = base + (BLADE_SEGMENTS - 1) * 2
    indices.push(lastPair, lastPair + 2, lastPair + 1)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('aSway', new BufferAttribute(sway, 1))
  geometry.setIndex(indices)
  return geometry
}

export interface GrassOptions {
  /** Number of tufts; each draws BLADES_PER_TUFT blades. */
  tufts: number
  radius: number
}

export function createGrass(world: World, options: GrassOptions, uniforms: ValleyUniforms) {
  const geometry = createTuftGeometry()
  const material = new MeshStandardMaterial({
    vertexColors: true,
    side: DoubleSide,
    roughness: 0.92,
    metalness: 0,
  })
  applyValleyShading(material, uniforms, {
    wind: 0.32,
    swayAttribute: true,
    phaseAttribute: true,
    playerBend: 1.7,
    bloom: true,
    rim: 1.35,
  })

  const mesh = new InstancedMesh(geometry, material, options.tufts)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.name = 'grass'

  const rng = mulberry32(world.seed ^ 0x6ea55)
  const noise = createNoise2D(mulberry32(world.seed ^ 0x11f7))
  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const normal = { x: 0, y: 1, z: 0 }
  const tint = new Color()
  const phases = new Float32Array(options.tufts)

  let placed = 0
  let attempts = 0
  const maxAttempts = options.tufts * 12

  while (placed < options.tufts && attempts < maxAttempts) {
    attempts += 1
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * options.radius
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

    // Density mask: thick in the meadow, thinning out over the dry rim.
    const density =
      (1 - smoothstep(world.playRadius * 0.9, world.playRadius * 1.3, radius)) *
      (0.55 + 0.45 * (fbm(noise, x * 0.09, z * 0.09, { octaves: 2 }) * 0.5 + 0.5))
    if (rng() > density) continue

    world.normalAt(x, z, normal)
    if (normal.y < 0.72) continue

    const y = world.heightAt(x, z)
    // Nothing grows in the pond — where there is one.
    if (world.pond) {
      const pondDistance = Math.hypot(x - world.pond.x, z - world.pond.z)
      if (pondDistance < world.pond.radius * 0.95 && y < world.waterLevel + 0.25) continue
    }

    position.set(x, y - 0.03, z)
    quaternion.setFromAxisAngle(up, rng() * Math.PI * 2)
    // The tuft is modelled in units of its own height, so one uniform scale keeps
    // blade width, spread and arc in proportion.
    const height = randRange(rng, 0.24, 0.44) * (0.78 + density * 0.35)
    scale.setScalar(height)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(placed, matrix)

    // Subtle per-blade hue drift stops the field reading as one flat green.
    const hueDrift = fbm(noise, x * 0.045 + 90, z * 0.045 - 30, { octaves: 2 })
    tint
      .copy(PALETTE.grassDeep)
      .lerp(PALETTE.grassMid, clamp01(0.5 + hueDrift * 1.1))
      .lerp(PALETTE.grassLight, clamp01(hueDrift * 0.8) * 0.5)
      .lerp(PALETTE.grassDry, clamp01(smoothstep(world.playRadius * 0.8, world.playRadius * 1.2, radius)) * 0.55)

    mesh.setColorAt(placed, tint)

    phases[placed] = rng() * Math.PI * 2
    placed += 1
  }

  mesh.count = placed
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  // Per-instance wind phase, so neighbouring blades don't ripple in lockstep.
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1))

  return mesh
}
