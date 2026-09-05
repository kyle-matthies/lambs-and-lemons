import { PerspectiveCamera, Vector3 } from 'three'
import { clamp01, damp, inverseLerp, lerp } from '../core/math'
import type { World } from '../game/world'

/**
 * A spring-damped chase camera with a fixed heading.
 *
 * The heading never rotates, which matters more than it sounds: it means "push the
 * stick up" always means "run away from the camera", so a six-year-old never has to
 * think about camera-relative controls. What the camera *does* do is lead the player
 * slightly in the direction they're running, breathe outward with speed, and reframe
 * itself for portrait phones where the usable field is tall and narrow.
 */

interface Shake {
  magnitude: number
  time: number
  duration: number
  frequency: number
}

// ~33° above the horizon in landscape, a little steeper on a phone so the play
// area still fits. Low enough that the hills, the sky and the trees read as 3D.
const LANDSCAPE = { distance: 10.4, height: 3.7, fov: 42, lookAhead: 3.2 }
const PORTRAIT = { distance: 11.4, height: 7.8, fov: 54, lookAhead: 2.0 }

/**
 * Extra upward tilt applied after the look-at, in radians.
 *
 * Aiming straight at Lammy fills the frame with ground. Tipping the lens up drops
 * her to roughly two thirds down the frame and buys a band of sky and distant
 * hills at the top — the difference between "a top-down game" and "a place".
 *
 * It trades against the rig's pitch: sky visible above the horizon is
 * `fov/2 - (pitch - tilt)`, and how far Lammy sits below centre is
 * `tan(tilt) / tan(fov/2)`. The pitch above is deliberately shallow (~19°) so
 * both can be satisfied at once.
 */
const HORIZON_TILT = 0.125

export class FollowCamera {
  readonly camera = new PerspectiveCamera(45, 1, 0.5, 800)

  private readonly target = new Vector3()
  private readonly desired = new Vector3()
  private readonly lookTarget = new Vector3()
  private readonly offset = new Vector3()
  private readonly shakeOffset = new Vector3()
  private readonly shakes: Shake[] = []
  private framing = LANDSCAPE
  private horizonTilt = HORIZON_TILT
  private boom = 1
  private shakeScale = 1
  private punchAmount = 0
  private punchTime = 0
  private punchDuration = 1

  constructor() {
    this.camera.position.set(0, 12, 16)
    this.camera.lookAt(0, 1, 0)
  }

  setAspect(aspect: number) {
    // 0 for a wide desktop window, 1 for a tall phone held upright.
    const portrait = clamp01(inverseLerp(1.05, 0.52, aspect))
    // Frame Lammy above guidance and thumb controls on short phone viewports.
    this.horizonTilt = lerp(HORIZON_TILT, -0.06, portrait)
    this.framing = {
      distance: lerp(LANDSCAPE.distance, PORTRAIT.distance, portrait),
      height: lerp(LANDSCAPE.height, PORTRAIT.height, portrait),
      fov: lerp(LANDSCAPE.fov, PORTRAIT.fov, portrait),
      lookAhead: lerp(LANDSCAPE.lookAhead, PORTRAIT.lookAhead, portrait),
    }
    this.camera.aspect = aspect
    this.camera.fov = this.framing.fov
    this.camera.updateProjectionMatrix()
  }

  /**
   * Ease the rig in for a beat. Used when something worth looking at happens —
   * the camera leaning in and settling back reads as the game noticing too.
   */
  punch(amount: number, duration: number) {
    this.punchAmount = amount
    this.punchTime = duration
    this.punchDuration = duration
  }

  /** Scales every subsequent shake. 0 disables them for reduced-motion users. */
  setShakeScale(scale: number) {
    this.shakeScale = scale
  }

  addShake(magnitude: number, duration: number, frequency = 34) {
    if (this.shakeScale <= 0) return
    this.shakes.push({ magnitude: magnitude * this.shakeScale, time: duration, duration, frequency })
    if (this.shakes.length > 6) this.shakes.shift()
  }

