import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp01, damp, smoothstep } from '../core/math'
import { mulberry32, randRange } from '../core/rng'

/**
 * Birds, skimming the meadow.
 *
 * Like the butterflies they arrive with the colour: none at all over a grey
 * valley, a few crossing the frame over a woken one. Nothing about them is
 * interactive, and that's the point — they're the part of the world that is
 * going about its business whether or not the player is looking.
 *
 * One instanced draw call, with the wingbeat done in the vertex shader off a
 * per-vertex side flag and a per-instance phase.
 */

interface Bird {
  radius: number
  height: number
  speed: number
  phase: number
  /** Where the centre of this bird's circuit sits, relative to the meadow. */
  centreX: number
  centreZ: number
  size: number
  /** Beats hard, then glides, on its own slow cycle. */
  glidePhase: number
}

/**
 * Pale on purpose.
 *
 * A dark bird crossing a green meadow at twenty metres doesn't read as a bird —
 * it reads as a hole in the render. Cream with grey tips is what a child draws,
 * and it stays legible against grass, trees and sky alike.
 */
const BIRD_BODY = new Color('#f3ead7')
const BIRD_TIP = new Color('#8e97a3')

/** Wing outline in the ground plane: x outward from the hinge, z fore and aft. */
const WING_OUTLINE: [number, number][] = [
  [0.03, 0.11],
  [0.22, 0.2],
  [0.44, 0.17],
  [0.6, 0.03],
  [0.44, -0.13],
  [0.19, -0.2],
  [0.04, -0.14],
]

function buildBirdGeometry() {
  const parts: BufferGeometry[] = []
  const sides: number[] = []

  const push = (source: BufferGeometry, color: Color | null, wing: number) => {
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

  const body = new SphereGeometry(0.1, 7, 6)
  body.scale(0.85, 0.75, 2.1)
  push(body, BIRD_BODY, 0)

  const head = new SphereGeometry(0.062, 6, 5)
  head.translate(0, 0.018, 0.19)
  push(head, BIRD_BODY, 0)

  // Tail fan.
  const tail = new BufferGeometry()
  tail.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([0.0, 0, -0.16, 0.12, 0, -0.34, -0.12, 0, -0.34]),
      3,
    ),
  )
  tail.computeVertexNormals()
  push(tail, BIRD_BODY, 0)

  for (const side of [-1, 1]) {
    const vertices: number[] = []
    const colors: number[] = []
    for (let index = 1; index < WING_OUTLINE.length - 1; index += 1) {
      for (const point of [0, index, index + 1]) {
        const [x, z] = WING_OUTLINE[point]
        vertices.push(x * side, 0, z)
        // Darken toward the tip so the wing has an edge to it in silhouette.
        const tip = Math.min(1, x / 0.6)
        const shade = BIRD_BODY.clone().lerp(BIRD_TIP, tip * tip)
        colors.push(shade.r, shade.g, shade.b)
      }
    }
    const wing = new BufferGeometry()
    wing.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
    wing.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    wing.computeVertexNormals()
    push(wing, null, side)
  }

  const merged = mergeGeometries(parts, false)
  merged.setAttribute('aWing', new BufferAttribute(new Float32Array(sides), 1))
  merged.computeBoundingSphere()
  return merged
}

