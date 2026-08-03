import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three'
import { clamp01, damp, lerp } from '../core/math'
import type { Critter, CritterKind, Player } from '../game/types'
import type { DecorationId } from '../lib/storage'
import { createWorld, generateGroveLayout, STAND_POSITION, type World } from '../game/world'
import { BloomMap } from './bloomMap'
import { CritterHerd } from './critters'
import { ParticleField } from './fx'
import { buildTreeGeometry, createBushes, createFlowers, createFoliageMaterial } from './flora'
import { createGrass } from './grass'
import { Horizon } from './horizon'
import { Lamb } from './lamb'
import { PALETTE } from './palette'
import { PostPipeline } from './postfx'
import { createDecorations, createStand, setDecorations } from './props'
import { detectQualityTier, settingsFor, type QualitySettings, type QualityTier } from './quality'
import { Sky } from './sky'
import { TERRAIN_TIERS, createTerrain } from './terrain'
import { makeDetailTexture } from './textures'
import { createValleyUniforms } from './valleyShading'

/**
 * The lemonade stand, close up.
 *
 * "My Stand" used to be a flat 2D scene living in its own world. It's the same
 * meadow now — literally the same seeded valley the arcade builds — just framed
 * tight on the counter with Lammy behind it and one customer at a time walking
 * up. The coin-counting logic in `tycoonEngine.ts` is untouched; only the
 * presentation moved.
 *
 * It composes the same builders the arcade renderer uses rather than sharing a
 * renderer with it, because the two want genuinely different things: this one has
 * a fixed camera, no gameplay bloom, and a customer puppeted by a state machine.
 */

const SUN_DIRECTION = new Vector3(0.52, 0.62, 0.58).normalize()

export type StandPhase =
  | 'arriving'
  | 'ordering'
  | 'serving'
  | 'paying'
  | 'change'
  | 'happy'
  | 'daySummary'
  | 'shop'

export interface StandView {
  phase: StandPhase
  /** 0-1 progress of the customer's walk-in. */
  walkT: number
  /** Cycles per customer so consecutive visitors aren't all the same animal. */
  customerIndex: number
  hue: number
}

const KINDS: CritterKind[] = ['lamb', 'bunny', 'piglet']

/** Where the customer waits, in front of the counter. */
const COUNTER_OFFSET = 1.9
/**
 * Customers walk in from the side rather than straight down the camera's axis —
 * an approach along the view direction starts behind the lens and arrives as a
 * growing blob. Coming in from frame-left they cross the shot and turn to the
 * counter, which reads as someone arriving.
 */
const APPROACH_SIDE_DISTANCE = 7.5

export class StandScene {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(38, 1, 0.3, 700)

  private readonly settings: QualitySettings
  private readonly uniforms = createValleyUniforms()
  private readonly bloomMap = new BloomMap(256)
  private readonly detail: Texture
  private readonly world: World
  private readonly sky = new Sky()
  private readonly horizon: Horizon
  private readonly lamb: Lamb
  private readonly herd: CritterHerd
  private readonly particles: ParticleField
  private post: PostPipeline | null = null

  /** The lamb behind the counter, posed by hand rather than by the simulation. */
  private readonly keeper: Player
  private readonly customer: Critter
  private readonly customerAnchor = new Vector3()
  private readonly approachDirection = new Vector3()
  private readonly sideDirection = new Vector3()
  private readonly walkStart = new Vector3()

  private readonly focusPoint = new Vector3()
  private width = 1
  private height = 1
  private time = 0
  private disposed = false

  private readonly decorations: Group

