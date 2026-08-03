import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Texture,
} from 'three'
import { clamp01, damp, easeOutBack, smoothstep } from '../core/math'
import {
  MAX_GROUND_LEAVES,
  MAX_GROUND_LEMONS,
  PLAYER_SPEED,
  SWING_TIME,
  TREE_REGROW_TIME,
  TREE_WOBBLE_TIME,
} from '../game/constants'
import type { GameEvent, GameState } from '../game/types'
import type { DecorationId } from '../lib/storage'
import { BLOOM_AREA, BLOOM_ORIGIN } from '../game/bloom'
import { objectiveFraction } from '../game/objectives'
import { BloomMap } from './bloomMap'
import { FollowCamera } from './camera'
import { createDaylightState, evaluateDaylight } from './daylight'
import { CritterHerd } from './critters'
import { Floaters } from './floaters'
import { ParticleField, ZestRings } from './fx'
import {
  buildTreeGeometry,
  createBushes,
  createFlowers,
  createFoliageMaterials,
  createReeds,
  createRocks,
  type TreeGeometrySet,
} from './flora'
import { createGrass } from './grass'
import { Horizon } from './horizon'
import { Lamb } from './lamb'
import { Motes } from './motes'
import { PALETTE, SOUR_TINT } from './palette'
import { PostPipeline } from './postfx'
import { ItemField, createBlobShadow, createDecorations, createStand, setDecorations } from './props'
import {
  detectQualityTier,
  isSoftwareRenderer,
  prefersReducedMotion,
  settingsFor,
  stepTier,
  type QualitySettings,
  type QualityTier,
} from './quality'
import { TERRAIN_TIERS, createTerrain } from './terrain'
import { makeDetailTexture, makeRadialAlphaTexture } from './textures'
import { Sky } from './sky'
import { SwingTrail } from './trail'
import { createValleyUniforms } from './valleyShading'
import { Water } from './water'

/**
 * The renderer owns everything visual: the scene graph, the shared shading uniforms,
 * the post stack, and the translation from gameplay events into juice.
 *
 * The simulation never knows this file exists. It hands over a `GameState` and a
 * list of events each frame; everything here is presentation.
 */

// Where the sun starts. It moves: see `daylight.ts`.
const SUN_DIRECTION = new Vector3(0.52, 0.62, 0.58).normalize()

interface TreeVisual {
  group: Group
  full: Mesh
  stump: Mesh
  baseScale: number
  /** 1 = solid, 0 = fully dissolved. Driven by camera occlusion. */
  fade: { value: number }
  solid: MeshStandardMaterial
  dissolving: MeshStandardMaterial
  /** Which material the meshes currently carry, so we only swap on a change. */
  usingDissolve: boolean
}

/** Radius around the camera→player line inside which a tree dissolves. */
const OCCLUSION_RADIUS = 2.4

export interface ValleyRendererOptions {
  tier?: QualityTier
  /** Stand decorations bought in the tycoon shop. */
  decorations?: DecorationId[]
  /** Container for the DOM-rendered score popups. Omit to disable them. */
  floaterLayer?: HTMLElement | null
  /** Skip the adaptive downgrade watchdog (used by tests for determinism). */
  adaptive?: boolean
  /**
   * Pin the valley's recovery to a fixed 0–1 value instead of deriving it from
   * play. Set from `?heal=` so lighting and colour can be inspected at both ends
   * of the range without playing a whole round.
   */
  healOverride?: number
  /**
   * Pin how far through the round the light is, ignoring the clock. Set from
   * `?dusk=` so the sunset can be inspected without waiting two minutes for it.
   */
  duskOverride?: number
  /**
   * Start with the whole valley already in colour. The menu backdrop shows the
   * valley as it *could* be; the round itself always starts drained.
   */
  bloomFlooded?: boolean
}

export class ValleyRenderer {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly followCamera = new FollowCamera()

  private settings: QualitySettings
  private readonly uniforms = createValleyUniforms()
  private readonly bloomMap = new BloomMap(512)
  private readonly detailTexture: Texture
  private readonly alphaTexture: Texture

  private readonly worldGroup = new Group()
  private readonly treeVisuals: TreeVisual[] = []
  private readonly treeGeometries: TreeGeometrySet[] = []
  private readonly particles: ParticleField
  private readonly zestRings = new ZestRings(14)
  private readonly swingTrail = new SwingTrail()
  private readonly floaters: Floaters | null
  private readonly motes: Motes
  private readonly lamb: Lamb
  private critterHerd: CritterHerd | null = null
  private lambShadow: Mesh
  private water: Water | null = null
  private post: PostPipeline | null = null

