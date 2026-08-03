import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp01 } from '../core/math'
import { crumple, dress } from './geometryUtils'
import { mulberry32, randRange, type Rng } from '../core/rng'
import type { ScatterPoint, World } from '../game/world'
import { FLOWER_COLORS, PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * Everything that grows. All of it is generated at boot from primitives — tapered
 * bent trunks, clustered canopy blobs, hanging fruit, noise-crumpled rocks — then
 * merged so a whole tree is a single draw call and the small props are instanced.
 *
 * Each vertex carries an `aSway` weight (0 rooted, 1 whipping) that the shared wind
 * shader reads, so a gust moves the canopy, the bushes and the reeds as one system.
 */

const UP = new Vector3(0, 1, 0)

// ---------------------------------------------------------------------------
// Lemon trees
// ---------------------------------------------------------------------------

export interface TreeGeometrySet {
  full: BufferGeometry
  stump: BufferGeometry
}

function buildTrunk(rng: Rng, height: number, lean: number, totalHeight: number) {
  const geometry = new CylinderGeometry(0.16, 0.34, height, 9, 6)
  geometry.translate(0, height / 2, 0)

  // Bend the trunk into a gentle S so it looks grown rather than extruded.
  const position = geometry.attributes.position as BufferAttribute
  const twist = rng() * Math.PI * 2
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const t = y / height
    const bend = t * t * lean
    const wiggle = Math.sin(t * 4.2 + twist) * 0.06 * t
    position.setXYZ(index, x + Math.cos(twist) * bend + wiggle, y, z + Math.sin(twist) * bend)
  }
  geometry.computeVertexNormals()

  return dress(geometry, PALETTE.bark, (y) => Math.pow(clamp01(y / totalHeight), 2) * 0.42, rng)
}

function buildCanopy(rng: Rng, centre: Vector3, radius: number, totalHeight: number) {
  const parts: BufferGeometry[] = []
  const blobCount = 4 + Math.floor(rng() * 3)

  for (let index = 0; index < blobCount; index += 1) {
    const size = radius * randRange(rng, 0.62, 1)
    const blob = new SphereGeometry(size, 10, 8)
    crumple(blob, 0.11, 2.4, rng)
    // Squash slightly so the canopy reads as a cloud, not a bunch of marbles.
    blob.scale(1, randRange(rng, 0.74, 0.92), 1)

    const angle = (index / blobCount) * Math.PI * 2 + rng() * 0.7
    const spread = index === 0 ? 0 : radius * randRange(rng, 0.42, 0.78)
    const x = centre.x + Math.cos(angle) * spread
    const z = centre.z + Math.sin(angle) * spread
    const y = centre.y + randRange(rng, -0.28, 0.34) - (index === 0 ? 0 : spread * 0.16)
    blob.translate(x, y, z)

    const tone = rng()
    const color = PALETTE.leafMid
      .clone()
      .lerp(PALETTE.leafDeep, clamp01(0.55 - tone))
      .lerp(PALETTE.leafLight, clamp01(tone - 0.5) * 1.4)

    parts.push(
      dress(blob, color, (vertexY) => 0.5 + 0.5 * clamp01((vertexY - centre.y * 0.5) / totalHeight), rng, 0.12),
    )
  }

  return parts
}

function buildHangingLemons(rng: Rng, centre: Vector3, radius: number) {
  const parts: BufferGeometry[] = []
  const count = 5 + Math.floor(rng() * 5)

  for (let index = 0; index < count; index += 1) {
    const lemon = new SphereGeometry(randRange(rng, 0.14, 0.2), 8, 6)
    // Lemons are prolate: stretch along Y then nip the ends.
    lemon.scale(0.86, 1.18, 0.86)

    const angle = rng() * Math.PI * 2
    const dip = randRange(rng, 0.35, 0.95)
    const distance = radius * randRange(rng, 0.55, 1.02)
    lemon.translate(
      centre.x + Math.cos(angle) * distance,
      centre.y - dip,
      centre.z + Math.sin(angle) * distance,
    )
    parts.push(dress(lemon, PALETTE.lemon, () => 0.95, rng, 0.05))
  }

  return parts
}

