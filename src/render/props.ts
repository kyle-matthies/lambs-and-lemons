import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp01 } from '../core/math'
import { mulberry32, type Rng } from '../core/rng'
import { paint } from './geometryUtils'
import type { GroundItem } from '../game/types'
import { PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * Hand-built props: the lemonade stand, the fruit and leaves lying in the grass,
 * and the soft blob shadows that keep small objects visually planted.
 */

const UP = new Vector3(0, 1, 0)

// ---------------------------------------------------------------------------
// The lemonade stand
// ---------------------------------------------------------------------------

export function buildStandGeometry(seed = 1): BufferGeometry {
  const rng: Rng = mulberry32(seed)
  const parts: BufferGeometry[] = []

  const width = 1.9
  const depth = 0.85
  const counterHeight = 1.02

  // Counter top with a small lip.
  const top = new BoxGeometry(width, 0.1, depth)
  top.translate(0, counterHeight, 0)
  parts.push(paint(top, PALETTE.standWood.clone().multiplyScalar(1.12)))

  const lip = new BoxGeometry(width + 0.1, 0.07, depth + 0.1)
  lip.translate(0, counterHeight + 0.07, 0)
  parts.push(paint(lip, PALETTE.standWoodDark))

  // Front panel, made of planks so it reads as built rather than extruded.
  const plankCount = 5
  for (let index = 0; index < plankCount; index += 1) {
    const plank = new BoxGeometry(width / plankCount - 0.035, counterHeight - 0.16, 0.07)
    plank.translate(
      -width / 2 + (index + 0.5) * (width / plankCount),
      (counterHeight - 0.16) / 2 + 0.06,
      depth / 2,
    )
    const tone = PALETTE.standWood.clone().multiplyScalar(0.9 + rng() * 0.22)
    parts.push(paint(plank, tone))
  }

  // Legs.
  for (const [x, z] of [
    [-width / 2 + 0.12, depth / 2 - 0.1],
    [width / 2 - 0.12, depth / 2 - 0.1],
    [-width / 2 + 0.12, -depth / 2 + 0.1],
    [width / 2 - 0.12, -depth / 2 + 0.1],
  ]) {
    const leg = new BoxGeometry(0.11, counterHeight, 0.11)
    leg.translate(x, counterHeight / 2, z)
    parts.push(paint(leg, PALETTE.standWoodDark))
  }

  // Awning posts and a candy-striped canopy.
  const postHeight = 1.05
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) {
    const post = new CylinderGeometry(0.045, 0.05, postHeight, 6, 1)
    post.translate(x, counterHeight + postHeight / 2 + 0.08, -depth / 2 + 0.12)
    parts.push(paint(post, PALETTE.standWoodDark))
  }

  const stripes = 7
  const awningWidth = width + 0.34
  for (let index = 0; index < stripes; index += 1) {
    const stripe = new BoxGeometry(awningWidth / stripes, 0.06, depth + 0.5)
    stripe.rotateX(-0.24)
    stripe.translate(
      -awningWidth / 2 + (index + 0.5) * (awningWidth / stripes),
      counterHeight + postHeight + 0.14,
      -0.02,
    )
    parts.push(paint(stripe, index % 2 === 0 ? PALETTE.standCloth : PALETTE.standClothAlt, 0.12))
  }

  // Scalloped valance hanging off the front of the awning.
  for (let index = 0; index < 9; index += 1) {
    const scallop = new SphereGeometry(0.09, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)
    scallop.rotateX(Math.PI)
    scallop.scale(1, 1.25, 0.55)
    scallop.translate(
      -awningWidth / 2 + (index + 0.5) * (awningWidth / 9),
      counterHeight + postHeight + 0.22,
      depth / 2 + 0.2,
    )
    parts.push(paint(scallop, index % 2 === 0 ? PALETTE.standCloth : PALETTE.standClothAlt, 0.4))
  }

  // A big friendly lemon on the sign board.
  const board = new BoxGeometry(0.78, 0.44, 0.06)
  board.translate(0, counterHeight + postHeight + 0.62, -depth / 2 + 0.16)
  parts.push(paint(board, PALETTE.standClothAlt))

  const signLemon = new SphereGeometry(0.15, 10, 8)
  signLemon.scale(0.9, 1.15, 0.5)
  signLemon.translate(0, counterHeight + postHeight + 0.62, -depth / 2 + 0.1)
  parts.push(paint(signLemon, PALETTE.lemon))

  // Jug of lemonade and a stack of cups on the counter.
  const jug = new CylinderGeometry(0.14, 0.16, 0.32, 12, 1)
  jug.translate(-0.42, counterHeight + 0.27, 0)
  parts.push(paint(jug, PALETTE.juice))

  const jugRim = new TorusGeometry(0.145, 0.02, 6, 14)
  jugRim.rotateX(Math.PI / 2)
  jugRim.translate(-0.42, counterHeight + 0.44, 0)
  parts.push(paint(jugRim, PALETTE.standClothAlt))

  for (let index = 0; index < 3; index += 1) {
    const cup = new CylinderGeometry(0.055, 0.042, 0.1, 9, 1)
    cup.translate(0.4 + index * 0.13, counterHeight + 0.16 + index * 0.015, index * 0.04 - 0.04)
    parts.push(paint(cup, PALETTE.standClothAlt))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

export function createStand(uniforms: ValleyUniforms, detail: Texture) {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.78,
    metalness: 0,
  })
  applyValleyShading(material, uniforms, {
    wind: 0.05,
    swayAttribute: true,
    bloom: true,
    bloomFloor: 0.12,
    rim: 1,
  })

  const mesh = new Mesh(buildStandGeometry(), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'stand'
  return mesh
}

// ---------------------------------------------------------------------------
// Ground items
// ---------------------------------------------------------------------------

function buildLemonGeometry() {
  const body = new SphereGeometry(0.21, 12, 10)
  body.scale(0.84, 1.16, 0.84)
  // Nipples at both ends — the silhouette detail that makes a sphere read as a lemon.
  const tipTop = new ConeGeometry(0.055, 0.09, 7, 1)
  tipTop.translate(0, 0.245, 0)
  const tipBottom = new ConeGeometry(0.05, 0.07, 7, 1)
  tipBottom.rotateX(Math.PI)
  tipBottom.translate(0, -0.24, 0)

  const merged = mergeGeometries(
    [paint(body, PALETTE.lemon), paint(tipTop, PALETTE.lemonLight), paint(tipBottom, PALETTE.lemonLight)],
    false,
  )
  merged.computeBoundingSphere()
  return merged
}

function buildLeafGeometry() {
  const blade = new SphereGeometry(0.2, 9, 7)
  blade.scale(0.55, 0.08, 1)
  const stalk = new CylinderGeometry(0.012, 0.016, 0.16, 5, 1)
  stalk.rotateX(Math.PI / 2)
  stalk.translate(0, 0, -0.24)

  const merged = mergeGeometries([paint(blade, PALETTE.leafMid), paint(stalk, PALETTE.leafDeep)], false)
  merged.computeBoundingSphere()
  return merged
}

export interface ItemFieldOptions {
  capacity: number
  kind: 'lemon' | 'leaf'
}

/**
 * One instanced mesh per item kind, refreshed from the simulation each frame.
 * Items bob and spin, and lemons keep a colour floor so they stay bright even in
 * the parts of the valley that haven't been healed — they're the last colour left.
 */
export class ItemField {
  readonly mesh: InstancedMesh
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly tilt = new Quaternion()
  private readonly spin = new Quaternion()
  private readonly scale = new Vector3()

  constructor(options: ItemFieldOptions, uniforms: ValleyUniforms) {
    const geometry = options.kind === 'lemon' ? buildLemonGeometry() : buildLeafGeometry()
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: options.kind === 'lemon' ? 0.52 : 0.8,
      metalness: 0,
      side: options.kind === 'leaf' ? DoubleSide : undefined,
    })
    applyValleyShading(material, uniforms, {
      bloom: true,
      // Lemons are the last bright thing in a sour valley — never fully drained.
      bloomFloor: options.kind === 'lemon' ? 0.55 : 0.15,
      rim: options.kind === 'lemon' ? 1.5 : 1,
    })

    this.mesh = new InstancedMesh(geometry, material, options.capacity)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = false
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }

  sync(items: GroundItem[], time: number) {
    const count = Math.min(items.length, this.mesh.count === 0 ? items.length : items.length)
    const capacity = this.mesh.instanceMatrix.count
    const visible = Math.min(count, capacity)

    for (let index = 0; index < visible; index += 1) {
      const item = items[index]
      // A tiny hover + breathe makes resting fruit feel alive rather than dropped.
      const idle = item.resting ? Math.sin(time * 2.4 + item.id) * 0.02 : 0
      this.position.set(item.x, item.y + idle, item.z)
      this.spin.setFromAxisAngle(UP, item.spin)
      this.tilt.setFromAxisAngle(TILT_AXIS, item.resting ? 1.35 : item.spin * 0.6)
      this.quaternion.copy(this.spin).multiply(this.tilt)
      const pop = clamp01(item.age * 5)
      this.scale.setScalar(0.85 + pop * 0.15)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(index, this.matrix)
    }

    this.mesh.count = visible
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshStandardMaterial).dispose()
    this.mesh.dispose()
  }
}

const TILT_AXIS = new Vector3(1, 0, 0.35).normalize()

// ---------------------------------------------------------------------------
// Blob shadows
// ---------------------------------------------------------------------------

/**
 * Soft contact shadows for things too small or too numerous to justify a shadow
 * map entry. Rendered as unlit dark discs that hug the terrain.
 */
export function createBlobShadow(alphaMap: Texture, size = 1) {
  const material = new MeshBasicMaterial({
    color: 0x1a2b12,
    alphaMap,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  })
  const mesh = new Mesh(new PlaneGeometry(size, size), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 1
  return mesh
}

/** Additive glow sprite used for sparkle cups and the brew ring. */
export function createGlowSprite(alphaMap: Texture, color: Color, size = 1) {
  const material = new MeshBasicMaterial({
    color,
    alphaMap,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const mesh = new Mesh(new PlaneGeometry(size, size), material)
  mesh.renderOrder = 5
  return mesh
}

export function createPropGroup(name: string) {
  const group = new Group()
  group.name = name
  return group
}
