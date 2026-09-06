import {
  AdditiveBlending,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

/**
 * The bloom map: a top-down accumulation buffer covering the whole valley, in which
 * every zest burst leaves a soft radial stain. World materials sample it to decide
 * how much colour a surface has got back.
 *
 * It is deliberately an *accumulation* target — we never clear between frames, only
 * draw the handful of new splats each tick, so the cost is a few dozen additive
 * quads regardless of how long the round has run.
 *
 * The simulation keeps its own coarse mirror of this in `src/game/bloom.ts`; that
 * one is authoritative for gameplay, this one is what the shaders sample.
 */

import { BLOOM_AREA } from '../game/bloom'

const MAX_SPLATS_PER_FRAME = 96

interface PendingSplat {
  x: number
  z: number
  radius: number
  strength: number
}

// `instanceMatrix` / `instanceColor` are declared for us by three's ShaderMaterial
// prefix whenever the object is an InstancedMesh with per-instance colour.
const SPLAT_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vInstanceColor;
void main() {
  vUv = uv;
  vInstanceColor = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}
`

const SPLAT_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vInstanceColor;
void main() {
  float d = length( vUv - 0.5 ) * 2.0;
  if ( d > 1.0 ) discard;
  // Squared falloff with a soft shoulder: dense in the middle, feathered at the rim.
  float falloff = 1.0 - d;
  float a = falloff * falloff * ( 0.55 + 0.45 * falloff );
  gl_FragColor = vec4( vec3( a * vInstanceColor.r ), 1.0 );
}
`

export class BloomMap {
  readonly target: WebGLRenderTarget
  private readonly scene = new Scene()
  private readonly camera: OrthographicCamera
  private readonly mesh: InstancedMesh
  private readonly pending: PendingSplat[] = []
  private readonly matrix = new Matrix4()
  private readonly color = new Color()
  private readonly previousClearColor = new Color()
  private needsClear = true

  constructor(resolution = 512) {
    this.target = new WebGLRenderTarget(resolution, resolution, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    this.target.texture.name = 'BloomMap'

    const half = BLOOM_AREA / 2
    this.camera = new OrthographicCamera(-half, half, half, -half, -10, 10)
    this.camera.position.set(0, 0, 5)

    const material = new ShaderMaterial({
      vertexShader: SPLAT_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })

    this.mesh = new InstancedMesh(
      new PlaneGeometry(1, 1),
      material,
      MAX_SPLATS_PER_FRAME,
    )
    this.mesh.frustumCulled = false
    // Allocate the instance colour buffer up front: per-splat strength rides in the
    // red channel, and the attribute has to exist before the first compile so the
    // USE_INSTANCING_COLOR define is set.
    this.mesh.setColorAt(0, this.color.setRGB(1, 0, 0))
    this.mesh.count = 0
    this.scene.add(this.mesh)
  }

  /** Queue a burst of colour centred on a world XZ position. */
  splat(x: number, z: number, radius: number, strength: number) {
    if (this.pending.length >= MAX_SPLATS_PER_FRAME) return
    this.pending.push({ x, z, radius, strength })
  }

  /**
   * Fill the buffer completely — the visual half of `floodBloom`, for the moment
   * the valley wakes. A splat can't do this: its falloff always feathers the rim.
   */
  flood(renderer: WebGLRenderer) {
    const previousTarget = renderer.getRenderTarget()
    renderer.getClearColor(this.previousClearColor)
    const previousClearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0xffffff, 1)
    renderer.clear(true, false, false)
    renderer.setClearColor(this.previousClearColor, previousClearAlpha)
    renderer.setRenderTarget(previousTarget)
    this.pending.length = 0
    this.needsClear = false
  }

  /** Rehydrate the authoritative colour field when Safari restores a chapter. */
  restore(renderer: WebGLRenderer, cells: Float32Array) {
    const side = Math.sqrt(cells.length)
    const pixels = new Uint8Array(cells.length * 4)
    cells.forEach((value, i) => {
      pixels[i * 4] = Math.round(value * 255)
      pixels[i * 4 + 3] = 255
    })
    const texture = new DataTexture(pixels, side, side, RGBAFormat)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.needsUpdate = true
    const material = new MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    })
    const geometry = new PlaneGeometry(BLOOM_AREA, BLOOM_AREA)
    const scene = new Scene()
    scene.add(new Mesh(geometry, material))
    const previous = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(scene, this.camera)
    renderer.setRenderTarget(previous)
    texture.dispose()
    geometry.dispose()
    material.dispose()
    this.pending.length = 0
    this.needsClear = false
  }

  /** Wipe the valley back to grey — called when a fresh round begins. */
  reset() {
    this.pending.length = 0
    this.needsClear = true
  }

  /**
   * Flush queued splats into the accumulation buffer. Cheap enough to call every
   * frame; does nothing when nothing new happened.
   */
  render(renderer: WebGLRenderer) {
    if (!this.needsClear && this.pending.length === 0) return

    const previousTarget = renderer.getRenderTarget()
    const previousAutoClear = renderer.autoClear
    renderer.getClearColor(this.previousClearColor)
    const previousClearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.target)

    if (this.needsClear) {
      renderer.setClearColor(0x000000, 1)
      renderer.clear(true, false, false)
      this.needsClear = false
    }

    if (this.pending.length > 0) {
      renderer.autoClear = false
      const count = Math.min(this.pending.length, MAX_SPLATS_PER_FRAME)
      for (let index = 0; index < count; index += 1) {
        const splat = this.pending[index]
        this.matrix.makeScale(splat.radius * 2, splat.radius * 2, 1)
        this.matrix.setPosition(splat.x, splat.z, 0)
        this.mesh.setMatrixAt(index, this.matrix)
        this.color.setRGB(splat.strength, 0, 0)
        this.mesh.setColorAt(index, this.color)
      }
      this.mesh.count = count
      this.mesh.instanceMatrix.needsUpdate = true
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
      renderer.render(this.scene, this.camera)
      this.pending.length = 0
    }

    renderer.autoClear = previousAutoClear
    renderer.setClearColor(this.previousClearColor, previousClearAlpha)
    renderer.setRenderTarget(previousTarget)
  }

  dispose() {
    this.target.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
    this.mesh.dispose()
  }
}
