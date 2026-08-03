import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { angleDelta, clamp, clamp01, damp, lerp, smoothstep } from '../core/math'
import { mulberry32, randRange, type Rng } from '../core/rng'
import { PLAYER_SPEED, SWING_TIME } from '../game/constants'
import type { Player } from '../game/types'
import { paint } from './geometryUtils'
import { PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * Lammy.
 *
 * She's built from primitives — an ellipsoid body buried under a couple of dozen
 * wool puffs, a round head, floppy ears, four stubby legs and a mallet — and
 * animated entirely procedurally. No skeleton, no keyframes: every pose falls out
 * of the simulation state (speed, gait distance, turn rate, swing timer), which
 * means she never desyncs from what the game thinks is happening.
 *
 * The pieces that sell it are the small ones: squash-and-stretch synced to the
 * bounce, ears that lag half a beat behind the head on a spring, a body that leans
 * into turns, and a mallet swing with real anticipation before the strike.
 */

/** Metres of travel per complete four-beat gait cycle. */
const STRIDE_LENGTH = 1.55
const BODY_HEIGHT = 0.46

interface LegRig {
  pivot: Object3D
  phase: number
}

function woolMaterial(uniforms: ValleyUniforms, detail: Texture) {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.95,
    metalness: 0,
  })
  applyValleyShading(material, uniforms, {
    bloom: true,
    // Lammy carries her own colour into the sour parts of the valley.
    bloomFloor: 0.62,
    rim: 1.6,
  })
  return material
}