export function buildTreeGeometry(seed: number, variant: number): TreeGeometrySet {
  const rng = mulberry32(seed * 7919 + variant * 104729)
  const trunkHeight = randRange(rng, 1.9, 2.5) + variant * 0.18
  const canopyRadius = randRange(rng, 1.12, 1.44)
  const centre = new Vector3(0, trunkHeight + canopyRadius * 0.55, 0)
  const totalHeight = centre.y + canopyRadius

  const parts: BufferGeometry[] = [
    buildTrunk(rng, trunkHeight, randRange(rng, -0.22, 0.22), totalHeight),
    ...buildCanopy(rng, centre, canopyRadius, totalHeight),
    ...buildHangingLemons(rng, centre, canopyRadius),
  ]

  const full = mergeGeometries(parts, false)
  full.computeBoundingSphere()

  // The stump left behind after a break: a splintered stub with hopeful shoots.
  const stumpRng = mulberry32(seed * 104729 + variant)
  const stumpParts: BufferGeometry[] = []
  const stub = new CylinderGeometry(0.3, 0.38, 0.52, 9, 2)
  stub.translate(0, 0.26, 0)
  stumpParts.push(dress(stub, PALETTE.barkDark, () => 0, stumpRng))

  const top = new CylinderGeometry(0.29, 0.29, 0.06, 9, 1)
  top.translate(0, 0.54, 0)
  stumpParts.push(dress(top, PALETTE.bark.clone().multiplyScalar(1.18), () => 0, stumpRng))

  for (let index = 0; index < 3; index += 1) {
    const shoot = new ConeGeometry(0.1, 0.36, 5, 1)
    const angle = (index / 3) * Math.PI * 2 + stumpRng()
    shoot.rotateZ(randRange(stumpRng, -0.5, 0.5))
    shoot.translate(Math.cos(angle) * 0.18, 0.72, Math.sin(angle) * 0.18)
    stumpParts.push(dress(shoot, PALETTE.leafLight, (y) => clamp01((y - 0.5) * 2), stumpRng))
  }

  const stump = mergeGeometries(stumpParts, false)
  stump.computeBoundingSphere()

  return { full, stump }
}

export function createFoliageMaterial(uniforms: ValleyUniforms, detail: Texture) {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.82,
    metalness: 0,
  })
  applyValleyShading(material, uniforms, {
    wind: 0.16,
    swayAttribute: true,
    phaseAttribute: true,
    bloom: true,
    rim: 1,
  })
  return material
}

// ---------------------------------------------------------------------------
// Instanced scatter props
// ---------------------------------------------------------------------------

interface ScatterMeshOptions {
  points: ScatterPoint[]
  geometry: BufferGeometry
  material: MeshStandardMaterial
  world: World
  /** Align the prop with the ground normal instead of standing bolt upright. */
  alignToGround?: boolean
  colorFor?: (point: ScatterPoint, index: number) => Color
  castShadow?: boolean
}

function buildScatterMesh(options: ScatterMeshOptions) {
  const { points, geometry, material, world } = options
  const mesh = new InstancedMesh(geometry, material, Math.max(1, points.length))
  mesh.count = points.length
  mesh.castShadow = options.castShadow ?? false
  mesh.receiveShadow = true
  mesh.frustumCulled = false

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const tilt = new Quaternion()
  const spin = new Quaternion()
  const scale = new Vector3()
  const normal = new Vector3()
  const groundNormal = { x: 0, y: 1, z: 0 }
  const phases = new Float32Array(Math.max(1, points.length))

  points.forEach((point, index) => {
    position.set(point.x, point.y, point.z)
    spin.setFromAxisAngle(UP, point.rotation)
    if (options.alignToGround) {
      world.normalAt(point.x, point.z, groundNormal)
      normal.set(groundNormal.x, groundNormal.y, groundNormal.z)
      tilt.setFromUnitVectors(UP, normal)
      quaternion.copy(tilt).multiply(spin)
    } else {
      quaternion.copy(spin)
    }
    scale.setScalar(point.scale)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
    if (options.colorFor) mesh.setColorAt(index, options.colorFor(point, index))
    phases[index] = point.rotation * 3.1 + index * 0.37
  })

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1))
  return mesh
}

export function createBushes(
  world: World,
  points: ScatterPoint[],
  uniforms: ValleyUniforms,
  detail: Texture,
) {
  const rng = mulberry32(world.seed ^ 0xb05e)
  const parts: BufferGeometry[] = []
  for (let index = 0; index < 3; index += 1) {
    const blob = new SphereGeometry(randRange(rng, 0.42, 0.6), 9, 7)
    crumple(blob, 0.16, 3.1, rng)
    blob.scale(1, randRange(rng, 0.68, 0.86), 1)
    const angle = (index / 3) * Math.PI * 2
    blob.translate(Math.cos(angle) * 0.3, randRange(rng, 0.3, 0.46), Math.sin(angle) * 0.3)
    const color = PALETTE.leafDeep.clone().lerp(PALETTE.leafMid, rng())
    parts.push(dress(blob, color, (y) => clamp01(y / 1.1) * 0.8, rng, 0.14))
  }

  const geometry = mergeGeometries(parts, false)
  geometry.computeBoundingSphere()

  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.88,
    metalness: 0,
  })
  applyValleyShading(material, uniforms, {
    wind: 0.1,
    swayAttribute: true,
    phaseAttribute: true,
    bloom: true,
    rim: 1,
  })

  return buildScatterMesh({ points, geometry, material, world, castShadow: true })
}