function buildMaterial(time: { value: number }) {
  // Unlit and unfogged: they're small and far, and any shading at this size just
  // makes them flicker as they turn.
  const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aWing;
attribute vec2 aBeat;
uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  // aBeat.x is this bird's phase, aBeat.y its wingbeat rate. The envelope drops
  // to nearly nothing every few seconds, which reads as a glide.
  //
  // The stroke never passes through flat. The camera sits barely above them, and
  // a level wing seen edge-on is a one-pixel dash — held in a shallow V they keep
  // the M-shaped silhouette that says "bird" at any distance.
  float envelope = 0.25 + 0.75 * smoothstep( -0.2, 0.8, sin( uTime * 0.31 + aBeat.x * 2.0 ) );
  float angle = ( 0.55 + 0.5 * sin( uTime * aBeat.y + aBeat.x ) * envelope ) * aWing;
  float c = cos( angle );
  float s = sin( angle );
  transformed.xy = vec2( transformed.x * c - transformed.y * s, transformed.x * s + transformed.y * c );
}`,
      )
  }

  return material
}

export interface BirdOptions {
  count: number
}

export class Birds {
  readonly mesh: InstancedMesh

  private readonly flock: Bird[] = []
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly bank = new Quaternion()
  private readonly scale = new Vector3()
  private readonly time = { value: 0 }
  private presence = 0

  constructor(options: BirdOptions, seed: number) {
    const geometry = buildBirdGeometry()
    this.mesh = new InstancedMesh(geometry, buildMaterial(this.time), options.count)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2

    const beats = new Float32Array(options.count * 2)
    const rng = mulberry32(seed ^ 0x11d3)

    for (let index = 0; index < options.count; index += 1) {
      // Low and wide rather than high overhead.
      //
      // The chase rig looks *down* at Lammy, and the HUD covers what little sits
      // above the horizon, so a bird circling at any real altitude is never once
      // in frame. These skim the meadow at treetop height instead, crossing the
      // middle of the picture where they can actually be seen.
      this.flock.push({
        radius: randRange(rng, 16, 31),
        height: randRange(rng, 1.9, 3.4),
        speed: randRange(rng, 0.05, 0.1) * (rng() > 0.5 ? 1 : -1),
        phase: rng() * Math.PI * 2,
        centreX: 0,
        centreZ: 0,
        size: randRange(rng, 2.4, 3.6),
        glidePhase: rng() * Math.PI * 2,
      })
      beats[index * 2] = rng() * Math.PI * 2
      beats[index * 2 + 1] = randRange(rng, 5.5, 8)
    }

    geometry.setAttribute('aBeat', new InstancedBufferAttribute(beats, 2))
  }

  /**
   * @param bloom fraction of the valley with its colour back, 0-1
   * @param heightAt ground height, so the circuits follow the hills
   */
  update(
    dt: number,
    time: number,
    bloom: number,
    playerX: number,
    playerZ: number,
    heightAt: (x: number, z: number) => number,
  ) {
    this.time.value = time
    // They come back as the valley does, and never all at once.
    this.presence = smoothstep(0.05, 0.6, clamp01(bloom))
    this.mesh.visible = this.presence > 0.01
    if (!this.mesh.visible) return

    for (let index = 0; index < this.flock.length; index += 1) {
      const bird = this.flock[index]
      // The circuit drifts after Lammy instead of being pinned to the meadow's
      // centre — slowly enough that it reads as birds that happen to be around
      // rather than as birds tethered to the player.
      bird.centreX = damp(bird.centreX, playerX, 0.25, dt)
      bird.centreZ = damp(bird.centreZ, playerZ, 0.25, dt)

      const angle = bird.phase + time * bird.speed
      const x = bird.centreX + Math.cos(angle) * bird.radius
      const z = bird.centreZ + Math.sin(angle) * bird.radius
      // The circuit rises and falls on a long, slow breath.
      const y = heightAt(x, z) + bird.height + Math.sin(time * 0.21 + bird.glidePhase) * 0.7

      this.position.set(x, y, z)
      // Face along the tangent of the circuit, and bank into the turn.
      const heading = angle + (bird.speed > 0 ? Math.PI / 2 : -Math.PI / 2)
      this.quaternion.setFromAxisAngle(UP, heading)
      this.bank.setFromAxisAngle(FORWARD, bird.speed > 0 ? -0.34 : 0.34)
      this.quaternion.multiply(this.bank)
      this.scale.setScalar(bird.size * this.presence)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(index, this.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
    this.mesh.dispose()
  }
}

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