  private readonly sun: DirectionalLight
  private readonly hemisphere: HemisphereLight
  private readonly fog: Fog
  private lemonField: ItemField
  private leafField: ItemField

  private width = 1
  private height = 1
  private time = 0
  private heal = 0
  private frameAverage = 16
  private adaptiveTimer = 0
  private readonly adaptive: boolean
  private readonly healOverride: number | null
  private readonly duskOverride: number | null
  private readonly bloomFlooded: boolean
  private calmMotion = false
  private readonly daylight = createDaylightState()
  /** 0 → 1 across the round. Held at 0 outside play so menus stay at noon. */
  private dusk = 0
  private decorations: Group | null = null
  private readonly ownedDecorations: DecorationId[]
  private disposed = false

  private readonly tmp = new Vector3()
  private readonly tmpColor = new Color()
  private readonly sky = new Sky()
  private readonly horizon: Horizon

  constructor(canvas: HTMLCanvasElement, state: GameState, options: ValleyRendererOptions = {}) {
    this.adaptive = options.adaptive ?? true
    this.floaters = options.floaterLayer ? new Floaters(options.floaterLayer) : null
    this.healOverride = options.healOverride ?? null
    this.duskOverride = options.duskOverride ?? null
    this.bloomFlooded = options.bloomFlooded ?? false
    this.ownedDecorations = options.decorations ?? []
    this.settings = settingsFor(options.tier ?? detectQualityTier())

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.settings.tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    })
    // The device heuristic can't see the renderer, so correct it once we can:
    // a CPU rasteriser has none of the fill rate the "high" tier assumes.
    if (options.tier === undefined && isSoftwareRenderer(this.renderer.getContext())) {
      this.settings = settingsFor('low')
    }

    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = this.settings.shadows
    this.renderer.shadowMap.type = PCFSoftShadowMap

    this.detailTexture = makeDetailTexture(256, state.world.seed, 0.26)
    this.detailTexture.anisotropy = Math.min(
      this.settings.anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    )
    this.alphaTexture = makeRadialAlphaTexture(96, 2.4)

    this.uniforms.uBloomMap.value = this.bloomMap.target.texture
    this.uniforms.uBloomOrigin.value.set(BLOOM_ORIGIN, BLOOM_ORIGIN)
    this.uniforms.uBloomInvSize.value = 1 / BLOOM_AREA
    // Never let the world go fully monochrome — a hint of colour survives.
    this.uniforms.uBloomFloor.value = 0.34

    // --- lighting -------------------------------------------------------------
    // Light is the other half of the bloom system. The splat map recolours
    // *surfaces*; these lights recolour the *air*. A sour valley sits under a
    // cold, flat, low key with the haze pulled in close; as the player heals it,
    // the sun climbs, warms and pushes the fog back to the hills.
    this.scene.background = null
    this.fog = new Fog(PALETTE.sourFog.clone().getHex(), 26, 80)
    this.scene.fog = this.fog

    this.sun = new DirectionalLight(PALETTE.sourSun.clone().getHex(), 1.6)
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(40)
    this.sun.castShadow = this.settings.shadows
    this.configureShadow()
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.hemisphere = new HemisphereLight(
      PALETTE.sourSky.clone().getHex(),
      PALETTE.sourBounce.clone().getHex(),
      0.85,
    )
    this.scene.add(this.hemisphere)
    this.scene.add(new AmbientLight(0xffffff, 0.18))

    // --- sky ------------------------------------------------------------------
    this.sky.setSunDirection(SUN_DIRECTION)
    this.scene.add(this.sky.mesh)
    this.horizon = new Horizon(state.world.seed)
    this.scene.add(this.horizon.group)

    // --- world ----------------------------------------------------------------
    this.scene.add(this.worldGroup)
    this.particles = new ParticleField(this.settings.maxParticles)
    this.motes = new Motes({ count: this.settings.motes, radius: 22 }, this.alphaTexture)
    this.lamb = new Lamb(this.uniforms, this.detailTexture)
    this.lamb.group.scale.setScalar(1.22)
    this.lambShadow = createBlobShadow(this.alphaTexture, 1.5)
    this.lemonField = new ItemField({ capacity: MAX_GROUND_LEMONS + 40, kind: 'lemon' }, this.uniforms)
    this.leafField = new ItemField({ capacity: MAX_GROUND_LEAVES + 30, kind: 'leaf' }, this.uniforms)

    this.buildWorld(state)

    this.scene.add(this.particles.solidMesh)
    this.scene.add(this.particles.glowMesh)
    this.scene.add(this.zestRings.group)
    this.scene.add(this.swingTrail.mesh)
    this.scene.add(this.motes.mesh)

    // Respect the OS motion preference: no camera shake, gentler screen flashes.
    this.calmMotion = prefersReducedMotion()
    this.followCamera.setShakeScale(this.calmMotion ? 0 : 1)

    this.followCamera.reset(state.player.x, state.player.y, state.player.z, state.world)
    this.seedInitialBloom(state)
    this.warmUpShaders()
  }

  /**
   * Compile every program before the first frame.
   *
   * Otherwise the first tree to dissolve, the first particle burst and the first
   * zest ring each trigger a shader compile mid-play, which on a big scene is a
   * visible hitch at exactly the moment the player did something. The dissolving
   * foliage material isn't attached to anything yet, so it gets swapped in for a
   * single tree just long enough to be compiled.
   */
  private warmUpShaders() {
    const sample = this.treeVisuals[0]
    if (sample) {
      sample.full.material = sample.dissolving
      sample.stump.material = sample.dissolving
    }

    // These pool meshes sit at count 0 and would otherwise compile on first use.
    const particleCounts = [this.particles.solidMesh.count, this.particles.glowMesh.count]
    this.particles.solidMesh.count = 1
    this.particles.glowMesh.count = 1

    try {
      this.renderer.compile(this.scene, this.followCamera.camera)
    } catch (error) {
      // Warming up is an optimisation, never a requirement.
      console.warn('Shader warm-up skipped', error)
    }

    this.particles.solidMesh.count = particleCounts[0]
    this.particles.glowMesh.count = particleCounts[1]
    if (sample) {
      sample.full.material = sample.solid
      sample.stump.material = sample.solid
    }
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private configureShadow() {
    const shadow = this.sun.shadow
    shadow.mapSize.setScalar(this.settings.shadowMapSize)
    // A tight box that follows the action keeps texels dense where they matter.
    shadow.camera.left = -18
    shadow.camera.right = 18
    shadow.camera.top = 18
    shadow.camera.bottom = -18
    shadow.camera.near = 1
    shadow.camera.far = 110
    shadow.bias = -0.0012
    shadow.normalBias = 0.05
    shadow.camera.updateProjectionMatrix()
  }

  private buildWorld(state: GameState) {
    const { world, layout } = state

    const terrain = createTerrain(
      world,
      TERRAIN_TIERS[this.settings.tier],
      this.uniforms,
      this.detailTexture,
    )
    this.worldGroup.add(terrain)

    if (this.settings.grassTufts > 0) {
      this.worldGroup.add(
        createGrass(
          world,
          { tufts: this.settings.grassTufts, radius: this.settings.grassRadius },
          this.uniforms,
        ),
      )
    }

    // Chapters on dry ground never build a water plane at all.
    if (world.pond) {
      this.water = new Water(world, world.pond)
      this.water.setSunDirection(SUN_DIRECTION)
      this.worldGroup.add(this.water.mesh)
    }

    this.worldGroup.add(createRocks(world, layout.rocks, this.uniforms))
    this.worldGroup.add(createBushes(world, layout.bushes, this.uniforms, this.detailTexture))
    this.worldGroup.add(createFlowers(world, layout.flowers, this.uniforms))
    this.worldGroup.add(createReeds(world, layout.reeds, this.uniforms))

    // Trees: one merged geometry per variant, one mesh pair per planted tree.
    for (let variant = 0; variant < 3; variant += 1) {
      this.treeGeometries.push(buildTreeGeometry(world.seed, variant))
    }

    for (const tree of state.trees) {
      const set = this.treeGeometries[tree.variant % this.treeGeometries.length]
      const fade = { value: 1 }
      const { solid, dissolving } = createFoliageMaterials(this.uniforms, this.detailTexture, fade)

      const group = new Group()
      group.position.set(tree.x, tree.y, tree.z)
      group.rotation.y = tree.rotation

      const full = new Mesh(set.full, solid)
      full.castShadow = true
      full.receiveShadow = true
      const stump = new Mesh(set.stump, solid)
      stump.castShadow = true
      stump.receiveShadow = true
      stump.visible = false

      group.add(full, stump)
      this.worldGroup.add(group)

      this.treeVisuals.push({
        group,
        full,
        stump,
        baseScale: tree.scale,
        fade,
        solid,
        dissolving,
        usingDissolve: false,
      })
    }

    const stand = createStand(this.uniforms, this.detailTexture)
    stand.position.set(state.stand.x, state.stand.y, state.stand.z)
    stand.rotation.y = state.stand.rotation
    this.decorations = createDecorations(this.uniforms, this.detailTexture)
    setDecorations(this.decorations, this.ownedDecorations)
    stand.add(this.decorations)
    this.worldGroup.add(stand)

    this.worldGroup.add(this.lemonField.mesh)
    this.worldGroup.add(this.leafField.mesh)
    this.worldGroup.add(this.lamb.group)
    this.worldGroup.add(this.lambShadow)

    this.critterHerd = new CritterHerd(state.critters, this.uniforms, this.detailTexture)
    this.worldGroup.add(this.critterHerd.group)
  }

  /**
   * A little colour already lives around the stand and the spawn point, so the
   * opening frame reads as "a valley losing its colour" rather than "a broken build".
   */
  private seedInitialBloom(state: GameState) {
    if (this.bloomFlooded || (this.healOverride !== null && this.healOverride >= 1)) {
      // Debug view: flood the whole valley so the fully-recovered look can be
      // inspected without playing a round.
      this.bloomMap.flood(this.renderer)
      return
    }
    // Mirrors the same two seed splats the simulation stamps in `createGame`.
    this.bloomMap.splat(state.stand.x, state.stand.z, 9, 0.9)
    this.bloomMap.splat(state.player.x, state.player.z, 5, 0.55)
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  setSize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio)

    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(this.width, this.height, false)
    this.followCamera.setAspect(this.width / this.height)

    if (this.settings.postProcessing) {
      if (!this.post) {
        this.post = new PostPipeline(
          this.renderer,
          this.scene,
          this.followCamera.camera,
          this.settings,
          this.width,
          this.height,
        )
      }
      this.post.setSize(this.width, this.height, pixelRatio)
    }
  }

  /** Point the renderer at a freshly created game (new round, new grove). */
  reset(state: GameState) {
    this.bloomMap.reset()
    this.particles.clear()
    this.zestRings.clear()
    this.floaters?.clear()
    this.heal = 0
    this.dusk = 0
    this.time = 0

    for (const visual of this.treeVisuals) {
      visual.full.visible = true
      visual.stump.visible = false
      visual.group.scale.setScalar(visual.baseScale)
      visual.group.rotation.x = 0
      visual.group.rotation.z = 0
    }

    // Respect the OS motion preference: no camera shake, gentler screen flashes.
    this.calmMotion = prefersReducedMotion()
    this.followCamera.setShakeScale(this.calmMotion ? 0 : 1)

    this.followCamera.reset(state.player.x, state.player.y, state.player.z, state.world)
    this.seedInitialBloom(state)
    this.warmUpShaders()
  }

  setQualityTier(tier: QualityTier) {
    if (tier === this.settings.tier) return
    this.settings = settingsFor(tier)
    this.renderer.shadowMap.enabled = this.settings.shadows
    this.sun.castShadow = this.settings.shadows
    this.configureShadow()
    if (this.post) this.post.setQuality(this.settings)
    this.setSize(this.width, this.height)
  }

  get qualityTier() {
    return this.settings.tier
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  handleEvents(events: GameEvent[], state: GameState) {
    for (const event of events) {
      switch (event.type) {
        case 'zest': {
          this.bloomMap.splat(event.x, event.z, event.radius, event.strength)
          this.zestRings.spawn(
            event.x,
            state.world.heightAt(event.x, event.z),
            event.z,
            event.radius,
            this.tmpColor.copy(PALETTE.lemonLight),
            0.55 + event.radius * 0.03,
          )
          break
        }

        case 'smash': {
          this.floaters?.spawn(event.x, event.y + 0.5, event.z, '+1', 'lemon')
          this.particles.burst(event.x, event.y + 0.25, event.z, {
            count: 16,
            color: PALETTE.lemon,
            speed: [2.2, 6],
            lift: [2.5, 5.5],
            size: [0.05, 0.13],
          })
          this.particles.burst(event.x, event.y + 0.3, event.z, {
            count: 8,
            color: PALETTE.lemonLight,
            speed: [1.4, 4],
            lift: [2, 4.5],
            size: [0.07, 0.15],
            glow: true,
            life: [0.3, 0.55],
          })
          this.followCamera.addShake(0.07, 0.14)
          this.flash(0.045)
          break
        }

        case 'whiff': {
          this.particles.burst(event.x, event.y + 0.1, event.z, {
            count: 6,
            color: PALETTE.grassLight,
            speed: [1, 2.6],
            lift: [0.8, 2],
            size: [0.04, 0.09],
            life: [0.25, 0.5],
          })
          this.followCamera.addShake(0.03, 0.08)
          break
        }

        case 'treeHit': {
          this.floaters?.spawn(event.x, event.y + 3.2, event.z, '+2', 'leaf')
          const canopyY = event.y + 2.9
          this.particles.burst(event.x, canopyY, event.z, {
            count: 14,
            color: PALETTE.leafMid,
            speed: [1.2, 3.4],
            lift: [0.6, 2.4],
            size: [0.07, 0.15],
            gravity: 5,
            drag: 2.4,
            life: [0.7, 1.4],
          })
          this.followCamera.addShake(0.12, 0.18)
          break
        }

        case 'treeBreak': {
          this.floaters?.spawn(event.x, event.y + 3, event.z, 'CRACK!', 'leaf')
          const canopyY = event.y + 2.8
          this.particles.burst(event.x, canopyY, event.z, {
            count: 34,
            color: PALETTE.leafMid,
            speed: [2, 6],
            lift: [1.5, 4.5],
            size: [0.08, 0.18],
            gravity: 6,
            drag: 2,
            life: [0.9, 1.8],
          })
          this.particles.burst(event.x, event.y + 1, event.z, {
            count: 18,
            color: PALETTE.lemon,
            speed: [2.5, 7],
            lift: [3, 7],
            size: [0.08, 0.16],
            glow: true,
          })
          this.followCamera.addShake(0.3, 0.42)
          this.flash(0.11)
          break
        }

        case 'treeRegrow': {
          this.particles.burst(event.x, event.y + 0.6, event.z, {
            count: 22,
            color: PALETTE.leafLight,
            speed: [0.6, 2],
            lift: [3, 6],
            size: [0.05, 0.12],
            gravity: -2,
            drag: 2.6,
            glow: true,
            life: [0.7, 1.3],
          })
          break
        }

        case 'pickupLemon':
        case 'pickupLeaf': {
          const color = event.type === 'pickupLemon' ? PALETTE.lemonLight : PALETTE.leafLight
          this.particles.burst(event.x, event.y + 0.2, event.z, {
            count: 7,
            color,
            speed: [0.5, 1.8],
            lift: [1.5, 3.2],
            size: [0.04, 0.09],
            glow: true,
            life: [0.25, 0.5],
            gravity: 4,
          })
          break
        }

        case 'cupBrewed': {
          this.floaters?.spawn(event.x, event.y + 2.1, event.z, event.sparkle ? '✨ cup' : '🥤 cup', 'cup')
          // A modest fountain over the stand — brewing is the setup, not the payoff.
          this.particles.burst(event.x, event.y + 1.5, event.z, {
            count: event.sparkle ? 26 : 16,
            color: event.sparkle ? PALETTE.lemonLight : PALETTE.juice,
            speed: [0.7, 2.2],
            lift: [3, 5.5],
            size: [0.05, 0.12],
            glow: true,
            gravity: 9,
            life: [0.5, 1],
          })
          this.flash(0.05)
          break
        }

        case 'critterServed': {
          this.lamb.cheer()
          this.followCamera.punch(0.14, 0.55)
          this.floaters?.spawn(
            event.x,
            event.y + 1.2,
            event.z,
            event.sparkle ? '+10 💛' : '+5 💛',
            'friend',
          )
          // The payoff. Colour erupts out of the creature and washes outward.
          this.particles.burst(event.x, event.y + 0.7, event.z, {
            count: event.sparkle ? 64 : 42,
            color: event.sparkle ? PALETTE.lemonLight : PALETTE.juice,
            speed: [1.5, 5],
            lift: [3, 7.5],
            size: [0.06, 0.16],
            glow: true,
            gravity: 7,
            life: [0.8, 1.6],
          })
          this.particles.burst(event.x, event.y + 0.5, event.z, {
            count: 26,
            color: PALETTE.flowerPink,
            speed: [1.2, 4],
            lift: [2, 5],
            size: [0.05, 0.13],
            gravity: 6,
            life: [0.9, 1.7],
          })
          this.flash(event.sparkle ? 0.28 : 0.18)
          this.followCamera.addShake(0.16, 0.3)
          break
        }

        case 'flockJoin': {
          this.particles.burst(event.x, event.y + 0.9, event.z, {
            count: 18,
            color: PALETTE.lemonLight,
            speed: [0.6, 2],
            lift: [3, 6],
            size: [0.05, 0.11],
            glow: true,
            gravity: 4,
            life: [0.6, 1.1],
          })
          break
        }

        case 'valleyWoke': {
          this.lamb.cheer(1.6)
          this.followCamera.punch(0.24, 1.1)
          this.floaters?.spawn(event.x, event.y + 2.6, event.z, 'THE VALLEY WOKE UP!', 'triumph')
          // Everything at once: the whole meadow floods with colour.
          this.bloomMap.flood(this.renderer)
          this.particles.burst(event.x, event.y + 1.2, event.z, {
            count: Math.min(140, this.settings.maxParticles),
            color: PALETTE.lemonLight,
            speed: [2, 8],
            lift: [4, 11],
            size: [0.07, 0.2],
            glow: true,
            gravity: 5,
            life: [1.2, 2.4],
          })
          this.flash(0.55)
          this.followCamera.addShake(0.35, 0.6)
          break
        }

        case 'combo': {
          this.floaters?.spawn(
            state.player.x,
            state.player.y + 2,
            state.player.z,
            `x${event.level}!`,
            'combo',
          )
          this.particles.burst(state.player.x, state.player.y + 1.4, state.player.z, {
            count: Math.min(24, 6 + event.level * 2),
            color: PALETTE.standCloth,
            speed: [1.2, 3.4],
            lift: [2.5, 5],
            size: [0.05, 0.11],
            glow: true,
            gravity: 6,
          })
          break
        }

        case 'footstep': {
          this.particles.burst(event.x, event.y + 0.05, event.z, {
            count: 3,
            color: PALETTE.grassLight,
            speed: [0.4, 1.2],
            lift: [0.4, 1.1],
            size: [0.03, 0.07],
            life: [0.2, 0.4],
            gravity: 8,
          })
          break
        }

        case 'countdown':
        case 'timeUp':
          break
      }
    }
  }

  /**
   * @param cinematic Drive a slow orbit instead of the chase camera. Used for
   *        the menu backdrop, where nobody is holding the stick.
   */
  frame(state: GameState, dt: number, cinematic = false) {
    if (this.disposed) return
    this.time += dt

    // --- shared uniforms ------------------------------------------------------
    // Front-load the curve so the first few smashes visibly change the weather —
    // the feedback has to arrive early or the mechanic reads as decoration.
    // Pinned values snap: the debug links exist to look at a specific state, not
    // to watch it ease toward one.
    const healTarget = this.healOverride ?? Math.pow(clamp01(state.bloomCoverage), 0.55)
    this.heal = this.healOverride ?? damp(this.heal, healTarget, 1.6, dt)

    // The HUD calls the timer "Sunset", so the light had better agree with it.
    // Once the valley wakes the sun climbs back up instead of going down.
    //
    // A chapter has no clock to agree with, so the sun is moved by the work
    // instead: the light goes gold as the objectives fill in. Every chapter
    // therefore arrives at golden hour exactly as you finish it, because
    // finishing is what makes the sun go down.
    const total = Math.max(1, state.roundMinutes * 60)
    const progress =
      state.mode === 'story'
        ? objectiveFraction(state)
        : clamp01(1 - state.timeLeft / total)
    const elapsed = state.phase === 'ready' ? 0 : progress
    const duskTarget = state.outcome === 'valleyWoke' ? 0 : elapsed
    this.dusk =
      this.duskOverride ??
      damp(this.dusk, duskTarget, state.outcome === 'valleyWoke' ? 0.9 : 6, dt)
    this.applyDaylight()
    this.uniforms.uTime.value = this.time
    this.uniforms.uPlayerPos.value.set(state.player.x, state.player.y, state.player.z)
    // The breeze swells and drops on a slow cycle of its own.
    this.uniforms.uWindStrength.value = 0.75 + Math.sin(this.time * 0.23) * 0.35

    // --- characters and props -------------------------------------------------
    this.lamb.update(state.player, dt, this.time, state.inventory.cups)
    this.lambShadow.position.set(state.player.x, state.player.y + 0.04, state.player.z)
    const shadowScale = 1 + clamp01(state.player.speed / PLAYER_SPEED) * 0.18
    this.lambShadow.scale.setScalar(shadowScale)

    this.critterHerd?.update(state.critters, dt, this.time)

    // The trail is brightest through the strike and gone by the recovery.
    const swing = state.player.swingTimer
    const swingT = swing > 0 ? 1 - swing / SWING_TIME : 1
    const trailStrength = swing > 0 ? clamp01((swingT - 0.24) / 0.16) * (1 - clamp01((swingT - 0.5) / 0.4)) : 0
    this.lamb.getMalletTip(this.tmp)
    this.swingTrail.update(this.tmp, trailStrength)

    this.lemonField.sync(state.lemons, this.time)
    this.leafField.sync(state.leaves, this.time)
    this.updateTrees(state, dt)

    this.particles.update(dt, (x, z) => state.world.heightAt(x, z))
    this.motes.update(
      this.followCamera.camera,
      dt,
      this.time,
      this.daylight.duskGlow,
      this.uniforms.uWindStrength.value,
    )
    this.zestRings.update(dt)
    this.water?.update(this.time, this.heal)
    this.sky.update(this.time, 0.35 + this.heal * 0.65, this.followCamera.camera.position)
    this.horizon.update(
      this.heal,
      this.dusk,
      this.tmpColor.copy(SOUR_TINT),
      this.followCamera.camera.position.x,
      this.followCamera.camera.position.z,
    )

    // --- camera ---------------------------------------------------------------
    if (cinematic) {
      this.tmp.set(state.player.x, state.player.y, state.player.z)
      this.followCamera.orbit(state.world, this.tmp, this.time, 22, 11)
    } else {
      this.followCamera.update(
        state.world,
        state.player.x,
        state.player.y,
        state.player.z,
        state.player.vx,
        state.player.vz,
        clamp01(state.player.speed / PLAYER_SPEED),
        dt,
      )
    }
    this.followCamera.camera.updateMatrixWorld()

    // The translucency term needs the sun in view space, so it has to be refreshed
    // after the camera has settled for this frame.
    this.uniforms.uSunViewDirection.value
      .copy(this.daylight.direction)
      .transformDirection(this.followCamera.camera.matrixWorldInverse)

    // Keep the shadow frustum centred just ahead of Lammy.
    this.tmp.set(state.player.x, state.player.y, state.player.z)
    this.sun.target.position.copy(this.tmp)
    this.sun.position.copy(this.tmp).addScaledVector(this.daylight.direction, 45)
    this.sun.target.updateMatrixWorld()

    // --- draw ----------------------------------------------------------------
    this.bloomMap.render(this.renderer)

    if (this.post && this.settings.postProcessing) {
      this.post.setHeal(0.4 + this.heal * 0.6)
      this.post.update(dt)
      this.post.render(dt)
    } else {
      this.renderer.render(this.scene, this.followCamera.camera)
    }

    this.floaters?.update(this.followCamera.camera, this.width, this.height, dt)

    if (this.adaptive) this.watchPerformance(dt)
  }

  /**
   * Drive the whole lighting rig off recovery *and* the clock. This is the payoff
   * of the entire design: colour coming back brings the sun out, and the round
   * running down takes it away again.
   */
  private applyDaylight() {
    const light = evaluateDaylight(this.heal, this.dusk, this.daylight)

    this.sun.color.copy(light.sunColor)
    this.sun.intensity = light.sunIntensity

    this.hemisphere.color.copy(light.hemisphereSky)
    this.hemisphere.groundColor.copy(light.hemisphereGround)
    this.hemisphere.intensity = light.hemisphereIntensity

    this.fog.color.copy(light.fogColor)
    this.fog.near = light.fogNear
    this.fog.far = light.fogFar

    this.renderer.toneMappingExposure = light.exposure
    this.uniforms.uRimStrength.value = light.rimStrength

    // The sun actually moves, so everything that reads its direction has to be
    // told: the sky dome's disc and glow, and the water's glint.
    this.sky.setSunDirection(light.direction)
    this.sky.setColors(light.skyZenith, light.skyHorizon, light.skyGlow)
    this.water?.setSunDirection(light.direction)
  }

  /** Screen flash, damped for players who asked for reduced motion. */
  private flash(magnitude: number) {
    this.post?.addFlash(this.calmMotion ? magnitude * 0.3 : magnitude)
  }

  private updateTrees(state: GameState, dt: number) {
    const camera = this.followCamera.camera.position
    // Vector from the camera to Lammy — anything sitting on this line is in the way.
    const lineX = state.player.x - camera.x
    const lineZ = state.player.z - camera.z
    const lineLengthSq = lineX * lineX + lineZ * lineZ || 1

    for (let index = 0; index < state.trees.length; index += 1) {
      const tree = state.trees[index]
      const visual = this.treeVisuals[index]
      if (!visual) continue

      // Dissolve trees that come between the camera and the player. Projecting
      // onto the sight line is enough — we only care about the ones in front.
      const toTreeX = tree.x - camera.x
      const toTreeZ = tree.z - camera.z
      const along = (toTreeX * lineX + toTreeZ * lineZ) / lineLengthSq
      let fadeTarget = 1
      if (along > 0.02 && along < 0.98) {
        const perpX = toTreeX - lineX * along
        const perpZ = toTreeZ - lineZ * along
        const offset = Math.hypot(perpX, perpZ)
        // Fully dissolved directly in front, back to solid by the outer radius.
        fadeTarget = smoothstep(OCCLUSION_RADIUS * 0.45, OCCLUSION_RADIUS, offset) * 0.78 + 0.22
      }
      visual.fade.value = damp(visual.fade.value, fadeTarget, 9, dt)

      // Only carry the dithering material while actually dissolving.
      const needsDissolve = visual.fade.value < 0.995
      if (needsDissolve !== visual.usingDissolve) {
        visual.usingDissolve = needsDissolve
        const material = needsDissolve ? visual.dissolving : visual.solid
        visual.full.material = material
        visual.stump.material = material
      }

      const broken = tree.stage === 'broken'
      visual.full.visible = !broken
      visual.stump.visible = broken

      let scale = visual.baseScale
      if (tree.regrowTimer > 0) {
        // Pop back with a bit of overshoot — trees should feel delighted to return.
        const t = 1 - tree.regrowTimer / TREE_REGROW_TIME
        scale *= Math.max(0.02, easeOutBack(t))
      }
      visual.group.scale.setScalar(scale)

      if (tree.wobbleTimer > 0) {
        const decay = tree.wobbleTimer / TREE_WOBBLE_TIME
        const amount = Math.sin(tree.wobbleTimer * 27) * 0.17 * decay * decay
        visual.group.rotation.x = amount * Math.cos(tree.wobbleAngle)
        visual.group.rotation.z = -amount * Math.sin(tree.wobbleAngle)
      } else if (visual.group.rotation.x !== 0 || visual.group.rotation.z !== 0) {
        visual.group.rotation.x = 0
        visual.group.rotation.z = 0
      }
    }
  }

  /**
   * If we guessed the device wrong, notice within a couple of seconds and drop a
   * tier rather than grinding out a slideshow.
   */
  private watchPerformance(dt: number) {
    const frameMs = dt * 1000
    this.frameAverage = this.frameAverage * 0.94 + frameMs * 0.06
    this.adaptiveTimer += dt
    if (this.adaptiveTimer < 3) return
    this.adaptiveTimer = 0

    if (this.frameAverage > 26 && this.settings.tier !== 'low') {
      this.setQualityTier(stepTier(this.settings.tier, -1))
      this.frameAverage = 16
    }
  }

  dispose() {
    this.disposed = true
    this.post?.dispose()
    this.bloomMap.dispose()
    this.particles.dispose()
    this.motes.dispose()
    this.zestRings.dispose()
    this.swingTrail.dispose()
    this.floaters?.dispose()
    this.lemonField.dispose()
    this.leafField.dispose()
    this.water?.dispose()
    this.sky.dispose()
    this.horizon.dispose()
    this.lamb.dispose()
    this.critterHerd?.dispose()
    for (const set of this.treeGeometries) {
      set.full.dispose()
      set.stump.dispose()
    }
    this.scene.traverse((child) => {
      if (child instanceof Mesh) {
        const geometry = child.geometry as BufferGeometry | undefined
        geometry?.dispose()
      }
    })
    this.detailTexture.dispose()
    this.alphaTexture.dispose()
    this.renderer.dispose()
  }

  /** Progress of the valley coming back to life, 0 → 1. */
  get healProgress() {
    return this.heal
  }

  /** Current gust strength, so the wind you hear matches the grass you see. */
  get windStrength() {
    return this.uniforms.uWindStrength.value
  }

  /**
   * Camera position and heading on the ground plane, for panning world sounds.
   * Written into `out` to keep the per-frame path allocation-free.
   */
  readListener(out: { x: number; z: number; forwardX: number; forwardZ: number }) {
    const camera = this.followCamera.camera
    out.x = camera.position.x
    out.z = camera.position.z
    // Third column of the camera's world matrix is its local +Z; forward is -Z.
    const elements = camera.matrixWorld.elements
    out.forwardX = -elements[8]
    out.forwardZ = -elements[10]
    return out
  }
}
