import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type Texture,
} from 'three'
import { clamp01, lerp } from '../core/math'
import { mulberry32, randRange } from '../core/rng'

/**
 * The stuff hanging in the air.
 *
 * By day it's pollen and seed fluff catching the light; as the sun goes down the
 * same motes warm, slow, sink and start blinking, and the meadow fills with
 * fireflies. It's one instanced draw call and it does more for the feeling of a
 * *place* than almost anything else per unit of cost — a world with nothing in
 * the air between the camera and the horizon reads as a diorama.
 *
 * The motes live in a box that follows the camera and wraps around it, so the
 * player is always inside the swarm without ever needing more than a few dozen.
 */

/**
 * A quad with an explicit white `color` attribute.
 *
 * `vertexColors: true` makes the shader read a `color` attribute whether or not
 * the geometry has one; leaning on the driver's default for a missing attribute
 * is the kind of thing that works until it doesn't. Being explicit costs four
 * vertices and removes the question.
 */
function whiteQuad() {
  const geometry = new PlaneGeometry(1, 1)
  const count = geometry.attributes.position.count
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(1), 3))
  return geometry
}

const POLLEN = new Color('#fff4c8')
const FIREFLY = new Color('#ffd25e')

interface Mote {
  x: number
  y: number
  z: number
  driftX: number
  driftZ: number
  rise: number
  phase: number
  size: number
  /** Fireflies blink at their own rate; pollen just twinkles faintly. */
  blinkRate: number
}

export interface MoteOptions {
  count: number
  /** Half-extent of the box the motes wrap inside, in metres. */
  radius: number
}

export class Motes {
  readonly mesh: InstancedMesh

  private readonly motes: Mote[] = []
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly scale = new Vector3()
  private readonly tint = new Color()
  private readonly radius: number

  constructor(options: MoteOptions, alphaMap: Texture) {
    this.radius = options.radius

    const material = new MeshBasicMaterial({
      alphaMap,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      // Billboards can end up back-facing for a frame after a camera reset, and a
      // culled mote is a mote that pops.
      side: DoubleSide,
      fog: true,
      toneMapped: true,
    })

    this.mesh = new InstancedMesh(whiteQuad(), material, options.count)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
    this.mesh.setColorAt(0, POLLEN)

    const rng = mulberry32(0x3f1e)
    for (let index = 0; index < options.count; index += 1) {
      this.motes.push({
        x: randRange(rng, -this.radius, this.radius),
        y: randRange(rng, 0.3, 5.5),
        z: randRange(rng, -this.radius, this.radius),
        driftX: randRange(rng, -0.28, 0.28),
        driftZ: randRange(rng, -0.28, 0.28),
        rise: randRange(rng, -0.06, 0.14),
        phase: rng() * Math.PI * 2,
        size: randRange(rng, 0.09, 0.21),
        blinkRate: randRange(rng, 0.5, 1.5),
      })
    }
  }

  /**
   * @param dusk  0-1; fades pollen into fireflies
   * @param wind  current gust, so the motes get pushed around with the grass
   */
  update(camera: Camera, dt: number, time: number, dusk: number, wind: number) {
    const evening = clamp01(dusk)
    // Fireflies drift lower and slower than pollen on the breeze.
    const drift = lerp(1, 0.35, evening)
    const ceiling = lerp(5.5, 3.2, evening)

    // Billboard: every mote takes the camera's orientation, so they always face
    // the lens without a custom shader.
    this.quaternion.setFromRotationMatrix(camera.matrixWorld)

    const centreX = camera.position.x
    const centreZ = camera.position.z
    const span = this.radius * 2

    for (let index = 0; index < this.motes.length; index += 1) {
      const mote = this.motes[index]

      mote.x += (mote.driftX * drift + wind * 0.35) * dt
      mote.z += mote.driftZ * drift * dt
      mote.y += mote.rise * drift * dt
      // A gentle bob so they never look like they're on rails.
      const bob = Math.sin(time * 0.9 + mote.phase) * 0.12

      // Wrap the box around the camera rather than respawning: no popping, and
      // the swarm is always centred on the player for free.
      if (mote.x - centreX > this.radius) mote.x -= span
      if (mote.x - centreX < -this.radius) mote.x += span
      if (mote.z - centreZ > this.radius) mote.z -= span
      if (mote.z - centreZ < -this.radius) mote.z += span
      if (mote.y > ceiling) mote.y = 0.3
      if (mote.y < 0.2) mote.y = ceiling

      // Pollen twinkles faintly; fireflies pulse right down to dark and back.
      const pulse = Math.sin(time * mote.blinkRate * 2.4 + mote.phase) * 0.5 + 0.5
      const brightness = lerp(0.3 + pulse * 0.22, 0.35 + pulse * pulse * 2.6, evening)

      this.position.set(mote.x, mote.y + bob, mote.z)
      this.scale.setScalar(mote.size * lerp(1, 2.1, evening))
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(index, this.matrix)

      this.tint.copy(POLLEN).lerp(FIREFLY, evening).multiplyScalar(brightness)
      this.mesh.setColorAt(index, this.tint)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
    this.mesh.dispose()
  }
}
