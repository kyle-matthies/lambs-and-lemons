import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type IUniform,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp01, damp, easeOutBack, lerp } from '../core/math'
import { mulberry32, randRange, type Rng } from '../core/rng'
import { CRITTER_BLOOM_TIME } from '../game/constants'
import type { Critter, CritterKind } from '../game/types'
import { paint } from './geometryUtils'
import { PALETTE } from './palette'
import { applyValleyShading, type ValleyUniforms } from './valleyShading'

/**
 * The valley's lost creatures, and the flock they become.
 *
 * Each animal is two merged meshes — body (with legs and tail) and head (with
 * ears and face) — which keeps the whole herd to a couple of dozen draw calls
 * while still leaving enough joints to act with: a slumped head and a dragging
 * shuffle when lost, a bounce and a lifted chin once they're following.
 *
 * Every critter owns a `localHeal` uniform so that a freed animal stays in full
 * colour even while it is standing in a part of the meadow that is still grey.
 */

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
}

const RECIPES: Record<CritterKind, KindRecipe> = {
  lamb: {
    bodyRadius: 0.26,
    bodyStretch: 1.24,
    legHeight: 0.22,
    headRadius: 0.16,
    headForward: 0.24,
    body: PALETTE.wool,
    belly: PALETTE.woolShade,
    face: PALETTE.skin,
    inner: new Color('#f7b7ab'),
    earKind: 'floppy',
    fluffy: true,
  },
  bunny: {
    bodyRadius: 0.22,
    bodyStretch: 1.1,
    legHeight: 0.18,
    headRadius: 0.15,
    headForward: 0.2,
    body: new Color('#d3c3ae'),
    belly: new Color('#f2e8da'),
    face: new Color('#dccdb9'),
    inner: new Color('#f3aebb'),
    earKind: 'long',
    fluffy: false,
  },
  piglet: {
    bodyRadius: 0.27,
    bodyStretch: 1.16,
    legHeight: 0.19,
    headRadius: 0.17,
    headForward: 0.22,
    body: new Color('#f4b3bd'),
    belly: new Color('#fbd3d8'),
    face: new Color('#f6c0c8'),
    inner: new Color('#e2909c'),
    earKind: 'small',
    fluffy: false,
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

  const tail =
    recipe.earKind === 'long'
      ? new SphereGeometry(0.075, 7, 6)
      : new SphereGeometry(0.055, 7, 6)
  tail.translate(0, recipe.legHeight + recipe.bodyRadius * 1.05, -recipe.bodyRadius * recipe.bodyStretch)
  parts.push(paint(tail, recipe.earKind === 'long' ? new Color('#fdf6ea') : recipe.body))

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

function buildHead(recipe: KindRecipe, rng: Rng) {
  const parts: BufferGeometry[] = []

  const skull = new SphereGeometry(recipe.headRadius, 12, 9)
  parts.push(paint(skull, recipe.face))

  if (recipe.fluffy) {
    for (let index = 0; index < 5; index += 1) {
      const curl = new SphereGeometry(randRange(rng, 0.055, 0.075), 6, 5)
      const angle = -0.6 + (index / 4) * 2.2
      curl.translate(Math.cos(angle) * recipe.headRadius * 0.75, recipe.headRadius * 0.7, -0.02)
      parts.push(paint(curl, recipe.body))
    }
  }

  // Snout / muzzle.
  const snout = new SphereGeometry(recipe.headRadius * 0.55, 9, 7)
  snout.scale(1, recipe.earKind === 'small' ? 0.75 : 0.85, 1)
  snout.translate(0, -recipe.headRadius * 0.32, recipe.headRadius * 0.86)
  parts.push(paint(snout, recipe.earKind === 'small' ? recipe.inner : recipe.face))

  const nose = new SphereGeometry(recipe.headRadius * 0.17, 6, 5)
  nose.scale(1.4, 0.85, 1)
  nose.translate(0, -recipe.headRadius * 0.24, recipe.headRadius * 1.28)
  parts.push(paint(nose, new Color('#c9757f')))

  // Eyes with catchlights — the single biggest readability win at this scale.
  for (const side of [-1, 1]) {
    const eye = new SphereGeometry(recipe.headRadius * 0.28, 9, 7)
    eye.translate(side * recipe.headRadius * 0.48, recipe.headRadius * 0.14, recipe.headRadius * 0.82)
    parts.push(paint(eye, new Color('#2b2118')))

    const glint = new SphereGeometry(recipe.headRadius * 0.11, 6, 5)
    glint.translate(
      side * recipe.headRadius * 0.4,
      recipe.headRadius * 0.28,
      recipe.headRadius * 1.02,
    )
    parts.push(paint(glint, new Color('#ffffff')))
  }

  // Ears.
  for (const side of [-1, 1]) {
    let ear: BufferGeometry
    if (recipe.earKind === 'long') {
      ear = new SphereGeometry(0.06, 8, 6)
      ear.scale(0.55, 2.5, 0.4)
      ear.translate(side * recipe.headRadius * 0.5, recipe.headRadius * 1.25, -0.01)
      ear.rotateZ(side * 0.18)
    } else if (recipe.earKind === 'floppy') {
      ear = new SphereGeometry(0.07, 8, 6)
      ear.scale(1.5, 0.42, 0.8)
      ear.translate(side * recipe.headRadius * 0.95, recipe.headRadius * 0.35, 0)
    } else {
      ear = new ConeGeometry(0.055, 0.09, 6, 1)
      ear.translate(side * recipe.headRadius * 0.62, recipe.headRadius * 0.95, -0.02)
      ear.rotateZ(side * -0.3)
    }
    parts.push(paint(ear, recipe.inner))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  return merged
}

const BEACON_HEIGHT = 3.1

function buildBeaconGeometry() {
  const geometry = new CylinderGeometry(0.34, 0.1, BEACON_HEIGHT, 12, 4, true)
  geometry.translate(0, BEACON_HEIGHT / 2, 0)

  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 4)
  for (let index = 0; index < position.count; index += 1) {
    const t = clamp01(position.getY(index) / BEACON_HEIGHT)
    colors[index * 4] = 1
    colors[index * 4 + 1] = 1
    colors[index * 4 + 2] = 1
    // Brightest just above the ground, gone by the top.
    colors[index * 4 + 3] = (1 - t) * (1 - t) * (0.35 + 0.65 * (1 - t))
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 4))
  return geometry
}

function buildBeaconMaterial() {
  return new MeshBasicMaterial({
    color: new Color('#fff0a8'),
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
    toneMapped: true,
  })
}

interface CritterVisual {
  group: Group
  body: Group
  bodyMesh: Mesh
  head: Group
  beacon: Mesh
  localHeal: IUniform<number>
  scale: number
}

export class CritterHerd {
  readonly group = new Group()
  private readonly visuals = new Map<number, CritterVisual>()
  private readonly geometryCache = new Map<CritterKind, { body: BufferGeometry; head: BufferGeometry }>()

  private readonly uniforms: ValleyUniforms
  private readonly detail: Texture

  constructor(critters: Critter[], uniforms: ValleyUniforms, detail: Texture) {
    this.uniforms = uniforms
    this.detail = detail
    this.group.name = 'critters'
    for (const critter of critters) this.visuals.set(critter.id, this.build(critter))
  }

  private geometryFor(kind: CritterKind) {
    const cached = this.geometryCache.get(kind)
    if (cached) return cached
    const rng = mulberry32(0x5eed + kind.length * 7919)
    const recipe = RECIPES[kind]
    const built = { body: buildBody(recipe, rng), head: buildHead(recipe, rng) }
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
    head.position.set(0, recipe.legHeight + recipe.bodyRadius * 1.35, recipe.headForward + recipe.bodyRadius * 0.5)
    const headMesh = new Mesh(geometry.head, material)
    headMesh.castShadow = true
    head.add(headMesh)
    body.add(head)
    group.add(body)

    // A soft beam so a lost creature can be spotted across the meadow. The alpha
    // is baked per-vertex so it fades out at the top instead of ending in a hard
    // ring — three enables USE_COLOR_ALPHA automatically for a 4-wide attribute.
    const beacon = new Mesh(buildBeaconGeometry(), buildBeaconMaterial())
    beacon.renderOrder = 6
    group.add(beacon)

    const scale = lerp(0.86, 1.12, critter.hue)
    group.scale.setScalar(scale)
    this.group.add(group)

    return { group, body, bodyMesh, head, beacon, localHeal, scale }
  }

  update(critters: Critter[], dt: number, time: number) {
    for (const critter of critters) {
      const visual = this.visuals.get(critter.id)
      if (!visual) continue

      visual.group.position.set(critter.x, critter.y, critter.z)
      visual.group.rotation.y = critter.facing

      const lost = critter.state === 'lost'
      const blooming = critter.state === 'blooming'

      // Recovery: 0 while lost, sweeping to 1 across the bloom, then held.
      const target = lost ? 0 : blooming ? 1 - clamp01(critter.bloomTimer / CRITTER_BLOOM_TIME) : 1
      visual.localHeal.value = blooming ? target : damp(visual.localHeal.value, target, 8, dt)

      // Gait: a bouncing trot whose amplitude comes from how fast they're moving.
      const speed01 = clamp01(critter.speed / 5)
      const phase = critter.gait * 4.4
      const bounce = Math.abs(Math.sin(phase)) * (0.05 + speed01 * 0.11)
      const breathe = Math.sin(time * 2.1 + critter.hue * 6) * 0.008

      if (blooming) {
        // A delighted little hop with an overshoot as the colour arrives.
        const t = 1 - clamp01(critter.bloomTimer / CRITTER_BLOOM_TIME)
        const pop = easeOutBack(clamp01(t * 1.4))
        visual.body.position.y = Math.sin(t * Math.PI) * 0.42
        visual.body.scale.setScalar(0.82 + pop * 0.22)
        visual.body.rotation.x = 0
        visual.head.rotation.x = -0.35 + Math.sin(t * Math.PI * 2) * 0.25
        visual.group.rotation.y = critter.facing + t * Math.PI * 2
      } else {
        visual.body.position.y = bounce + breathe
        visual.body.scale.setScalar(1)
        // Lost animals slump forward; freed ones stand up and look ahead.
        visual.body.rotation.x = lost ? 0.22 : -0.1 * speed01
        visual.head.rotation.x = lost
          ? 0.55 + Math.sin(time * 0.9 + critter.hue * 5) * 0.06
          : Math.sin(phase * 2) * 0.08 * speed01 - 0.08
        visual.head.rotation.z = Math.sin(time * 1.6 + critter.hue * 4) * 0.05
      }

      // Beacon only for those still waiting, pulsing so it reads at distance.
      visual.beacon.visible = lost
      if (lost) {
        const material = visual.beacon.material as MeshBasicMaterial
        material.opacity = 0.42 + Math.sin(time * 2.4 + critter.hue * 6) * 0.16
        visual.beacon.scale.setScalar(1 + Math.sin(time * 2.4 + critter.hue * 6) * 0.06)
      }
    }
  }

  dispose() {
    for (const visual of this.visuals.values()) {
      ;(visual.bodyMesh.material as MeshStandardMaterial).dispose()
      ;(visual.beacon.material as MeshBasicMaterial).dispose()
      visual.beacon.geometry.dispose()
    }
    for (const geometry of this.geometryCache.values()) {
      geometry.body.dispose()
      geometry.head.dispose()
    }
  }
}
