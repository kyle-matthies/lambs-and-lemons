import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp01, damp, dampAngle, smoothstep } from '../core/math'
import { mulberry32, pick, randRange } from '../core/rng'

/**
 * Butterflies.
 *
 * They are the meadow's proof of life, and they are hooked straight to the
 * mechanic: each one only appears once the patch of grass it lives over has its
 * colour back, so waking the valley visibly repopulates it rather than just
 * re-tinting it. Run through one and it bursts upward and flees, which is the
 * cheapest interaction in the game and the one most likely to make a six-year-old
 * chase it on purpose.
 *
 * One instanced draw call. The wings flap in the vertex shader off a per-vertex
 * side flag and a per-instance phase, so nothing has to be re-uploaded per frame
 * except the instance matrices.
 */

const WING_COLORS = [
  new Color('#ffd94a'),
  new Color('#ff9ec9'),
  new Color('#8fd3ff'),
  new Color('#ffb04a'),
  new Color('#c4a4ff'),
  new Color('#fff2d0'),
]

const BODY_COLOR = new Color('#5b4032')

/**
 * A wing, as a triangle fan around its hinge.
 *
 * Rectangles read as confetti from the game's high camera; the notched teardrop
 * outline is what makes a two-triangle thing say "butterfly" at a glance. The
 * vertex colour darkens toward the tip so the wing has some shape to it even
 * flat-on to the sun, and the instance colour multiplies over the top.
 */