  /** Snap straight to the ideal pose — used when a round starts. */
  reset(x: number, y: number, z: number, world: World) {
    this.updateTargets(x, y, z, 0, 0, 1)
    this.camera.position.copy(this.desired)
    this.target.copy(this.lookTarget)
    this.avoidGround(world)
    this.camera.lookAt(this.lookTarget)
    this.camera.rotateX(this.horizonTilt)
    this.shakes.length = 0
  }

  private updateTargets(
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    speed01: number,
  ) {
    // Lead the player so they can see what they're running into.
    const lead = this.framing.lookAhead * speed01
    const speed = Math.hypot(vx, vz) || 1
    this.lookTarget.set(x + (vx / speed) * lead, y + 1.15, z + (vz / speed) * lead)

    // The rig eases back a touch at speed, which reads as exhilaration, and
    // leans in for a beat after something worth noticing.
    const punch =
      this.punchTime > 0 ? this.punchAmount * Math.sin((this.punchTime / this.punchDuration) * Math.PI) : 0
    this.boom = 1 + speed01 * 0.13 - punch
    this.offset.set(0, this.framing.height * this.boom, this.framing.distance * this.boom)
    this.desired.copy(this.lookTarget).add(this.offset)
  }

  private avoidGround(world: World) {
    const floor = world.heightAt(this.camera.position.x, this.camera.position.z) + 2.5
    if (this.camera.position.y < floor) this.camera.position.y = floor
  }

  update(
    world: World,
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    speed01: number,
    dt: number,
  ) {
    this.updateTargets(x, y, z, vx, vz, speed01)

    // Slower vertical damping than horizontal keeps hills from bobbing the frame.
    this.camera.position.x = damp(this.camera.position.x, this.desired.x, 5.5, dt)
    this.camera.position.y = damp(this.camera.position.y, this.desired.y, 3.2, dt)
    this.camera.position.z = damp(this.camera.position.z, this.desired.z, 5.5, dt)
    this.avoidGround(world)

    this.target.x = damp(this.target.x, this.lookTarget.x, 7, dt)
    this.target.y = damp(this.target.y, this.lookTarget.y, 5, dt)
    this.target.z = damp(this.target.z, this.lookTarget.z, 7, dt)
    this.camera.lookAt(this.target)
    this.camera.rotateX(this.horizonTilt)

    if (this.punchTime > 0) this.punchTime = Math.max(0, this.punchTime - dt)
    this.applyShake(dt)
  }

  private applyShake(dt: number) {
    if (this.shakes.length === 0) return

    this.shakeOffset.set(0, 0, 0)
    for (let index = this.shakes.length - 1; index >= 0; index -= 1) {
      const shake = this.shakes[index]
      shake.time -= dt
      if (shake.time <= 0) {
        this.shakes.splice(index, 1)
        continue
      }
      // Decaying sinusoids at incommensurate rates — smoother than random jitter,
      // and it settles rather than stopping dead.
      const falloff = clamp01(shake.time / shake.duration) ** 2
      const amplitude = shake.magnitude * falloff
      const phase = (shake.duration - shake.time) * shake.frequency
      this.shakeOffset.x += Math.sin(phase) * amplitude
      this.shakeOffset.y += Math.sin(phase * 1.37 + 1.1) * amplitude * 0.7
      this.shakeOffset.z += Math.sin(phase * 0.83 + 2.3) * amplitude * 0.4
    }

    this.camera.position.add(this.shakeOffset)
    this.camera.updateMatrixWorld()
  }

  /** Cinematic orbit used on the menu and between rounds. */
  orbit(world: World, centre: Vector3, time: number, radius = 20, height = 11) {
    const angle = time * 0.075
    const x = centre.x + Math.cos(angle) * radius
    const z = centre.z + Math.sin(angle) * radius
    this.camera.position.set(x, centre.y + height, z)
    this.avoidGround(world)
    this.camera.lookAt(centre.x, centre.y + 1.6, centre.z)
  }


}