  constructor(canvas: HTMLCanvasElement, seed = 20260802, tier?: QualityTier) {
    this.settings = settingsFor(tier ?? detectQualityTier())

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.settings.tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.14
    this.renderer.shadowMap.enabled = this.settings.shadows
    this.renderer.shadowMap.type = PCFSoftShadowMap

    this.world = createWorld(seed)
    const layout = generateGroveLayout(this.world, 12)

    this.detail = makeDetailTexture(256, seed, 0.26)
    this.detail.anisotropy = Math.min(
      this.settings.anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    )

    this.uniforms.uBloomMap.value = this.bloomMap.target.texture
    // The stand is always a bright, happy place — no drained state here.
    this.uniforms.uBloomFloor.value = 1
    this.uniforms.uRimStrength.value = 0.24

    // --- light ---------------------------------------------------------------
    this.scene.fog = new Fog(PALETTE.fog.clone().getHex(), 40, 130)

    const sun = new DirectionalLight(PALETTE.sunLight.clone().getHex(), 2.45)
    sun.position.copy(SUN_DIRECTION).multiplyScalar(30)
    sun.castShadow = this.settings.shadows
    sun.shadow.mapSize.setScalar(this.settings.shadowMapSize)
    sun.shadow.camera.left = -9
    sun.shadow.camera.right = 9
    sun.shadow.camera.top = 9
    sun.shadow.camera.bottom = -9
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 70
    sun.shadow.bias = -0.0012
    sun.shadow.normalBias = 0.05
    sun.target.position.set(STAND_POSITION.x, 0, STAND_POSITION.z)
    sun.position.add(sun.target.position)
    this.scene.add(sun, sun.target)

    this.scene.add(
      new HemisphereLight(
        PALETTE.skyHorizon.clone().getHex(),
        PALETTE.bounceLight.clone().getHex(),
        0.95,
      ),
    )
    this.scene.add(new AmbientLight(0xffffff, 0.2))

    this.sky.setSunDirection(SUN_DIRECTION)
    this.scene.add(this.sky.mesh)
    this.horizon = new Horizon(seed)
    this.scene.add(this.horizon.group)

    // --- world ---------------------------------------------------------------
    // The camera never moves and only sees a few metres of meadow, so this scene
    // is deliberately much cheaper than the arcade's: a coarser terrain, grass
    // only where it's visible, and a handful of trees for depth.
    const world = new Group()
    world.add(createTerrain(this.world, TERRAIN_TIERS.low, this.uniforms, this.detail))
    world.add(
      createGrass(
        this.world,
        { tufts: Math.round(this.settings.grassTufts * 0.3), radius: 17 },
        this.uniforms,
      ),
    )
    world.add(createBushes(this.world, layout.bushes.slice(0, 18), this.uniforms, this.detail))
    world.add(createFlowers(this.world, layout.flowers.slice(0, 70), this.uniforms))

    const treeSet = buildTreeGeometry(seed, 0)
    for (const spot of layout.trees.slice(0, 5)) {
      const foliage = createFoliageMaterial(this.uniforms, this.detail, { value: 1 })
      const tree = new Mesh(treeSet.full, foliage)
      tree.castShadow = true
      tree.receiveShadow = true
      tree.position.set(spot.x, spot.y, spot.z)
      tree.rotation.y = spot.rotation
      tree.scale.setScalar(spot.scale)
      world.add(tree)
    }

    const stand = createStand(this.uniforms, this.detail)
    const standY = this.world.heightAt(STAND_POSITION.x, STAND_POSITION.z)
    stand.position.set(STAND_POSITION.x, standY, STAND_POSITION.z)
    // Turn the counter to face the middle of the meadow, where customers come from.
    const standRotation = Math.atan2(-STAND_POSITION.x, -STAND_POSITION.z)
    stand.rotation.y = standRotation
    // Shop purchases hang off the stand in its own local space.
    this.decorations = createDecorations(this.uniforms, this.detail)
    stand.add(this.decorations)
    world.add(stand)
    this.scene.add(world)

    // Which way "in front of the counter" points, in world space, and the axis
    // customers walk in along.
    this.approachDirection.set(Math.sin(standRotation), 0, Math.cos(standRotation)).normalize()
    this.sideDirection.set(-this.approachDirection.z, 0, this.approachDirection.x)
    this.customerAnchor
      .set(STAND_POSITION.x, standY, STAND_POSITION.z)
      .addScaledVector(this.approachDirection, COUNTER_OFFSET)
    // Enter from the same side the camera is on, so they cross the frame rather
    // than materialising in the distance.
    this.walkStart
      .copy(this.customerAnchor)
      .addScaledVector(this.sideDirection, APPROACH_SIDE_DISTANCE)

    // --- cast ----------------------------------------------------------------
    this.lamb = new Lamb(this.uniforms, this.detail)
    this.lamb.group.scale.setScalar(1.15)
    // She's serving, not smashing — the mallet stays behind the counter.
    this.lamb.malletMesh.visible = false
    this.scene.add(this.lamb.group)

    this.keeper = {
      // Beside the counter rather than behind it: she's shorter than the
      // worktop, so standing behind it would hide her completely.
      x: STAND_POSITION.x - this.sideDirection.x * 1.75 + this.approachDirection.x * 0.55,
      y: standY,
      z: STAND_POSITION.z - this.sideDirection.z * 1.75 + this.approachDirection.z * 0.55,
      vx: 0,
      vz: 0,
      facing: standRotation + Math.PI * 0.15,
      speed: 0,
      swingTimer: 0,
      swingCooldown: 0,
      gait: 0,
      footstepPhase: 0,
    }
    this.lamb.group.position.set(this.keeper.x, this.keeper.y, this.keeper.z)

    this.customer = {
      id: 1,
      kind: 'bunny',
      x: this.customerAnchor.x,
      y: standY,
      z: this.customerAnchor.z,
      homeX: 0,
      homeZ: 0,
      facing: standRotation + Math.PI,
      state: 'follower',
      speed: 0,
      wanderTimer: 0,
      targetX: 0,
      targetZ: 0,
      bloomTimer: 0,
      followIndex: 0,
      gait: 0,
      trailTimer: 0,
      hue: 0.5,
    }
    this.herd = new CritterHerd([this.customer], this.uniforms, this.detail)
    this.scene.add(this.herd.group)

    this.particles = new ParticleField(Math.min(220, this.settings.maxParticles))
    this.scene.add(this.particles.solidMesh, this.particles.glowMesh)

    // Everything here is already in colour.
    this.bloomMap.flood(this.renderer)
    this.frameCamera(standY)
  }

