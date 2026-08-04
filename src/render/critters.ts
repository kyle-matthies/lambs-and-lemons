import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type Camera,
  type IUniform,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, clamp01, damp, dampAngle, distance2D, easeOutBack, lerp, smoothstep } from '../core/math'
import { mulberry32, randRange, type Rng } from '../core/rng'
import { CRITTER_BLOOM_TIME, SERVE_RADIUS } from '../game/constants'
import type { Critter, CritterKind } from '../game/types'
import { paint } from './geometryUtils'
import { PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * The valley's lost creatures, and the flock they become.
 *
 * Each animal is a small rig rather than a single mesh: body, head, two ears and
 * a tail, so the pose can act. That matters because these animals are the thing
 * the player is looking for — an animal that visibly notices you, perks its ears
 * and starts bouncing is an invitation, where a grey lump in the grass is
 * scenery.
 *
 * What a lost one wants is said out loud, in cartoon: a thought bubble with a
 * cup of lemonade in it, bobbing above the grass, and a warm ring on the ground
 * that is exactly the radius you have to stand inside to hand one over. Between
 * them they replace the old abstract light beams, which read as steam vents and
 * taught the player nothing.
 *
 * Every critter owns a `localHeal` uniform so that a freed animal stays in full
 * colour even while it is standing in a part of the meadow that is still grey.
 */

interface EarPose {
  /** Pitch, shared by both ears. */
  x: number
  /** Roll, mirrored left/right. */
  z: number
}

interface KindRecipe {
  bodyRadius: number
  bodyStretch: number
  legHeight: number
  headRadius: number
  headForward: number
  body: Color
  belly: Color
  face: Color
  inner: Color
  earKind: 'floppy' | 'long' | 'small'
  fluffy: boolean
  /** Where the ear pivots sit on the head, as fractions of the head radius. */
  earAnchor: { x: number; y: number; z: number }
  /** Ear pose while lost and listless, and while alert. */
  earDown: EarPose
  earUp: EarPose
}

const RECIPES: Record<CritterKind, KindRecipe> = {
  lamb: {
    bodyRadius: 0.26,
    bodyStretch: 1.24,
    legHeight: 0.22,
    // Deliberately oversized heads. Every one of these animals is read at ten
    // metres through tall grass, and the head is the only part with a face on it.
    headRadius: 0.19,
    headForward: 0.24,
    body: PALETTE.wool,
    belly: PALETTE.woolShade,
    face: PALETTE.skin,
    inner: new Color('#f7b7ab'),
    earKind: 'floppy',
    fluffy: true,
    earAnchor: { x: 0.86, y: 0.34, z: 0.05 },
    earDown: { x: 0.15, z: -0.55 },
    earUp: { x: -0.1, z: 0.42 },
  },
  bunny: {
    bodyRadius: 0.22,
    bodyStretch: 1.1,
    legHeight: 0.18,
    headRadius: 0.175,
    headForward: 0.2,
    body: new Color('#d3c3ae'),
    belly: new Color('#f2e8da'),
    face: new Color('#dccdb9'),
    inner: new Color('#f3aebb'),
    earKind: 'long',
    fluffy: false,
    earAnchor: { x: 0.44, y: 0.78, z: -0.08 },
    // Rabbit ears say everything: folded flat back when sad, straight up when keen.
    earDown: { x: 1.15, z: -0.3 },
    earUp: { x: -0.05, z: 0.16 },
  },
  piglet: {
    bodyRadius: 0.27,
    bodyStretch: 1.16,
    legHeight: 0.19,
    headRadius: 0.2,
    headForward: 0.22,
    body: new Color('#f4b3bd'),
    belly: new Color('#fbd3d8'),
    face: new Color('#f6c0c8'),
    inner: new Color('#e2909c'),
    earKind: 'small',
    fluffy: false,
    earAnchor: { x: 0.58, y: 0.72, z: -0.05 },
    earDown: { x: 0.85, z: -0.2 },
    earUp: { x: 0.05, z: 0.3 },
  },
}

function buildBody(recipe: KindRecipe, rng: Rng) {
  const parts: BufferGeometry[] = []

  const torso = new SphereGeometry(recipe.bodyRadius, 12, 9)
  torso.scale(1, 0.9, recipe.bodyStretch)
  torso.translate(0, recipe.legHeight + recipe.bodyRadius * 0.85, 0)
  parts.push(paint(torso, recipe.body))

  const belly = new SphereGeometry(recipe.bodyRadius * 0.82, 10, 8)
  belly.scale(1, 0.7, recipe.bodyStretch * 0.95)
  belly.translate(0, recipe.legHeight + recipe.bodyRadius * 0.62, 0.02)
  parts.push(paint(belly, recipe.belly))

  if (recipe.fluffy) {
    // Wool puffs, same trick as Lammy — a sphere alone reads as a bean.
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let index = 0; index < 14; index += 1) {
      const t = index / 14
      const inclination = Math.acos(1 - 2 * (t * 0.8 + 0.1))
      const azimuth = golden * index
      const puff = new SphereGeometry(randRange(rng, 0.075, 0.11), 7, 6)
      puff.translate(
        Math.sin(inclination) * Math.cos(azimuth) * recipe.bodyRadius,
        recipe.legHeight + recipe.bodyRadius * 0.85 + Math.cos(inclination) * recipe.bodyRadius * 0.8,
        Math.sin(inclination) * Math.sin(azimuth) * recipe.bodyRadius * recipe.bodyStretch,
      )
      parts.push(paint(puff, recipe.body))
    }
  }

  // Legs — four stubs, no articulation. At this size a body bounce sells the walk.
  for (const [x, z] of [
    [-0.13, 0.16],
    [0.13, 0.16],
    [-0.13, -0.16],
    [0.13, -0.16],
  ]) {
    const leg = new CylinderGeometry(0.04, 0.046, recipe.legHeight, 6, 1)
    leg.translate(x, recipe.legHeight / 2, z * recipe.bodyStretch)
    parts.push(paint(leg, recipe.belly))
    const hoof = new CylinderGeometry(0.047, 0.042, 0.05, 6, 1)
    hoof.translate(x, 0.025, z * recipe.bodyStretch)
    parts.push(paint(hoof, PALETTE.hoof))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

/** Where the tail pivot hangs off the body. */
function tailAnchor(recipe: KindRecipe) {
  return {
    y: recipe.legHeight + recipe.bodyRadius * 1.0,
    z: -recipe.bodyRadius * recipe.bodyStretch * 0.95,
  }
}

function buildTail(recipe: KindRecipe) {
  const parts: BufferGeometry[] = []
  if (recipe.earKind === 'long') {
    // Cottontail: one big powder puff.
    const puff = new SphereGeometry(0.085, 8, 7)
    puff.translate(0, 0, -0.03)
    parts.push(paint(puff, new Color('#fdf6ea')))
  } else if (recipe.earKind === 'small') {
    // Curly pig tail — three shrinking beads swept into a hook.
    for (let index = 0; index < 3; index += 1) {
      const bead = new SphereGeometry(0.042 - index * 0.008, 6, 5)
      const angle = index * 1.5
      bead.translate(Math.sin(angle) * 0.05, 0.03 + index * 0.035, -0.02 - index * 0.02)
      parts.push(paint(bead, recipe.body))
    }
  } else {
    for (let index = 0; index < 2; index += 1) {
      const puff = new SphereGeometry(0.06 - index * 0.014, 7, 6)
      puff.translate(0, -index * 0.05, -0.02 - index * 0.02)
      parts.push(paint(puff, recipe.body))
    }
  }
  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildHead(recipe: KindRecipe, rng: Rng) {
  const parts: BufferGeometry[] = []
  const r = recipe.headRadius

  const skull = new SphereGeometry(r, 12, 9)
  parts.push(paint(skull, recipe.face))

  if (recipe.fluffy) {
    for (let index = 0; index < 5; index += 1) {
      const curl = new SphereGeometry(randRange(rng, 0.055, 0.075), 6, 5)
      const angle = -0.6 + (index / 4) * 2.2
      curl.translate(Math.cos(angle) * r * 0.75, r * 0.7, -0.02)
      parts.push(paint(curl, recipe.body))
    }
  }

  // Snout / muzzle.
  const snout = new SphereGeometry(r * 0.55, 9, 7)
  snout.scale(1, recipe.earKind === 'small' ? 0.75 : 0.85, 1)
  snout.translate(0, -r * 0.32, r * 0.86)
  parts.push(paint(snout, recipe.earKind === 'small' ? recipe.inner : recipe.face))

  const nose = new SphereGeometry(r * 0.17, 6, 5)
  nose.scale(1.4, 0.85, 1)
  nose.translate(0, -r * 0.24, r * 1.28)
  parts.push(paint(nose, new Color('#c9757f')))

  // A little smile under the snout. Three beads of a curve is enough at this size,
  // and it's the difference between an animal and a plush toy with a blank face.
  for (let index = 0; index < 3; index += 1) {
    const t = (index - 1) / 1
    const bead = new SphereGeometry(r * 0.05, 5, 4)
    bead.translate(t * r * 0.2, -r * 0.55 - (1 - Math.abs(t)) * r * 0.07, r * 0.94)
    parts.push(paint(bead, new Color('#8a5a52')))
  }

  // Eyes with catchlights — the single biggest readability win at this scale.
  for (const side of [-1, 1]) {
    const eye = new SphereGeometry(r * 0.33, 10, 8)
    eye.translate(side * r * 0.46, r * 0.16, r * 0.8)
    parts.push(paint(eye, new Color('#2b2118')))

    const glint = new SphereGeometry(r * 0.13, 6, 5)
    glint.translate(side * r * 0.37, r * 0.31, r * 1.0)
    parts.push(paint(glint, new Color('#ffffff')))

    const glintSmall = new SphereGeometry(r * 0.06, 5, 4)
    glintSmall.translate(side * r * 0.58, r * 0.03, r * 0.98)
    parts.push(paint(glintSmall, new Color('#ffffff')))

    // Blush. Cheap, and it warms the whole face.
    const cheek = new SphereGeometry(r * 0.2, 6, 5)
    cheek.scale(1.3, 0.7, 0.4)
    cheek.translate(side * r * 0.72, -r * 0.2, r * 0.7)
    parts.push(paint(cheek, new Color('#ff9fa8')))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildEar(recipe: KindRecipe) {
  const parts: BufferGeometry[] = []
  const r = recipe.headRadius

  if (recipe.earKind === 'long') {
    const outer = new SphereGeometry(0.055, 8, 6)
    outer.scale(0.62, 2.7, 0.45)
    outer.translate(0, 0.14, 0)
    parts.push(paint(outer, recipe.body))
    const inner = new SphereGeometry(0.055, 7, 6)
    inner.scale(0.4, 2.2, 0.3)
    inner.translate(0, 0.14, 0.02)
    parts.push(paint(inner, recipe.inner))
  } else if (recipe.earKind === 'floppy') {
    const outer = new SphereGeometry(0.07, 8, 6)
    outer.scale(1.6, 0.46, 0.85)
    outer.translate(r * 0.5, 0, 0)
    parts.push(paint(outer, recipe.body))
    const inner = new SphereGeometry(0.07, 7, 6)
    inner.scale(1.2, 0.3, 0.6)
    inner.translate(r * 0.5, 0, 0.02)
    parts.push(paint(inner, recipe.inner))
  } else {
    const outer = new ConeGeometry(0.06, 0.11, 7, 1)
    outer.translate(0, 0.055, 0)
    parts.push(paint(outer, recipe.body))
    const inner = new ConeGeometry(0.038, 0.08, 6, 1)
    inner.translate(0, 0.05, 0.02)
    parts.push(paint(inner, recipe.inner))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

// ---------------------------------------------------------------------------
// "I would like a lemonade"
// ---------------------------------------------------------------------------

/**
 * A cartoon thought bubble with a cup of lemonade in it.
 *
 * Built face-on in the XY plane and billboarded at the camera, so it reads as a
 * drawn icon that happens to live in the world. The dark backing shell is merged
 * into the same geometry a hair further back, which gives the whole thing a
 * cartoon outline for one extra ring of triangles and no extra draw call.
 */
/**
 * Everything in the bubble is authored a stop or two under full brightness.
 *
 * The post stack blooms anything that survives tone mapping above 0.72, and a
 * palm-sized disc of pure white sails straight past it — the icon disappears
 * inside its own halo. Held here, it stays a drawing with a soft glow around it.
 */
const BUBBLE_OUTLINE = new Color('#3a2c22')
const BUBBLE_PAPER = new Color('#e2d8c0')
const BUBBLE_CUP = new Color('#cdc0a4')
const BUBBLE_JUICE = new Color('#e8c443')
const BUBBLE_TRIM = new Color('#d9564a')
const BUBBLE_LEMON = new Color('#e8b92c')

function buildBubbleGeometry() {
  const parts: BufferGeometry[] = []

  const blobs: [number, number, number, number][] = [
    // radius, x, y, flatten
    [0.32, 0, 0, 0.26],
    [0.1, -0.04, -0.35, 0.26],
    [0.06, -0.09, -0.5, 0.26],
  ]

  // Outline shell first: same silhouette, a touch bigger, pushed behind.
  for (const [radius, x, y, flat] of blobs) {
    const shell = new SphereGeometry(radius + 0.036, 14, 11)
    shell.scale(1.12, 1, flat)
    shell.translate(x, y, -0.05)
    parts.push(paint(shell, BUBBLE_OUTLINE))
  }

  for (const [radius, x, y, flat] of blobs) {
    const blob = new SphereGeometry(radius, 14, 11)
    blob.scale(1.12, 1, flat)
    blob.translate(x, y, 0)
    parts.push(paint(blob, BUBBLE_PAPER))
  }

  // The cup itself, sitting proud of the bubble face.
  const cup = new CylinderGeometry(0.095, 0.07, 0.2, 12, 1)
  cup.translate(0, -0.03, 0.08)
  parts.push(paint(cup, BUBBLE_CUP))

  const juice = new CylinderGeometry(0.086, 0.066, 0.165, 12, 1)
  juice.translate(0, -0.012, 0.095)
  parts.push(paint(juice, BUBBLE_JUICE))

  const rim = new CylinderGeometry(0.102, 0.102, 0.026, 12, 1)
  rim.translate(0, 0.076, 0.08)
  parts.push(paint(rim, BUBBLE_TRIM))

  const straw = new CylinderGeometry(0.019, 0.019, 0.26, 6, 1)
  straw.rotateZ(-0.42)
  straw.translate(0.062, 0.14, 0.1)
  parts.push(paint(straw, BUBBLE_TRIM))

  // Lemon wedge hooked on the rim.
  const wedge = new SphereGeometry(0.062, 8, 7)
  wedge.scale(1, 1, 0.4)
  wedge.translate(-0.095, 0.095, 0.13)
  parts.push(paint(wedge, BUBBLE_LEMON))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildBubbleMaterial() {
  // Unlit on purpose: this is the game talking to the player. It must stay
  // legible in the drained parts of the valley and at the far edge of the fog.
  // Tone-mapped, though — the bloom pass thresholds at 0.72, and an untone-mapped
  // white icon sails straight past it and turns into a headlight.
  return new MeshBasicMaterial({ vertexColors: true, fog: false })
}

/** The warm patch of ground that marks "stand here and hand one over". */
function buildRingMaterial(alphaMap: Texture) {
  return new MeshBasicMaterial({
    color: PALETTE.lemonLight,
    alphaMap,
    map: alphaMap,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  })
}

// ---------------------------------------------------------------------------

interface CritterVisual {
  group: Group
  body: Group
  bodyMesh: Mesh
  head: Group
  ears: Object3D[]
  tail: Object3D
  bubble: Group
  bubbleMesh: Mesh
  ring: Mesh
  ringMaterial: MeshBasicMaterial
  localHeal: IUniform<number>
  scale: number
  recipe: KindRecipe
  /** How much this animal has noticed Lammy, 0-1, damped. */
  notice: number
  /** How close she is to actually handing something over, 0-1, damped. */
  eager: number
  bubblePop: number
  headYaw: number
  bounce: number
}

/** Beyond this the animal hasn't spotted Lammy at all. */
const NOTICE_RANGE = 13
/** Inside this it starts hopping — a little wider than the serve radius so the
 *  invitation arrives before the player is already standing on top of them. */
const EAGER_RANGE = SERVE_RADIUS * 2.6

export interface HerdContext {
  camera: Camera
  playerX: number
  playerZ: number
}

export class CritterHerd {
  readonly group = new Group()
  private readonly visuals = new Map<number, CritterVisual>()
  private readonly geometryCache = new Map<
    CritterKind,
    { body: BufferGeometry; head: BufferGeometry; ear: BufferGeometry; tail: BufferGeometry }
  >()
  private readonly bubbleGeometry = buildBubbleGeometry()
  private readonly ringGeometry = new CircleGeometry(SERVE_RADIUS * 1.05, 28)

  private readonly uniforms: ValleyUniforms
  private readonly detail: Texture
  private readonly alpha: Texture

  constructor(critters: Critter[], uniforms: ValleyUniforms, detail: Texture, alpha: Texture) {
    this.uniforms = uniforms
    this.detail = detail
    this.alpha = alpha
    this.ringGeometry.rotateX(-Math.PI / 2)
    this.group.name = 'critters'
    for (const critter of critters) this.visuals.set(critter.id, this.build(critter))
  }

  private geometryFor(kind: CritterKind) {
    const cached = this.geometryCache.get(kind)
    if (cached) return cached
    const rng = mulberry32(0x5eed + kind.length * 7919)
    const recipe = RECIPES[kind]
    const built = {
      body: buildBody(recipe, rng),
      head: buildHead(recipe, rng),
      ear: buildEar(recipe),
      tail: buildTail(recipe),
    }
    this.geometryCache.set(kind, built)
    return built
  }

  private build(critter: Critter): CritterVisual {
    const recipe = RECIPES[critter.kind]
    const geometry = this.geometryFor(critter.kind)

    // One material per critter so each can hold its own recovery state.
    const localHeal: IUniform<number> = { value: 0 }
    const material = new MeshStandardMaterial({
      vertexColors: true,
      map: this.detail,
      roughness: 0.9,
      metalness: 0,
    })
    applyValleyShading(material, this.uniforms, {
      bloom: true,
      rim: 1.3,
      localHeal,
    })

    const group = new Group()
    const body = new Group()
    const bodyMesh = new Mesh(geometry.body, material)
    bodyMesh.castShadow = true
    body.add(bodyMesh)

    const head = new Group()
    head.position.set(
      0,
      recipe.legHeight + recipe.bodyRadius * 1.35,
      recipe.headForward + recipe.bodyRadius * 0.5,
    )
    const headMesh = new Mesh(geometry.head, material)
    headMesh.castShadow = true
    head.add(headMesh)

    const ears: Object3D[] = []
    for (const side of [-1, 1]) {
      const pivot = new Group()
      pivot.position.set(
        side * recipe.headRadius * recipe.earAnchor.x,
        recipe.headRadius * recipe.earAnchor.y,
        recipe.headRadius * recipe.earAnchor.z,
      )
      pivot.userData.side = side
      const mesh = new Mesh(geometry.ear, material)
      mesh.castShadow = true
      pivot.add(mesh)
      head.add(pivot)
      ears.push(pivot)
    }
    body.add(head)

    const anchor = tailAnchor(recipe)
    const tail = new Group()
    tail.position.set(0, anchor.y, anchor.z)
    const tailMesh = new Mesh(geometry.tail, material)
    tailMesh.castShadow = true
    tail.add(tailMesh)
    body.add(tail)

    group.add(body)

    // The ground ring lives under the animal but outside its facing rotation.
    const ringMaterial = buildRingMaterial(this.alpha)
    const ring = new Mesh(this.ringGeometry, ringMaterial)
    ring.renderOrder = 2
    ring.position.y = 0.06
    group.add(ring)

    // The bubble is parented to the herd root, not the critter, so billboarding
    // isn't fighting the animal's facing every frame.
    const bubble = new Group()
    const bubbleMesh = new Mesh(this.bubbleGeometry, buildBubbleMaterial())
    bubbleMesh.renderOrder = 7
    bubble.add(bubbleMesh)
    bubble.visible = false
    this.group.add(bubble)

    const scale = lerp(0.86, 1.12, critter.hue)
    group.scale.setScalar(scale)
    this.group.add(group)

    return {
      group,
      body,
      bodyMesh,
      head,
      ears,
      tail,
      bubble,
      bubbleMesh,
      ring,
      ringMaterial,
      localHeal,
      scale,
      recipe,
      notice: 0,
      eager: 0,
      bubblePop: 0,
      headYaw: 0,
      bounce: 0,
    }
  }

  update(critters: Critter[], dt: number, time: number, context: HerdContext) {
    for (const critter of critters) {
      const visual = this.visuals.get(critter.id)
      if (!visual) continue

      const recipe = visual.recipe
      visual.group.position.set(critter.x, critter.y, critter.z)

      const lost = critter.state === 'lost'
      const blooming = critter.state === 'blooming'

      // --- how much do they care that Lammy is here? -------------------------
      const toPlayer = distance2D(critter.x, critter.z, context.playerX, context.playerZ)
      const noticeTarget = lost ? smoothstep(NOTICE_RANGE, 4.5, toPlayer) : 1
      const eagerTarget = lost ? smoothstep(EAGER_RANGE, SERVE_RADIUS * 0.8, toPlayer) : 0
      visual.notice = damp(visual.notice, noticeTarget, 4, dt)
      visual.eager = damp(visual.eager, eagerTarget, 7, dt)

      // Turn to face her once she's close enough to matter. Lost animals don't
      // walk over — they're too flat for that — but they do turn and watch, and
      // that alone makes the meadow feel inhabited rather than decorated.
      const facePlayer = Math.atan2(context.playerX - critter.x, context.playerZ - critter.z)
      const facing = lost
        ? dampAngle(visual.group.rotation.y, lerp(critter.facing, facePlayer, visual.notice), 5, dt)
        : critter.facing
      visual.group.rotation.y = facing

      // Recovery: 0 while lost, sweeping to 1 across the bloom, then held. A
      // lost one warms slightly as she closes in — hope, before the cup arrives.
      const target = lost
        ? visual.eager * 0.28
        : blooming
          ? 1 - clamp01(critter.bloomTimer / CRITTER_BLOOM_TIME)
          : 1
      visual.localHeal.value = blooming ? target : damp(visual.localHeal.value, target, 8, dt)

      // --- gait ---------------------------------------------------------------
      const speed01 = clamp01(critter.speed / 5)
      const phase = critter.gait * 4.4
      const bounce = Math.abs(Math.sin(phase)) * (0.05 + speed01 * 0.11)
      const breathe = Math.sin(time * 2.1 + critter.hue * 6) * 0.008
      // A begging hop once she's near: little, quick, and impossible to miss.
      const beg = Math.abs(Math.sin(time * 7.5 + critter.hue * 5)) * 0.16 * visual.eager
      visual.bounce = bounce

      let earPitch: number
      let earRoll: number

      if (blooming) {
        // A delighted little hop with an overshoot as the colour arrives.
        const t = 1 - clamp01(critter.bloomTimer / CRITTER_BLOOM_TIME)
        const pop = easeOutBack(clamp01(t * 1.4))
        visual.body.position.y = Math.sin(t * Math.PI) * 0.42
        visual.body.scale.setScalar(0.82 + pop * 0.22)
        visual.body.rotation.x = 0
        visual.head.rotation.x = -0.35 + Math.sin(t * Math.PI * 2) * 0.25
        visual.headYaw = damp(visual.headYaw, 0, 10, dt)
        visual.group.rotation.y = critter.facing + t * Math.PI * 2
        earPitch = recipe.earUp.x - 0.35
        earRoll = recipe.earUp.z
      } else {
        visual.body.position.y = bounce + breathe + beg
        visual.body.scale.setScalar(1)
        if (lost) {
          // Slumped and heavy — until she turns up, at which point they straighten.
          visual.body.rotation.x = lerp(0.24, -0.06, visual.eager)
          visual.head.rotation.x =
            lerp(0.6 + Math.sin(time * 0.9 + critter.hue * 5) * 0.06, -0.22, visual.notice) -
            visual.eager * 0.12
          earPitch = lerp(recipe.earDown.x, recipe.earUp.x, visual.notice)
          earRoll = lerp(recipe.earDown.z, recipe.earUp.z, visual.notice)
        } else {
          visual.body.rotation.x = -0.1 * speed01
          visual.head.rotation.x = Math.sin(phase * 2) * 0.08 * speed01 - 0.12
          earPitch = recipe.earUp.x
          earRoll = recipe.earUp.z
        }
        visual.head.rotation.z = Math.sin(time * 1.6 + critter.hue * 4) * 0.05
      }

      // Heads track her within the body's turn — a glance, not a whole-body pivot.
      if (!blooming) {
        let yawTarget = 0
        if (lost) {
          let delta = facePlayer - facing
          while (delta > Math.PI) delta -= Math.PI * 2
          while (delta < -Math.PI) delta += Math.PI * 2
          yawTarget = clamp(delta, -0.7, 0.7) * visual.notice
        } else {
          // Followers glance back over their shoulder now and then.
          yawTarget = Math.sin(time * 0.6 + critter.hue * 9) > 0.94 ? 0.5 : 0
        }
        visual.headYaw = damp(visual.headYaw, yawTarget, 6, dt)
      }
      visual.head.rotation.y = visual.headYaw

      // Ears: a flick on top of the pose so they never sit dead still.
      const flick = Math.sin(time * 3.4 + critter.hue * 11) * 0.05 + visual.eager * 0.12
      for (const ear of visual.ears) {
        const side = ear.userData.side as number
        ear.rotation.x = earPitch + Math.sin(time * 2.6 + side + critter.hue * 7) * 0.05
        ear.rotation.z = side * (earRoll + flick)
      }

      // Tail: barely moves while lost, wags hard once they're yours.
      const wag = lost
        ? 0.1 + visual.eager * 0.55
        : 0.45 + speed01 * 0.5
      visual.tail.rotation.y = Math.sin(time * (lost ? 3 + visual.eager * 9 : 9 + speed01 * 6)) * wag
      visual.tail.rotation.x = lost ? lerp(0.5, 0.05, visual.notice) : -0.1

      // --- what they want ------------------------------------------------------
      const wantsCup = lost || (blooming && critter.bloomTimer > CRITTER_BLOOM_TIME * 0.75)
      visual.bubblePop = damp(visual.bubblePop, wantsCup ? 1 : 0, blooming ? 16 : 6, dt)
      visual.bubble.visible = visual.bubblePop > 0.02
      if (visual.bubble.visible) {
        const headY =
          critter.y +
          (recipe.legHeight + recipe.bodyRadius * 1.35 + recipe.headRadius * 1.5) * visual.scale
        // High enough to clear the meadow grass from a low chase camera — the one
        // thing the old light beams got right was standing above the undergrowth.
        const bob = Math.sin(time * (1.8 + visual.eager * 3) + critter.hue * 8) * 0.07
        visual.bubble.position.set(critter.x, headY + 1.05 + bob, critter.z)
        // Face the camera flat-on: it's an icon, and an icon seen edge-on is gone.
        visual.bubble.quaternion.copy(context.camera.quaternion)

        // Hold a minimum on-screen size. This is the job the old light beam was
        // doing — being findable from across the meadow — done legibly.
        const distance = visual.bubble.position.distanceTo(context.camera.position)
        const grow = clamp(distance / 17, 1, 1.9)
        const pop = easeOutBack(clamp01(visual.bubblePop))
        const excite = 1 + visual.eager * 0.22 + Math.sin(time * 9) * 0.03 * visual.eager
        visual.bubble.scale.setScalar(grow * pop * excite * 0.95)
        visual.bubbleMesh.rotation.z = Math.sin(time * 1.4 + critter.hue * 5) * 0.08
      }

      // The ring teaches the serve radius without a word of UI, and brightening
      // it on approach is the "you can do it now" tell.
      const ringShow = lost ? smoothstep(NOTICE_RANGE * 0.7, 3, toPlayer) : 0
      visual.ring.visible = ringShow > 0.01
      if (visual.ring.visible) {
        visual.ringMaterial.opacity =
          ringShow * (0.14 + visual.eager * 0.3 + Math.sin(time * 2.6 + critter.hue * 6) * 0.03)
        const breath = 1 + Math.sin(time * 2.2 + critter.hue * 6) * 0.03 + visual.eager * 0.06
        visual.ring.scale.setScalar(breath / visual.scale)
      }
    }
  }

  dispose() {
    for (const visual of this.visuals.values()) {
      ;(visual.bodyMesh.material as MeshStandardMaterial).dispose()
      ;(visual.bubbleMesh.material as MeshBasicMaterial).dispose()
      visual.ringMaterial.dispose()
    }
    this.bubbleGeometry.dispose()
    this.ringGeometry.dispose()
    for (const geometry of this.geometryCache.values()) {
      geometry.body.dispose()
      geometry.head.dispose()
      geometry.ear.dispose()
      geometry.tail.dispose()
    }
  }
}