export function createRocks(world: World, points: ScatterPoint[], uniforms: ValleyUniforms) {
  const rng = mulberry32(world.seed ^ 0x0c4b)
  const geometry = new IcosahedronGeometry(0.45, 1)
  crumple(geometry, 0.26, 4.5, rng)
  geometry.scale(1.15, 0.78, 1)
  geometry.translate(0, 0.16, 0)
  // White base — the per-instance tint supplies the actual stone colour.
  dress(geometry, new Color(1, 1, 1), () => 0, rng, 0.16)

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  })
  applyValleyShading(material, uniforms, { bloom: true, rim: 0.7 })

  const tint = new Color()
  return buildScatterMesh({
    points,
    geometry,
    material,
    world,
    alignToGround: true,
    castShadow: true,
    colorFor: (point) => tint.copy(PALETTE.rock).lerp(PALETTE.rockDark, (point.variant % 3) / 2.5),
  })
}

export function createFlowers(world: World, points: ScatterPoint[], uniforms: ValleyUniforms) {
  const rng = mulberry32(world.seed ^ 0xf10e)
  const parts: BufferGeometry[] = []

  const stem = new CylinderGeometry(0.012, 0.018, 0.26, 4, 1)
  stem.translate(0, 0.13, 0)
  parts.push(dress(stem, PALETTE.leafDeep, (y) => clamp01(y / 0.32), rng, 0.05))

  // Five petals as a little ring of flattened spheres, plus a pollen dot.
  for (let index = 0; index < 5; index += 1) {
    const petal = new SphereGeometry(0.055, 6, 5)
    petal.scale(1, 0.42, 1.35)
    const angle = (index / 5) * Math.PI * 2
    petal.translate(Math.cos(angle) * 0.06, 0.28, Math.sin(angle) * 0.06)
    parts.push(dress(petal, new Color('#ffffff'), () => 1, rng, 0.02))
  }
  const pollen = new SphereGeometry(0.035, 6, 5)
  pollen.scale(1, 0.6, 1)
  pollen.translate(0, 0.295, 0)
  parts.push(dress(pollen, new Color('#ffd84a'), () => 1, rng, 0.02))

  const geometry = mergeGeometries(parts, false)
  geometry.computeBoundingSphere()

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0,
    side: DoubleSide,
  })
  applyValleyShading(material, uniforms, {
    wind: 0.14,
    swayAttribute: true,
    phaseAttribute: true,
    bloom: true,
    bloomFloor: 0.08,
    rim: 1.2,
  })

  return buildScatterMesh({
    points,
    geometry,
    material,
    world,
    colorFor: (point) => FLOWER_COLORS[point.variant % FLOWER_COLORS.length],
  })
}

export function createReeds(world: World, points: ScatterPoint[], uniforms: ValleyUniforms) {
  const rng = mulberry32(world.seed ^ 0x7eed)
  const parts: BufferGeometry[] = []

  for (let index = 0; index < 5; index += 1) {
    const height = randRange(rng, 0.7, 1.25)
    const blade = new ConeGeometry(0.035, height, 4, 3)
    blade.translate(0, height / 2, 0)
    const angle = rng() * Math.PI * 2
    blade.rotateZ(randRange(rng, -0.22, 0.22))
    blade.translate(Math.cos(angle) * 0.08, 0, Math.sin(angle) * 0.08)
    const color = PALETTE.leafDeep.clone().lerp(PALETTE.grassDry, rng() * 0.5)
    parts.push(dress(blade, color, (y) => clamp01(y / height), rng, 0.1))
  }

  const geometry = mergeGeometries(parts, false)
  geometry.computeBoundingSphere()

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    side: DoubleSide,
  })
  applyValleyShading(material, uniforms, {
    wind: 0.28,
    swayAttribute: true,
    phaseAttribute: true,
    bloom: true,
    rim: 1,
  })

  return buildScatterMesh({ points, geometry, material, world })
}
