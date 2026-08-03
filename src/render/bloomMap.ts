import {
  AdditiveBlending,
  Color,
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
 */

export const BLOOM_AREA = 96
export const BLOOM_ORIGIN = -BLOOM_AREA / 2

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

    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, MAX_SPLATS_PER_FRAME)
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