function buildBody(rng: Rng) {
  const parts: BufferGeometry[] = []

  const core = new SphereGeometry(0.34, 14, 11)
  core.scale(1, 0.88, 1.32)
  parts.push(paint(core, PALETTE.woolShade))

  // Wool puffs scattered over the ellipsoid surface — this is what makes her fluffy
  // rather than a potato. Fibonacci placement keeps the coverage even.
  const puffCount = 26
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < puffCount; index += 1) {
    const t = index / puffCount
    const inclination = Math.acos(1 - 2 * (t * 0.86 + 0.07))
    const azimuth = golden * index
    const radius = randRange(rng, 0.115, 0.175)
    const puff = new SphereGeometry(radius, 8, 6)

    const x = Math.sin(inclination) * Math.cos(azimuth) * 0.33
    const y = Math.cos(inclination) * 0.29
    const z = Math.sin(inclination) * Math.sin(azimuth) * 0.43
    puff.translate(x, y, z)
    // Top-lit puffs are brighter, which fakes ambient occlusion for free.
    const shade = PALETTE.wool.clone().multiplyScalar(0.9 + clamp01(y / 0.3 + 0.5) * 0.18)
    parts.push(paint(puff, shade))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildHead(rng: Rng) {
  const parts: BufferGeometry[] = []

  const skull = new SphereGeometry(0.2, 14, 11)
  skull.scale(1, 1.02, 0.95)
  parts.push(paint(skull, PALETTE.skin))

  // Woolly fringe across the brow.
  for (let index = 0; index < 7; index += 1) {
    const curl = new SphereGeometry(randRange(rng, 0.075, 0.105), 7, 6)
    const angle = -0.5 + (index / 6) * 1.9
    curl.translate(Math.cos(angle) * 0.16, 0.14 + Math.sin(angle) * 0.06, -0.02)
    parts.push(paint(curl, PALETTE.wool))
  }

  const muzzle = new SphereGeometry(0.115, 10, 8)
  muzzle.scale(1, 0.82, 1.05)
  muzzle.translate(0, -0.06, 0.16)
  parts.push(paint(muzzle, PALETTE.skin.clone().multiplyScalar(1.04)))

  const nose = new SphereGeometry(0.032, 7, 6)
  nose.scale(1.3, 0.8, 1)
  nose.translate(0, -0.035, 0.27)
  parts.push(paint(nose, new Color('#d98a86')))

  // Big storybook eyes: dark iris plus two offset catchlights.
  for (const side of [-1, 1]) {
    const eye = new SphereGeometry(0.055, 10, 8)
    eye.translate(side * 0.095, 0.035, 0.165)
    parts.push(paint(eye, new Color('#2b2118')))

    const glint = new SphereGeometry(0.021, 7, 6)
    glint.translate(side * 0.079, 0.062, 0.203)
    parts.push(paint(glint, new Color('#ffffff')))

    const glintSmall = new SphereGeometry(0.011, 6, 5)
    glintSmall.translate(side * 0.117, 0.012, 0.198)
    parts.push(paint(glintSmall, new Color('#ffffff')))

    const cheek = new SphereGeometry(0.04, 7, 6)
    cheek.scale(1.3, 0.75, 0.5)
    cheek.translate(side * 0.14, -0.035, 0.145)
    parts.push(paint(cheek, new Color('#ffb9ae')))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/**
 * Two lids that drop over the eyes for a blink.
 *
 * The eyes themselves are baked into the merged head, so they can't be animated
 * — but a pair of skin-coloured caps in front of them can, and a blink every few
 * seconds is the difference between a character and a doll.
 */
function buildEyelids() {
  const parts: BufferGeometry[] = []
  for (const side of [-1, 1]) {
    // Comfortably larger than the eye and sitting proud of it, so a closed lid
    // never leaves a sliver of iris showing through.
    const lid = new SphereGeometry(0.072, 10, 8)
    lid.scale(1, 1, 0.7)
    lid.translate(side * 0.095, 0.038, 0.178)
    parts.push(paint(lid, PALETTE.skin.clone().multiplyScalar(1.02)))
  }
  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildEar() {
  const ear = new SphereGeometry(0.09, 9, 7)
  ear.scale(1.55, 0.42, 0.85)
  // Pivot at the base so rotation reads as a flop, not a spin.
  ear.translate(0.13, 0, 0)
  return paint(ear, PALETTE.skin.clone().multiplyScalar(0.97))
}

function buildLeg() {
  const parts: BufferGeometry[] = []
  const leg = new CylinderGeometry(0.052, 0.062, 0.3, 8, 1)
  leg.translate(0, -0.15, 0)
  parts.push(paint(leg, PALETTE.wool))

  const hoof = new CylinderGeometry(0.062, 0.055, 0.075, 8, 1)
  hoof.translate(0, -0.325, 0)
  parts.push(paint(hoof, PALETTE.hoof))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildTail(rng: Rng) {
  const parts: BufferGeometry[] = []
  for (let index = 0; index < 3; index += 1) {
    const puff = new SphereGeometry(randRange(rng, 0.055, 0.075), 7, 6)
    puff.translate(0, -index * 0.045, -index * 0.02)
    parts.push(paint(puff, PALETTE.wool))
  }
  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildMallet() {
  const parts: BufferGeometry[] = []

  const handle = new CylinderGeometry(0.028, 0.032, 0.52, 8, 1)
  handle.translate(0, -0.26, 0)
  parts.push(paint(handle, PALETTE.malletHandle))

  const grip = new CylinderGeometry(0.036, 0.036, 0.12, 8, 1)
  grip.translate(0, -0.46, 0)
  parts.push(paint(grip, PALETTE.malletHandle.clone().multiplyScalar(0.75)))

  const head = new CylinderGeometry(0.115, 0.115, 0.3, 12, 1)
  head.rotateZ(Math.PI / 2)
  parts.push(paint(head, PALETTE.malletHead))

  for (const side of [-1, 1]) {
    const cap = new SphereGeometry(0.117, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    cap.rotateZ((side * Math.PI) / 2)
    cap.translate(side * 0.15, 0, 0)
    parts.push(paint(cap, PALETTE.malletHead.clone().multiplyScalar(0.94)))
  }

  const band = new CylinderGeometry(0.121, 0.121, 0.05, 12, 1)
  band.rotateZ(Math.PI / 2)
  parts.push(paint(band, PALETTE.standCloth))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/** Mallet swing arc: wind up, snap through, ease home. */
function swingAngle(t: number) {
  if (t < 0.28) {
    // Anticipation — the mallet lifts back and hangs for a beat.
    return lerp(0, -1.35, smoothstep(0, 1, t / 0.28))
  }
  if (t < 0.46) {
    // The strike. Fast and linear-ish so it reads as force.
    const k = (t - 0.28) / 0.18
    return lerp(-1.35, 1.62, k * k * (3 - 2 * k) * 0.55 + k * 0.45)
  }
  // Follow-through and recovery.
  return lerp(1.62, 0, smoothstep(0, 1, (t - 0.46) / 0.54))
}

export class Lamb {
  readonly group = new Group()

  private readonly body = new Group()
  private readonly bodyMesh: Mesh
  private readonly headPivot = new Group()
  private readonly eyelids: Mesh
  private readonly ears: Object3D[] = []
  private readonly legs: LegRig[] = []
  private readonly tail: Mesh
  private readonly armPivot = new Group()
  readonly malletMesh: Mesh

  private lean = 0
  private previousFacing = 0
  private blinkTimer = 2.5
  private blinkProgress = 0
  private cheerTimer = 0
  private earAngle = 0
  private earVelocity = 0
  private bounceMemory = 0

  constructor(uniforms: ValleyUniforms, detail: Texture) {
    const rng = mulberry32(0x1a3b)
    const material = woolMaterial(uniforms, detail)

    this.group.name = 'lammy'
    this.group.add(this.body)

    this.bodyMesh = new Mesh(buildBody(rng), material)
    this.bodyMesh.castShadow = true
    this.bodyMesh.position.y = BODY_HEIGHT
    this.body.add(this.bodyMesh)

    // Head hangs off the front of the torso.
    this.headPivot.position.set(0, BODY_HEIGHT + 0.19, 0.3)
    this.body.add(this.headPivot)

    const headMesh = new Mesh(buildHead(rng), material)
    headMesh.castShadow = true
    this.headPivot.add(headMesh)

    this.eyelids = new Mesh(buildEyelids(), material)
    this.eyelids.visible = false
    this.headPivot.add(this.eyelids)

    const earGeometry = buildEar()
    for (const side of [-1, 1]) {
      const pivot = new Group()
      pivot.position.set(side * 0.16, 0.045, 0.03)
      pivot.rotation.z = side * 0.25
      pivot.scale.x = side
      const mesh = new Mesh(earGeometry, material)
      mesh.castShadow = true
      pivot.add(mesh)
      this.headPivot.add(pivot)
      this.ears.push(pivot)
    }

    // Legs: front pair leads, diagonal pairs share a phase (a gentle trot).
    const legGeometry = buildLeg()
    const legSpots: [number, number, number][] = [
      [-0.17, 0.26, 0],
      [0.17, 0.26, Math.PI],
      [-0.17, -0.26, Math.PI],
      [0.17, -0.26, 0],
    ]
    for (const [x, z, phase] of legSpots) {
      const pivot = new Group()
      pivot.position.set(x, BODY_HEIGHT - 0.06, z)
      const mesh = new Mesh(legGeometry, material)
      mesh.castShadow = true
      pivot.add(mesh)
      this.body.add(pivot)
      this.legs.push({ pivot, phase })
    }

    this.tail = new Mesh(buildTail(rng), material)
    this.tail.castShadow = true
    this.tail.position.set(0, BODY_HEIGHT + 0.14, -0.42)
    this.body.add(this.tail)

    // The mallet rides on a shoulder pivot on her right side.
    this.armPivot.position.set(0.3, BODY_HEIGHT + 0.16, 0.06)
    this.body.add(this.armPivot)

    this.malletMesh = new Mesh(buildMallet(), material)
    this.malletMesh.castShadow = true
    this.malletMesh.position.set(0.12, 0.46, 0.06)
    this.malletMesh.rotation.z = -0.35
    this.armPivot.add(this.malletMesh)
  }

  /**
   * A little hop of delight. Called when Lammy hands someone a cup — the moment
   * the whole round is built around should show on her, not just in the HUD.
   */
  cheer(duration = 0.75) {
    this.cheerTimer = duration
  }

  /** World-space position of the mallet head — drives the swing trail and impacts. */
  getMalletTip<T extends { x: number; y: number; z: number }>(target: T) {
    this.malletMesh.updateWorldMatrix(true, false)
    const elements = this.malletMesh.matrixWorld.elements
    target.x = elements[12]
    target.y = elements[13]
    target.z = elements[14]
    return target
  }

  /**
   * Pose Lammy from a player state. Takes the `Player` rather than the whole
   * `GameState` so the stand scene can puppet her with a hand-made one.
   */
  update(player: Player, dt: number, time: number) {
    const speed01 = clamp01(player.speed / PLAYER_SPEED)

    this.group.position.set(player.x, player.y, player.z)
    this.group.rotation.y = player.facing

    // --- blink ----------------------------------------------------------------
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0 && this.blinkProgress <= 0) {
      this.blinkProgress = 1
      this.blinkTimer = 2.4 + Math.random() * 4
    }
    if (this.blinkProgress > 0) {
      // 0 -> 1 -> 0 over about a seventh of a second.
      this.blinkProgress = Math.max(0, this.blinkProgress - dt / 0.11)
      const closed = Math.sin(clamp01(1 - this.blinkProgress) * Math.PI)
      this.eyelids.visible = closed > 0.03
      this.eyelids.scale.set(1, Math.max(0.02, closed), 1)
    } else {
      this.eyelids.visible = false
    }

    // --- gait -----------------------------------------------------------------
    const gaitPhase = (player.gait / STRIDE_LENGTH) * Math.PI * 2
    const bounce = Math.abs(Math.sin(gaitPhase)) * 0.085 * speed01
    // Idle breathing keeps her alive when the player stops.
    const breathe = Math.sin(time * 1.9) * 0.012 * (1 - speed01)

    this.body.position.y = bounce + breathe

    // Squash on the down-beat, stretch at the apex. Volume-preserving-ish.
    const squash = 1 - Math.cos(gaitPhase * 2) * 0.055 * speed01 + breathe * 0.6
    const widen = 1 / Math.sqrt(Math.max(0.4, squash))
    this.bodyMesh.scale.set(widen, squash, widen)

    // --- lean -----------------------------------------------------------------
    const turnRate = dt > 0 ? angleDelta(this.previousFacing, player.facing) / dt : 0
    this.previousFacing = player.facing
    this.lean = damp(this.lean, clamp(-turnRate * 0.075, -0.4, 0.4), 9, dt)
    this.body.rotation.z = this.lean
    this.body.rotation.x = -0.19 * speed01

    // --- legs -----------------------------------------------------------------
    for (const leg of this.legs) {
      const swing = Math.sin(gaitPhase + leg.phase)
      // Legs tuck slightly on the forward reach so they don't clip the ground.
      leg.pivot.rotation.x = swing * 0.95 * speed01
      leg.pivot.position.y = BODY_HEIGHT - 0.06 + Math.max(0, swing) * 0.03 * speed01
    }

    // --- head and ears ---------------------------------------------------------
    this.headPivot.rotation.x = Math.sin(gaitPhase * 2 + 0.6) * 0.06 * speed01 - 0.05 * speed01
    this.headPivot.rotation.z = -this.lean * 0.45

    // Ears run on a damped spring driven by vertical acceleration, so they flop a
    // beat behind every bounce and settle with a little overshoot.
    const bounceAcceleration = (bounce - this.bounceMemory) / Math.max(dt, 1e-4)
    this.bounceMemory = bounce
    const stiffness = 130
    const damping = 13
    this.earVelocity +=
      (-this.earAngle * stiffness - this.earVelocity * damping - bounceAcceleration * 2.2) * dt
    this.earAngle += this.earVelocity * dt
    this.earAngle = clamp(this.earAngle, -0.7, 0.7)

    const idleTwitch = Math.sin(time * 0.7) > 0.985 ? 0.35 : 0
    this.ears.forEach((ear, index) => {
      const offset = index === 0 ? 0 : 0.35
      ear.rotation.z = 0.25 + this.earAngle + Math.sin(time * 3.1 + offset) * 0.035 + idleTwitch
      ear.rotation.y = Math.sin(time * 2.3 + offset) * 0.06
    })

    // --- tail ------------------------------------------------------------------
    this.tail.rotation.y = Math.sin(time * (5 + speed01 * 7)) * (0.22 + speed01 * 0.2)
    this.tail.rotation.x = 0.3 + Math.sin(time * 3) * 0.06

    // --- cheer ------------------------------------------------------------------
    if (this.cheerTimer > 0) {
      this.cheerTimer = Math.max(0, this.cheerTimer - dt)
      const t = 1 - this.cheerTimer / 0.75
      // Two quick hops with a squash on each landing.
      const hop = Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t) * 0.34
      this.body.position.y += hop
      this.bodyMesh.scale.y *= 1 - Math.cos(t * Math.PI * 4) * 0.06
      this.headPivot.rotation.x -= 0.22 * (1 - t)
      // Ears fly up with the hop.
      this.earAngle -= hop * 0.9
    }

    // --- swing -----------------------------------------------------------------
    if (player.swingTimer > 0) {
      const t = 1 - player.swingTimer / SWING_TIME
      const angle = swingAngle(t)
      this.armPivot.rotation.x = angle
      // The whole body commits: rock back on the wind-up, punch forward on impact.
      const commit = t < 0.28 ? -t / 0.28 : smoothstep(0.28, 0.5, t) * 1.6 - 1
      this.body.rotation.x += commit * 0.16
      this.body.position.y -= Math.max(0, commit) * 0.045
      this.headPivot.rotation.x += commit * 0.22
    } else {
      this.armPivot.rotation.x = damp(this.armPivot.rotation.x, 0, 12, dt)
      // Idle: the mallet sways gently as she walks.
      this.armPivot.rotation.x += Math.sin(gaitPhase + 1.2) * 0.09 * speed01
    }
  }

  dispose() {
    this.group.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose()
    })
  }
}

