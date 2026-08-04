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

/**
 * Head size, and the reason it is so big.
 *
 * Lammy is about forty pixels tall on a phone. At that size a realistic
 * head-to-body ratio leaves a face too small to read, so she's drawn the way a
 * picture book would draw her: an enormous round head, eyes a third of its
 * width, and a body that's really just something for the head to sit on.
 */
const HEAD_RADIUS = 0.235
const EYE_X = 0.108
const EYE_Y = 0.04
const EYE_Z = 0.2

function buildHead(rng: Rng) {
  const parts: BufferGeometry[] = []

  const skull = new SphereGeometry(HEAD_RADIUS, 16, 12)
  skull.scale(1, 1.0, 0.94)
  parts.push(paint(skull, PALETTE.skin))

  // Woolly fringe across the brow — the bit of wool that makes her a lamb and
  // not a puppy.
  for (let index = 0; index < 9; index += 1) {
    const curl = new SphereGeometry(randRange(rng, 0.085, 0.115), 7, 6)
    const angle = -0.6 + (index / 8) * 2.1
    curl.translate(Math.cos(angle) * 0.185, 0.16 + Math.sin(angle) * 0.07, -0.02)
    parts.push(paint(curl, PALETTE.wool))
  }
  // One curl flopping forward over the brow. Asymmetry reads as personality.
  const forelock = new SphereGeometry(0.085, 8, 7)
  forelock.scale(1, 0.9, 0.85)
  forelock.translate(-0.075, 0.185, 0.11)
  parts.push(paint(forelock, PALETTE.wool))

  const muzzle = new SphereGeometry(0.135, 12, 9)
  muzzle.scale(1, 0.78, 1.02)
  muzzle.translate(0, -0.075, 0.185)
  parts.push(paint(muzzle, PALETTE.skin.clone().multiplyScalar(1.05)))

  const nose = new SphereGeometry(0.038, 8, 6)
  nose.scale(1.35, 0.85, 1)
  nose.translate(0, -0.045, 0.305)
  parts.push(paint(nose, new Color('#d98a86')))

  // Big storybook eyes: dark iris plus two offset catchlights.
  for (const side of [-1, 1]) {
    const eye = new SphereGeometry(0.072, 12, 10)
    eye.scale(1, 1.06, 1)
    eye.translate(side * EYE_X, EYE_Y, EYE_Z)
    parts.push(paint(eye, new Color('#2b2118')))

    const glint = new SphereGeometry(0.028, 8, 7)
    glint.translate(side * 0.088, 0.074, 0.246)
    parts.push(paint(glint, new Color('#ffffff')))

    const glintSmall = new SphereGeometry(0.015, 6, 5)
    glintSmall.translate(side * 0.137, 0.008, 0.238)
    parts.push(paint(glintSmall, new Color('#ffffff')))

    const cheek = new SphereGeometry(0.055, 8, 6)
    cheek.scale(1.35, 0.72, 0.45)
    cheek.translate(side * 0.165, -0.05, 0.175)
    parts.push(paint(cheek, new Color('#ffb0a4')))
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
    const lid = new SphereGeometry(0.09, 10, 8)
    lid.scale(1, 1, 0.7)
    lid.translate(side * EYE_X, EYE_Y + 0.004, EYE_Z + 0.014)
    parts.push(paint(lid, PALETTE.skin.clone().multiplyScalar(1.03)))
  }
  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/**
 * The mouth: a dark rounded shape with a tongue behind it.
 *
 * Kept off the merged head so its scale can be driven per frame. Squashed flat
 * it's a closed smile; stretched open it's a delighted "aaah". One mesh doing
 * both jobs is why she can react to things at all.
 */
function buildMouth() {
  const parts: BufferGeometry[] = []

  const mouth = new SphereGeometry(0.068, 12, 9)
  mouth.scale(1.4, 1, 0.85)
  parts.push(paint(mouth, new Color('#6d3730')))

  const tongue = new SphereGeometry(0.042, 8, 6)
  tongue.scale(1.2, 0.8, 0.7)
  tongue.translate(0, -0.024, 0.03)
  parts.push(paint(tongue, new Color('#f08d92')))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/**
 * One eyebrow, pivoting at its inner end so it can angle as well as lift.
 *
 * Dark and thick on purpose. A subtle brow on a face this small is a brow that
 * isn't there, and the brows are doing most of the work of "determined".
 */
function buildBrow() {
  const brow = new SphereGeometry(0.036, 8, 6)
  brow.scale(2, 0.55, 0.75)
  brow.translate(0.055, 0, 0)
  return paint(brow, new Color('#9a6247'))
}

/** Where the mouth sits at rest, on the front of the muzzle rather than in it. */
const MOUTH_REST_Y = -0.15
const MOUTH_REST_Z = 0.3

function buildEar() {
  const parts: BufferGeometry[] = []
  const ear = new SphereGeometry(0.105, 10, 8)
  ear.scale(1.6, 0.42, 0.9)
  // Pivot at the base so rotation reads as a flop, not a spin.
  ear.translate(0.15, 0, 0)
  parts.push(paint(ear, PALETTE.skin.clone().multiplyScalar(0.97)))

  const inner = new SphereGeometry(0.085, 8, 7)
  inner.scale(1.5, 0.3, 0.7)
  inner.translate(0.15, 0.02, 0.02)
  parts.push(paint(inner, new Color('#f7b7ab')))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/**
 * A ribbon bow, tied between her ears.
 *
 * Chosen for where the camera is. The chase rig spends the whole round looking
 * at the back of her head, so an accessory on her chest would never be seen —
 * this one is in frame every second of play, and it's the fastest way to make a
 * white blob read as a specific little girl.
 */
function buildBow() {
  const parts: BufferGeometry[] = []
  const ribbon = PALETTE.standCloth
  const ribbonDark = PALETTE.standCloth.clone().multiplyScalar(0.78)

  for (const side of [-1, 1]) {
    const loop = new SphereGeometry(0.1, 10, 8)
    loop.scale(1.3, 0.9, 0.55)
    loop.translate(side * 0.115, 0, 0)
    loop.rotateZ(side * 0.32)
    parts.push(paint(loop, ribbon))

    const tail = new SphereGeometry(0.055, 7, 6)
    tail.scale(0.85, 1.5, 0.45)
    tail.translate(side * 0.07, -0.115, -0.01)
    tail.rotateZ(side * 0.5)
    parts.push(paint(tail, ribbonDark))
  }

  const knot = new SphereGeometry(0.06, 9, 7)
  knot.scale(1, 0.95, 0.9)
  parts.push(paint(knot, ribbonDark))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/** A little brass bell on a ribbon under her chin. Pivots so it can swing. */
function buildBell() {
  const parts: BufferGeometry[] = []
  const body = new SphereGeometry(0.055, 10, 8)
  body.scale(1, 0.92, 1)
  body.translate(0, -0.055, 0)
  parts.push(paint(body, new Color('#f5c53c')))

  const loop = new SphereGeometry(0.022, 6, 5)
  loop.translate(0, -0.008, 0)
  parts.push(paint(loop, new Color('#c99a24')))

  const slot = new SphereGeometry(0.03, 6, 5)
  slot.scale(1.4, 0.28, 1)
  slot.translate(0, -0.078, 0.036)
  parts.push(paint(slot, new Color('#8a6a1a')))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/**
 * The foreleg that holds the mallet.
 *
 * Without it the mallet floats beside her shoulder like a cursor, which is the
 * single most doll-like thing about the old rig. Built in the arm pivot's space,
 * with the pivot itself sitting proud of the wool so the hoof is actually seen
 * closing around the grip rather than buried in a puff.
 */
function buildMalletArm() {
  const parts: BufferGeometry[] = []

  // Shoulder to wrist, angled back into the fleece.
  const upper = new CylinderGeometry(0.058, 0.05, 0.22, 8, 1)
  upper.rotateZ(-0.5)
  upper.rotateX(0.2)
  upper.translate(-0.07, 0.02, -0.03)
  parts.push(paint(upper, PALETTE.wool))

  const cuff = new SphereGeometry(0.062, 9, 7)
  cuff.translate(0.005, -0.055, 0.015)
  parts.push(paint(cuff, PALETTE.wool))

  const hoof = new SphereGeometry(0.058, 9, 7)
  hoof.scale(1.05, 0.95, 1.1)
  hoof.translate(0.005, -0.1, 0.02)
  parts.push(paint(hoof, PALETTE.hoof))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
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

/**
 * The tail, sized for the camera behind her.
 *
 * The chase rig looks at her back for the whole round, so the pom-pom is the
 * one moving thing reliably in frame. It's deliberately oversized and pushed
 * clear of the fleece — a tail tucked into the wool might as well not exist.
 */
function buildTail(rng: Rng) {
  const parts: BufferGeometry[] = []

  const core = new SphereGeometry(0.13, 10, 8)
  parts.push(paint(core, PALETTE.woolShade))

  for (let index = 0; index < 7; index += 1) {
    const puff = new SphereGeometry(randRange(rng, 0.065, 0.095), 7, 6)
    const angle = (index / 7) * Math.PI * 2
    puff.translate(Math.cos(angle) * 0.085, Math.sin(angle) * 0.085, -0.03)
    parts.push(paint(puff, PALETTE.wool))
  }

  // A ribbon to match the bow, so the two accessories read as one outfit.
  const ribbon = new SphereGeometry(0.05, 8, 6)
  ribbon.scale(1.4, 0.8, 0.9)
  ribbon.translate(0, 0.11, 0.06)
  parts.push(paint(ribbon, PALETTE.standCloth))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/**
 * The cups Lammy is carrying, on a little tray on her back.
 *
 * The HUD counts them, but a number in a corner isn't the same as seeing her
 * loaded up and hurrying to find someone. Three separate meshes so they can be
 * shown one at a time as she brews.
 */
function buildCup() {
  const parts: BufferGeometry[] = []
  const cup = new CylinderGeometry(0.055, 0.042, 0.11, 10, 1)
  parts.push(paint(cup, PALETTE.standClothAlt))

  const juice = new CylinderGeometry(0.049, 0.04, 0.08, 10, 1)
  // Filled nearly to the rim: from the game's high camera, a cup of juice that
  // sits low in the cup just reads as an empty cup.
  juice.translate(0, 0.006, 0)
  parts.push(paint(juice, PALETTE.juice))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildTray() {
  const tray = new CylinderGeometry(0.16, 0.15, 0.025, 12, 1)
  return paint(tray, PALETTE.malletHandle)
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

/**
 * What her face is doing, and what each one looks like.
 *
 * `mouth` is a scale applied to the mouth mesh — flat and wide is a closed
 * smile, tall and round is an open one. Everything else is an offset, so the
 * whole set can simply be damped toward the current target each frame and the
 * transitions come out smooth for free.
 */
interface Expression {
  mouthWidth: number
  mouthOpen: number
  mouthDrop: number
  browLift: number
  browAngle: number
  /** Extra head pitch — chin up when delighted, tucked when winding up. */
  headTilt: number
}

const EXPRESSIONS: Record<'calm' | 'eager' | 'happy' | 'determined' | 'joy', Expression> = {
  calm: { mouthWidth: 1, mouthOpen: 0.4, mouthDrop: 0, browLift: 0, browAngle: 0.06, headTilt: 0 },
  // Carrying a full tray and looking for someone to give it to.
  eager: {
    mouthWidth: 1.06,
    mouthOpen: 0.66,
    mouthDrop: -0.004,
    browLift: 0.026,
    browAngle: 0.18,
    headTilt: -0.06,
  },
  happy: {
    mouthWidth: 1.15,
    mouthOpen: 0.82,
    mouthDrop: -0.006,
    browLift: 0.018,
    browAngle: 0.14,
    headTilt: -0.03,
  },
  determined: {
    mouthWidth: 0.78,
    mouthOpen: 0.34,
    mouthDrop: -0.004,
    browLift: -0.016,
    browAngle: -0.42,
    headTilt: 0.05,
  },
  joy: {
    mouthWidth: 1.12,
    mouthOpen: 1.5,
    mouthDrop: -0.022,
    browLift: 0.038,
    browAngle: 0.22,
    headTilt: -0.14,
  },
}

/** How long she has to stand still before she starts finding things to do. */
const IDLE_THRESHOLD = 2.2

/** Resting head pitch. Negative tips her chin up toward the overhead camera. */
const HEAD_PITCH = -0.16

export class Lamb {
  readonly group = new Group()

  private readonly body = new Group()
  private readonly bodyMesh: Mesh
  private readonly headPivot = new Group()
  private readonly eyelids: Mesh
  private readonly mouth: Mesh
  private readonly brows: Object3D[] = []
  private readonly bellPivot = new Group()
  private readonly ears: Object3D[] = []
  private readonly legs: LegRig[] = []
  private readonly tail: Mesh
  private readonly armPivot = new Group()
  private readonly tray = new Group()
  private readonly cups: Mesh[] = []
  readonly malletMesh: Mesh

  private lean = 0
  private previousFacing = 0
  private blinkTimer = 2.5
  private blinkProgress = 0
  private cheerTimer = 0
  private earAngle = 0
  private earVelocity = 0
  private bounceMemory = 0
  private readonly face: Expression = { ...EXPRESSIONS.calm }
  private lookYaw = 0
  private idleTime = 0
  private idleBeat = 0
  private bellSwing = 0
  private bellVelocity = 0

  constructor(uniforms: ValleyUniforms, detail: Texture) {
    const rng = mulberry32(0x1a3b)
    const material = woolMaterial(uniforms, detail)

    this.group.name = 'lammy'
    this.group.add(this.body)

    this.bodyMesh = new Mesh(buildBody(rng), material)
    this.bodyMesh.castShadow = true
    this.bodyMesh.position.y = BODY_HEIGHT
    this.body.add(this.bodyMesh)

    // The head sits high and proud of the fleece rather than hanging off the
    // front of it. The chase camera looks down at her back for the whole round,
    // and with the head at shoulder height it is occluded by her own wool
    // whenever she runs across or away from the lens — which is most of the
    // time. Up here, her face is in frame from every heading.
    this.headPivot.position.set(0, BODY_HEIGHT + 0.42, 0.27)
    this.body.add(this.headPivot)

    const headMesh = new Mesh(buildHead(rng), material)
    headMesh.castShadow = true
    this.headPivot.add(headMesh)

    this.eyelids = new Mesh(buildEyelids(), material)
    this.eyelids.visible = false
    this.headPivot.add(this.eyelids)

    this.mouth = new Mesh(buildMouth(), material)
    this.mouth.position.set(0, MOUTH_REST_Y, MOUTH_REST_Z)
    this.headPivot.add(this.mouth)

    const browGeometry = buildBrow()
    for (const side of [-1, 1]) {
      const pivot = new Group()
      pivot.position.set(0, 0.118, 0.222)
      // Mirrored by a half turn rather than a negative scale, which would flip
      // the winding and light the brow from the inside.
      if (side < 0) pivot.rotation.y = Math.PI
      const mesh = new Mesh(browGeometry, material)
      pivot.add(mesh)
      this.headPivot.add(pivot)
      this.brows.push(pivot)
    }

    // Worn to one side rather than centred: a bow on the crown disappears into
    // the fringe from behind, and a jaunty one gives her a "good" side.
    const bow = new Mesh(buildBow(), material)
    bow.castShadow = true
    bow.position.set(-0.16, 0.205, 0.02)
    bow.rotation.set(0.15, -0.45, 0.6)
    this.headPivot.add(bow)

    // Bell on a ribbon under the chin, on its own pivot so it can swing.
    this.bellPivot.position.set(0, -0.135, 0.11)
    this.headPivot.add(this.bellPivot)
    const bell = new Mesh(buildBell(), material)
    bell.castShadow = true
    this.bellPivot.add(bell)

    const earGeometry = buildEar()
    for (const side of [-1, 1]) {
      const pivot = new Group()
      pivot.position.set(side * 0.185, 0.055, 0.02)
      pivot.userData.baseYaw = side < 0 ? Math.PI : 0
      pivot.rotation.y = pivot.userData.baseYaw
      pivot.rotation.z = 0.25
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
    this.tail.position.set(0, BODY_HEIGHT + 0.16, -0.6)
    this.body.add(this.tail)

    // A tray of cups rides on her back, between the shoulders.
    this.tray.position.set(0, BODY_HEIGHT + 0.34, -0.2)
    this.tray.rotation.x = -0.08
    this.body.add(this.tray)

    const trayMesh = new Mesh(buildTray(), material)
    trayMesh.castShadow = true
    this.tray.add(trayMesh)

    const cupGeometry = buildCup()
    const cupSpots: [number, number][] = [
      [0, 0.055],
      [-0.075, -0.05],
      [0.075, -0.05],
    ]
    for (const [x, z] of cupSpots) {
      const cup = new Mesh(cupGeometry, material)
      cup.castShadow = true
      cup.position.set(x, 0.07, z)
      cup.visible = false
      this.tray.add(cup)
      this.cups.push(cup)
    }

    // The mallet rides on a shoulder pivot on her right side, with a foreleg
    // wrapped around the grip so it reads as carried rather than orbiting.
    // Far enough out that the hoof clears the wool puffs — inside them, the arm
    // is invisible and the mallet goes back to looking like it is floating.
    this.armPivot.position.set(0.42, BODY_HEIGHT + 0.16, 0.1)
    this.body.add(this.armPivot)

    const arm = new Mesh(buildMalletArm(), material)
    arm.castShadow = true
    this.armPivot.add(arm)

    this.malletMesh = new Mesh(buildMallet(), material)
    this.malletMesh.castShadow = true
    this.malletMesh.position.set(0.16, 0.42, -0.01)
    this.malletMesh.rotation.z = -0.38
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
  /**
   * @param carrying how many cups are on the tray, 0 to 3
   * @param lookAt something in the world worth turning her head toward — the
   *        nearest animal still waiting for a drink. Omit for no interest.
   */
  update(
    player: Player,
    dt: number,
    time: number,
    carrying = 0,
    lookAt: { x: number; z: number } | null = null,
  ) {
    const speed01 = clamp01(player.speed / PLAYER_SPEED)

    for (let index = 0; index < this.cups.length; index += 1) {
      this.cups[index].visible = index < carrying
    }
    // The tray stays level-ish while she runs, like someone actually carrying it.
    this.tray.rotation.x = -0.08 - this.body.rotation.x * 0.7
    this.tray.rotation.z = -this.lean * 0.6
    this.tray.visible = carrying > 0

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

    // --- idle beats -------------------------------------------------------------
    // Standing still is where a character either exists or doesn't. Once she's
    // been stopped for a couple of seconds she starts doing things on her own:
    // a look around, an ear flick, a bounce on the spot.
    if (speed01 > 0.06 || player.swingTimer > 0) {
      this.idleTime = 0
      this.idleBeat = 0
    } else {
      this.idleTime += dt
    }
    const idling = this.idleTime > IDLE_THRESHOLD
    let idleLook = 0
    let idleHop = 0
    if (idling) {
      const beat = (this.idleTime - IDLE_THRESHOLD) % 5.4
      this.idleBeat = beat
      // Beat 0-1.6: glance left. 1.8-3.4: glance right. 4.0-4.6: a small hop.
      if (beat < 1.6) idleLook = Math.sin((beat / 1.6) * Math.PI) * 0.55
      else if (beat > 1.8 && beat < 3.4) idleLook = -Math.sin(((beat - 1.8) / 1.6) * Math.PI) * 0.5
      else if (beat > 4.0 && beat < 4.6) {
        const t = (beat - 4.0) / 0.6
        idleHop = Math.sin(t * Math.PI) * 0.09
      }
    }
    this.body.position.y += idleHop

    // --- head and ears ---------------------------------------------------------
    // Chin held up by default: the camera is above her, and a level head shows
    // the player the top of a skull instead of a face.
    this.headPivot.rotation.x =
      HEAD_PITCH + Math.sin(gaitPhase * 2 + 0.6) * 0.06 * speed01 - 0.05 * speed01
    this.headPivot.rotation.z = -this.lean * 0.45

    // She looks at whoever still needs her. Only a glance — the head turns
    // within its own range and the body keeps facing where she's going, which is
    // what makes it read as noticing rather than as steering.
    let lookTarget = idleLook
    if (lookAt) {
      let delta = Math.atan2(lookAt.x - player.x, lookAt.z - player.z) - player.facing
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      // Fades out once she's running flat out; at speed she watches where she's going.
      lookTarget = clamp(delta, -0.85, 0.85) * (1 - speed01 * 0.55)
    }
    this.lookYaw = damp(this.lookYaw, lookTarget, 5, dt)
    this.headPivot.rotation.y = this.lookYaw

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

    // A flick on a slow cycle, plus a deliberate one on the idle beat.
    const idleTwitch = Math.sin(time * 0.7) > 0.985 ? 0.35 : 0
    const beatTwitch = idling && this.idleBeat > 3.5 && this.idleBeat < 3.9 ? 0.4 : 0
    this.ears.forEach((ear, index) => {
      const offset = index === 0 ? 0 : 0.35
      ear.rotation.z =
        0.25 + this.earAngle + Math.sin(time * 3.1 + offset) * 0.035 + idleTwitch + beatTwitch
      ear.rotation.y = (ear.userData.baseYaw as number) + Math.sin(time * 2.3 + offset) * 0.06
    })

    // --- tail ------------------------------------------------------------------
    // Wags faster the more she's carrying — a full tray means someone is about
    // to be very happy, and she knows it.
    const excitement = speed01 + carrying * 0.22
    this.tail.rotation.y = Math.sin(time * (5 + excitement * 7)) * (0.22 + excitement * 0.24)
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

    this.updateFace(player, dt, time, speed01, carrying)
  }

  /**
   * Drive the mouth and brows from what she's doing.
   *
   * The state is read rather than pushed: nothing in the game has to remember to
   * tell her to look pleased, which means the face can never get stuck on the
   * wrong expression after an interrupted animation.
   */
  private updateFace(
    player: Player,
    dt: number,
    time: number,
    speed01: number,
    carrying: number,
  ) {
    const target =
      this.cheerTimer > 0
        ? EXPRESSIONS.joy
        : player.swingTimer > 0
          ? EXPRESSIONS.determined
          : speed01 > 0.25
            ? EXPRESSIONS.happy
            : carrying > 0
              ? EXPRESSIONS.eager
              : EXPRESSIONS.calm

    // Joy snaps on and eases off; everything else eases both ways.
    const rate = target === EXPRESSIONS.joy ? 18 : 9
    this.face.mouthWidth = damp(this.face.mouthWidth, target.mouthWidth, rate, dt)
    this.face.mouthOpen = damp(this.face.mouthOpen, target.mouthOpen, rate, dt)
    this.face.mouthDrop = damp(this.face.mouthDrop, target.mouthDrop, rate, dt)
    this.face.browLift = damp(this.face.browLift, target.browLift, rate, dt)
    this.face.browAngle = damp(this.face.browAngle, target.browAngle, rate, dt)
    this.face.headTilt = damp(this.face.headTilt, target.headTilt, rate, dt)

    this.mouth.scale.set(this.face.mouthWidth, this.face.mouthOpen, 1)
    // An open mouth grows downward from the lip, not out of the middle of it.
    this.mouth.position.y = MOUTH_REST_Y + this.face.mouthDrop - (this.face.mouthOpen - 0.4) * 0.03
    this.headPivot.rotation.x += this.face.headTilt

    for (const brow of this.brows) {
      brow.position.y = 0.118 + this.face.browLift
      brow.rotation.z = this.face.browAngle
    }

    // The bell swings on a spring hung off her head pitch, so it lags the run
    // cycle and keeps ringing for a moment after she stops.
    const drive = this.headPivot.rotation.x * 2.4 + speed01 * Math.sin(time * 9) * 0.5
    this.bellVelocity += (drive - this.bellSwing) * 90 * dt - this.bellVelocity * 11 * dt
    this.bellSwing += this.bellVelocity * dt
    this.bellPivot.rotation.x = clamp(this.bellSwing, -0.8, 0.8)
    this.bellPivot.rotation.z = Math.sin(time * 4.2) * 0.06 * (0.3 + speed01)
  }

  dispose() {
    this.group.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose()
    })
  }
}