  private frameCamera(standY: number) {
    // A three-quarter view onto the counter with room to the left for the
    // customer to walk into. Low enough to see over the worktop, high enough to
    // read the cups on it.
    // Frame on the spot the customer stands in, so the counter sits behind them
    // and there's clear ground either side for the walk-in.
    const focus = new Vector3(this.customerAnchor.x, standY + 0.85, this.customerAnchor.z)
    this.camera.position
      .copy(focus)
      .addScaledVector(this.approachDirection, 6.2)
      .addScaledVector(this.sideDirection, 2.8)
    this.camera.position.y = standY + 2.3
    this.camera.lookAt(focus)
    this.focusPoint.copy(focus)
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio)

    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    // Pull back on tall phone screens so the counter still fits.
    this.camera.fov = lerp(38, 52, clamp01(1 - this.camera.aspect))
    this.camera.updateProjectionMatrix()

    if (this.settings.postProcessing) {
      if (!this.post) {
        this.post = new PostPipeline(
          this.renderer,
          this.scene,
          this.camera,
          this.settings,
          this.width,
          this.height,
        )
        this.post.setHeal(1)
      }
      this.post.setSize(this.width, this.height, pixelRatio)
    }
  }

  /** Show whichever trinkets have been bought in the shop. */
  setDecorations(owned: DecorationId[]) {
    setDecorations(this.decorations, owned)
  }

  /** Celebration burst when a customer is happy. */
  cheer() {
    this.particles.burst(this.customer.x, this.customer.y + 1, this.customer.z, {
      count: 34,
      color: PALETTE.flowerPink,
      speed: [0.8, 2.6],
      lift: [2.5, 5],
      size: [0.05, 0.13],
      glow: true,
      gravity: 6,
      life: [0.7, 1.4],
    })
    this.post?.addFlash(0.08)
  }

  frame(view: StandView, dt: number) {
    if (this.disposed) return
    this.time += dt

    this.uniforms.uTime.value = this.time
    this.uniforms.uWindStrength.value = 0.7 + Math.sin(this.time * 0.27) * 0.3
    this.uniforms.uPlayerPos.value.set(this.customer.x, this.customer.y, this.customer.z)

    const away = view.phase === 'daySummary' || view.phase === 'shop'
    this.customer.kind = KINDS[view.customerIndex % KINDS.length]
    this.customer.hue = view.hue

    // Walk in from the side, wait at the counter, then head off the other way.
    const arriving = view.phase === 'arriving'
    const walking = arriving || away
    const progress = away ? 0 : arriving ? 1 - Math.pow(1 - clamp01(view.walkT), 3) : 1

    const targetX = lerp(this.walkStart.x, this.customerAnchor.x, progress)
    const targetZ = lerp(this.walkStart.z, this.customerAnchor.z, progress)
    const moved = Math.hypot(targetX - this.customer.x, targetZ - this.customer.z)
    this.customer.x = damp(this.customer.x, targetX, 4.5, dt)
    this.customer.z = damp(this.customer.z, targetZ, 4.5, dt)
    this.customer.y = this.world.heightAt(this.customer.x, this.customer.z)
    this.customer.speed = damp(this.customer.speed, moved > 0.08 ? 2.4 : 0, 6, dt)
    this.customer.gait += this.customer.speed * dt

    // Face where they're going while walking, and the counter once they arrive.
    const facingTarget = walking
      ? Math.atan2(-this.sideDirection.x, -this.sideDirection.z)
      : Math.atan2(-this.approachDirection.x, -this.approachDirection.z)
    this.customer.facing = damp(this.customer.facing, facingTarget, 6, dt)

    // Happy customers bounce; the rest just breathe.
    this.customer.state = 'follower'
    this.herd.update([this.customer], dt, view.phase === 'happy' ? this.time * 2.4 : this.time)

    // Lammy leans over the counter while serving, and bobs the rest of the time.
    const busy = view.phase === 'serving' || view.phase === 'change'
    this.keeper.speed = damp(this.keeper.speed, busy ? 1.6 : 0, 5, dt)
    this.keeper.gait += this.keeper.speed * dt
    // Turn to whoever she's serving.
    this.keeper.facing = damp(
      this.keeper.facing,
      Math.atan2(this.customer.x - this.keeper.x, this.customer.z - this.keeper.z),
      3.5,
      dt,
    )
    this.lamb.update(this.keeper, dt, this.time)
    this.lamb.group.position.set(this.keeper.x, this.keeper.y, this.keeper.z)
    this.lamb.group.rotation.y = this.keeper.facing

    this.particles.update(dt, (x, z) => this.world.heightAt(x, z))
    this.sky.update(this.time, 1, this.camera.position)
    this.horizon.update(1, PALETTE.fog, this.camera.position.x, this.camera.position.z)

    this.bloomMap.render(this.renderer)
    if (this.post && this.settings.postProcessing) {
      this.post.update(dt)
      this.post.render(dt)
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  dispose() {
    this.disposed = true
    this.post?.dispose()
    this.bloomMap.dispose()
    this.particles.dispose()
    this.herd.dispose()
    this.lamb.dispose()
    this.sky.dispose()
    this.horizon.dispose()
    this.scene.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose()
    })
    this.detail.dispose()
    this.renderer.dispose()
  }
}