function buildWing(outline: [number, number][], side: number) {
  const vertices: number[] = []
  const colors: number[] = []
  const uvs: number[] = []

  const shade = (index: number) => {
    // 1 at the hinge, darker at the rim.
    const t = index === 0 ? 0 : 1
    return 1 - t * 0.22
  }

  for (let index = 1; index < outline.length - 1; index += 1) {
    const fan = [0, index, index + 1]
    for (const point of fan) {
      const [x, z] = outline[point]
      vertices.push(x * side, 0, z)
      const value = shade(point)
      colors.push(value, value, value)
      uvs.push(0, 0)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.computeVertexNormals()
  return geometry
}

const UPPER_WING: [number, number][] = [
  [0.012, 0.01],
  [0.05, 0.085],
  [0.115, 0.105],
  [0.165, 0.06],
  [0.172, -0.01],
  [0.12, -0.045],
  [0.05, -0.04],
]

const LOWER_WING: [number, number][] = [
  [0.012, -0.03],
  [0.055, -0.05],
  [0.105, -0.085],
  [0.115, -0.14],
  [0.075, -0.165],
  [0.03, -0.12],
]

/**
 * Body plus four wings, with an `aWing` side flag the shader uses to flap them.
 * The hinge is the body axis, so the flag is just the sign of x.
 */
function buildButterflyGeometry() {
  const parts: BufferGeometry[] = []
  const sides: number[] = []

  const push = (source: BufferGeometry, color: Color | null, wing: number) => {
    // The wings are authored as raw triangle fans and the body comes from the
    // indexed primitives, so everything is flattened before the merge — mixing
    // indexed and non-indexed geometry makes `mergeGeometries` bail.
    const geometry = source.index ? source.toNonIndexed() : source
    if (geometry !== source) source.dispose()

    const count = geometry.attributes.position.count
    if (color) {
      const colors = new Float32Array(count * 3)
      for (let index = 0; index < count; index += 1) {
        colors[index * 3] = color.r
        colors[index * 3 + 1] = color.g
        colors[index * 3 + 2] = color.b
      }
      geometry.setAttribute('color', new BufferAttribute(colors, 3))
    }
    if (!geometry.attributes.uv) {
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
    }
    for (let index = 0; index < count; index += 1) sides.push(wing)
    parts.push(geometry)
  }

  const body = new CylinderGeometry(0.015, 0.009, 0.14, 5, 1)
  body.rotateX(Math.PI / 2)
  push(body, BODY_COLOR, 0)

  const head = new SphereGeometry(0.019, 5, 4)
  head.translate(0, 0.002, 0.077)
  push(head, BODY_COLOR, 0)

  for (const side of [-1, 1]) {
    push(buildWing(UPPER_WING, side), null, side)
    push(buildWing(LOWER_WING, side), null, side)
  }

  const merged = mergeGeometries(parts, false)
  merged.setAttribute('aWing', new BufferAttribute(new Float32Array(sides), 1))
  merged.computeBoundingSphere()
  return merged
}

function buildMaterial(time: { value: number }) {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0,
    side: DoubleSide,
    // A touch of self-light so they still read as bright flecks in the shade of
    // a tree, which is exactly where a butterfly likes to be.
    emissive: new Color('#3a2f14'),
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aWing;
attribute float aFlap;
uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  // Fast beat that never lies fully flat — seen from the game's high camera, a
  // flat wing is a coloured rectangle and stops reading as a butterfly.
  float beat = sin( uTime * 13.0 + aFlap );
  float angle = ( beat * 0.42 + 0.62 ) * 1.3 * aWing;
  float c = cos( angle );
  float s = sin( angle );
  transformed.xy = vec2( transformed.x * c - transformed.y * s, transformed.x * s + transformed.y * c );
}`,
      )
  }

  return material
}

interface Butterfly {
  x: number
  y: number
  z: number
  homeX: number
  homeZ: number
  targetX: number
  targetZ: number
  yaw: number
  phase: number
  hover: number
  restTimer: number
  spooked: number
  /** Eased 0-1 presence, driven by how much colour its patch has back. */
  presence: number
  size: number
}

/** Inside this, Lammy scatters them. */
const SPOOK_RADIUS = 2.4

export interface ButterflyOptions {
  count: number
  /** Radius of the meadow they're scattered across. */
  radius: number
}

export class Butterflies {
  readonly mesh: InstancedMesh

  private readonly swarm: Butterfly[] = []
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly scale = new Vector3()
  private readonly time = { value: 0 }

  constructor(options: ButterflyOptions, seed: number) {
    const geometry = buildButterflyGeometry()
    const material = buildMaterial(this.time)

    this.mesh = new InstancedMesh(geometry, material, options.count)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.renderOrder = 3

    const flaps = new Float32Array(options.count)
    const rng = mulberry32(seed ^ 0x8f2c)

    for (let index = 0; index < options.count; index += 1) {
      const angle = rng() * Math.PI * 2
      const distance = randRange(rng, 4, options.radius - 2)
      const x = Math.cos(angle) * distance
      const z = Math.sin(angle) * distance
      flaps[index] = rng() * Math.PI * 2
      this.swarm.push({
        x,
        y: 0,
        z,
        homeX: x,
        homeZ: z,
        targetX: x,
        targetZ: z,
        yaw: rng() * Math.PI * 2,
        phase: rng() * Math.PI * 2,
        hover: randRange(rng, 1.0, 2.4),
        restTimer: randRange(rng, 0, 2.5),
        spooked: 0,
        presence: 0,
        size: randRange(rng, 1.05, 1.65),
      })
      this.mesh.setColorAt(index, pick(rng, WING_COLORS))
    }

    geometry.setAttribute('aFlap', new InstancedBufferAttribute(flaps, 1))
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  /**
   * @param bloomAt how much colour a spot has back, 0-1 — gates whether a
   *        butterfly is there at all
   * @param heightAt ground height, so they hover over hills rather than through them
   */
  update(
    dt: number,
    time: number,
    playerX: number,
    playerZ: number,
    bloomAt: (x: number, z: number) => number,
    heightAt: (x: number, z: number) => number,
  ) {
    this.time.value = time

    for (let index = 0; index < this.swarm.length; index += 1) {
      const bug = this.swarm[index]

      // Presence follows the colour under their patch, so they arrive with the
      // bloom rather than all at once.
      const wanted = smoothstep(0.12, 0.55, bloomAt(bug.homeX, bug.homeZ))
      bug.presence = damp(bug.presence, wanted, 1.6, dt)

      const toPlayer = Math.hypot(bug.x - playerX, bug.z - playerZ)
      if (toPlayer < SPOOK_RADIUS && bug.presence > 0.2) {
        bug.spooked = 1.6
        // Straight away from her, and further than she can reach in that time.
        const away = Math.atan2(bug.x - playerX, bug.z - playerZ)
        bug.targetX = bug.x + Math.sin(away) * 5.5
        bug.targetZ = bug.z + Math.cos(away) * 5.5
      }

      let speed: number
      if (bug.spooked > 0) {
        bug.spooked = Math.max(0, bug.spooked - dt)
        speed = 4.2
      } else {
        speed = 1.15
        bug.restTimer -= dt
        const arrived = Math.hypot(bug.targetX - bug.x, bug.targetZ - bug.z) < 0.35
        if (arrived || bug.restTimer <= 0) {
          // Short hops between flowers, always drifting back toward home.
          bug.restTimer = 1.2 + Math.random() * 2.4
          const angle = Math.random() * Math.PI * 2
          const reach = 1.5 + Math.random() * 3
          bug.targetX = bug.homeX + Math.cos(angle) * reach
          bug.targetZ = bug.homeZ + Math.sin(angle) * reach
        }
      }

      const dx = bug.targetX - bug.x
      const dz = bug.targetZ - bug.z
      const distance = Math.hypot(dx, dz)
      if (distance > 0.02) {
        bug.yaw = dampAngle(bug.yaw, Math.atan2(dx, dz), 6, dt)
        const step = Math.min(distance, speed * dt)
        bug.x += (dx / distance) * step
        bug.z += (dz / distance) * step
      }

      // A bobbing flight path, lifting sharply when startled.
      const lift = bug.hover + bug.spooked * 1.4 + Math.sin(time * 2.6 + bug.phase) * 0.22
      bug.y = damp(bug.y, heightAt(bug.x, bug.z) + lift, 6, dt)

      this.position.set(bug.x, bug.y, bug.z)
      // Bank into the turn a little; a butterfly that stays dead level reads as
      // a sprite on a rail.
      this.quaternion.setFromAxisAngle(UP, bug.yaw)
      this.quaternion.multiply(
        TILT.setFromAxisAngle(FORWARD, Math.sin(time * 1.7 + bug.phase) * 0.4),
      )
      const scale = clamp01(bug.presence) * bug.size
      this.scale.setScalar(scale)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(index, this.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshStandardMaterial).dispose()
    this.mesh.dispose()
  }
}

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const TILT = new Quaternion()
