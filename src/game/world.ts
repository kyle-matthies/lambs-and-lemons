import { lerp, smoothstep } from '../core/math'
import { createNoise2D, fbm, ridged } from '../core/noise'
import { mulberry32, randRange, type Rng } from '../core/rng'

/**
 * The valley itself: a seeded height field plus the scatter layout that sits on it.
 *
 * Everything is in metres, y-up, with the meadow on the XZ plane and the origin at
 * the centre of the bowl. Both the simulation (collision, item bouncing, spawn
 * placement) and the renderer (terrain mesh, grass, props) read heights from
 * `World.heightAt`, so there is never a mismatch between what you see and what you
 * walk on.
 *
 * A `GroveRecipe` is the whole description of a place — how wide it is, how the
 * hills sit around it, whether there is water, what grows there. Chapters differ
 * only by their recipe, which is why the campaign needs no new terrain code to
 * put you somewhere that feels nothing like the meadow you started in.
 */

/** Radius of the playable meadow floor. Beyond this the ground curls up into a rim. */
export const PLAY_RADIUS = 30

export interface Pond {
  x: number
  z: number
  radius: number
  depth: number
}

export interface Flat {
  x: number
  z: number
  radius: number
  falloff: number
}

export interface GroveRecipe {
  playRadius: number
  /**
   * The sheltering hills. `start` and `end` are multiples of `playRadius`, so a
   * small meadow gets a close rim without retuning anything; `height` is metres
   * and `rock` is how much ridged noise breaks the slope up.
   */
  rim: { start: number; end: number; height: number; rock: number }
  /** Amplitude in metres of the broad roll and the fine dimpling. */
  terrain: { rolling: number; dimple: number }
  pond: Pond | null
  stand: { x: number; z: number }
  scatter: {
    trees: number
    /** Minimum metres between trunks. Drop it and a meadow becomes an orchard. */
    treeSpacing: number
    bushes: number
    rocks: number
    flowers: number
    reeds: number
  }
}

/**
 * The valley as it has always been. Arcade mode passes no recipe at all and so
 * lands here, which is how the campaign refactor leaves that mode byte-identical.
 */
export const DEFAULT_RECIPE: GroveRecipe = {
  playRadius: PLAY_RADIUS,
  rim: { start: 0.84, end: 1.62, height: 7.5, rock: 2.4 },
  terrain: { rolling: 1.55, dimple: 0.34 },
  pond: { x: -15.5, z: -9.5, radius: 7.2, depth: 2.3 },
  stand: { x: 1.5, z: 10.5 },
  scatter: { trees: 15, treeSpacing: 6.2, bushes: 46, rocks: 38, flowers: 190, reeds: 90 },
}

export interface World {
  seed: number
  recipe: GroveRecipe
  playRadius: number
  /** Null in the dry chapters. Every consumer has to cope with there being no water. */
  pond: Pond | null
  waterLevel: number
  /** Ground height in metres at a planar position. */
  heightAt: (x: number, z: number) => number
  /** Unit surface normal, by central difference. Used for slope-aligned props. */
  normalAt: (x: number, z: number, out?: Vec3Like) => Vec3Like
  /** Flattened pads (the stand apron) that props and gameplay both respect. */
  flats: Flat[]
}

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface ScatterPoint {
  x: number
  y: number
  z: number
  rotation: number
  scale: number
  variant: number
}

export interface GroveLayout {
  stand: Vec3Like
  standRotation: number
  trees: ScatterPoint[]
  rocks: ScatterPoint[]
  bushes: ScatterPoint[]
  flowers: ScatterPoint[]
  reeds: ScatterPoint[]
}

/** Fixed spot for the lemonade stand — always south of centre, always reachable. */
export const STAND_POSITION = DEFAULT_RECIPE.stand

export function createWorld(seed: number, recipe: GroveRecipe = DEFAULT_RECIPE): World {
  const noiseA = createNoise2D(mulberry32(seed))
  const noiseB = createNoise2D(mulberry32(seed ^ 0x9e3779b9))
  const noiseC = createNoise2D(mulberry32(seed ^ 0x85ebca6b))

  const playRadius = recipe.playRadius
  const rimStart = playRadius * recipe.rim.start
  const rimEnd = playRadius * recipe.rim.end
  const pond = recipe.pond
  const flats: Flat[] = [
    { x: recipe.stand.x, z: recipe.stand.z, radius: 3.4, falloff: 4.2 },
  ]

  const rawHeight = (x: number, z: number) => {
    // Broad rolling meadow.
    let height = fbm(noiseA, x * 0.028, z * 0.028, { octaves: 4 }) * recipe.terrain.rolling
    // Small dimples so the grass never reads as a flat plane up close.
    height += fbm(noiseB, x * 0.085, z * 0.085, { octaves: 2 }) * recipe.terrain.dimple

    // The bowl: ground lifts into sheltering hills around the meadow.
    const radius = Math.hypot(x, z)
    const rim = smoothstep(rimStart, rimEnd, radius)
    if (rim > 0) {
      const rocky = ridged(noiseC, x * 0.06, z * 0.06, { octaves: 3 })
      height += rim * rim * recipe.rim.height + rim * rocky * recipe.rim.rock
    }

    // Pond basin — a smooth bowl that bottoms out below the water line.
    if (pond) {
      const pondDistance = Math.hypot(x - pond.x, z - pond.z)
      if (pondDistance < pond.radius * 1.5) {
        const dip = 1 - smoothstep(pond.radius * 0.35, pond.radius * 1.25, pondDistance)
        height -= dip * dip * pond.depth
      }
    }

    return height
  }

  const heightAt = (x: number, z: number) => {
    let height = rawHeight(x, z)
    // Flatten the pads so the stand never floats or sinks on a slope.
    for (const flat of flats) {
      const distance = Math.hypot(x - flat.x, z - flat.z)
      if (distance > flat.falloff) continue
      const blend = 1 - smoothstep(flat.radius, flat.falloff, distance)
      height = lerp(height, rawHeight(flat.x, flat.z), blend)
    }
    return height
  }

  const normalAt = (x: number, z: number, out: Vec3Like = { x: 0, y: 1, z: 0 }) => {
    const step = 0.35
    const dx = heightAt(x + step, z) - heightAt(x - step, z)
    const dz = heightAt(x, z + step) - heightAt(x, z - step)
    const nx = -dx
    const ny = 2 * step
    const nz = -dz
    const length = Math.hypot(nx, ny, nz) || 1
    out.x = nx / length
    out.y = ny / length
    out.z = nz / length
    return out
  }

  return {
    seed,
    recipe,
    playRadius,
    pond,
    // Well below any ground in a dry chapter, so depth tests there are simply never met.
    waterLevel: pond ? heightAt(pond.x, pond.z) + pond.depth * 0.62 : -1000,
    heightAt,
    normalAt,
    flats,
  }
}

/** True when a planar point is inside the meadow and clear of the pond. */
export function isWalkable(world: World, x: number, z: number, margin = 0) {
  if (Math.hypot(x, z) > world.playRadius - margin) return false
  if (!world.pond) return true
  const pondDistance = Math.hypot(x - world.pond.x, z - world.pond.z)
  return pondDistance > world.pond.radius * 0.82 + margin
}

interface ScatterOptions {
  count: number
  minRadius: number
  maxRadius: number
  spacing: number
  scale: [number, number]
  variants: number
  avoid?: { x: number; z: number; radius: number }[]
  slopeLimit?: number
}

/**
 * Rejection-sampled scatter: keeps a minimum spacing so groves never clump, stays
 * off steep slopes, and honours exclusion zones (stand apron, pond, other layers).
 */
function scatter(world: World, rng: Rng, options: ScatterOptions): ScatterPoint[] {
  const points: ScatterPoint[] = []
  const spacingSq = options.spacing * options.spacing
  const slopeLimit = options.slopeLimit ?? 0.62
  const normal = { x: 0, y: 1, z: 0 }
  const maxAttempts = options.count * 40

  for (let attempt = 0; attempt < maxAttempts && points.length < options.count; attempt += 1) {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(randRange(rng, 0, 1)) * options.maxRadius
    if (radius < options.minRadius) continue
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

    if (options.avoid?.some((zone) => Math.hypot(x - zone.x, z - zone.z) < zone.radius)) continue

    world.normalAt(x, z, normal)
    if (normal.y < slopeLimit) continue

    let tooClose = false
    for (const point of points) {
      const dx = point.x - x
      const dz = point.z - z
      if (dx * dx + dz * dz < spacingSq) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    points.push({
      x,
      y: world.heightAt(x, z),
      z,
      rotation: rng() * Math.PI * 2,
      scale: randRange(rng, options.scale[0], options.scale[1]),
      variant: Math.floor(rng() * options.variants),
    })
  }

  return points
}

export function generateGroveLayout(
  world: World,
  treeCount: number = world.recipe.scatter.trees,
): GroveLayout {
  const recipe = world.recipe
  const rng = mulberry32(world.seed ^ 0xc2b2ae35)
  const standPosition = recipe.stand
  const standZone = { x: standPosition.x, z: standPosition.z, radius: 6 }
  const centreZone = { x: 0, z: 0, radius: 4.5 }
  // A dry chapter simply contributes no exclusion zone, leaving the rest untouched.
  const wetZones = world.pond
    ? [{ x: world.pond.x, z: world.pond.z, radius: world.pond.radius * 1.05 }]
    : []

  const trees = scatter(world, rng, {
    count: treeCount,
    minRadius: 6.5,
    maxRadius: world.playRadius - 3.5,
    spacing: recipe.scatter.treeSpacing,
    scale: [0.86, 1.22],
    variants: 3,
    avoid: [...wetZones, standZone, centreZone],
  })

  const treeZones = trees.map((tree) => ({ x: tree.x, z: tree.z, radius: 2.6 }))

  const bushes = scatter(world, rng, {
    count: recipe.scatter.bushes,
    minRadius: 4,
    maxRadius: world.playRadius + 9,
    spacing: 2.5,
    scale: [0.7, 1.5],
    variants: 3,
    avoid: [...wetZones, standZone, ...treeZones],
  })

  const rocks = scatter(world, rng, {
    count: recipe.scatter.rocks,
    minRadius: 5,
    maxRadius: world.playRadius + 12,
    spacing: 2.2,
    scale: [0.5, 1.7],
    variants: 3,
    slopeLimit: 0.3,
    avoid: [standZone],
  })

  const flowers = scatter(world, rng, {
    count: recipe.scatter.flowers,
    minRadius: 2,
    maxRadius: world.playRadius - 1,
    spacing: 0.95,
    scale: [0.75, 1.35],
    variants: 4,
    avoid: [...wetZones, { ...standZone, radius: 3.2 }],
  })

  // Reeds hug the waterline rather than scattering over the meadow.
  const reeds: ScatterPoint[] = []
  const pond = world.pond
  if (pond) {
    for (let index = 0; index < recipe.scatter.reeds; index += 1) {
      const angle = rng() * Math.PI * 2
      const distance = pond.radius * randRange(rng, 0.78, 1.12)
      const x = pond.x + Math.cos(angle) * distance
      const z = pond.z + Math.sin(angle) * distance
      const y = world.heightAt(x, z)
      if (y < world.waterLevel - 0.8 || y > world.waterLevel + 1.1) continue
      reeds.push({
        x,
        y,
        z,
        rotation: rng() * Math.PI * 2,
        scale: randRange(rng, 0.7, 1.4),
        variant: Math.floor(rng() * 2),
      })
    }
  }

  return {
    stand: {
      x: standPosition.x,
      y: world.heightAt(standPosition.x, standPosition.z),
      z: standPosition.z,
    },
    // Face the stand roughly back toward the middle of the meadow.
    standRotation: Math.atan2(-standPosition.x, -standPosition.z),
    trees,
    rocks,
    bushes,
    flowers,
    reeds,
  }
}

/**
 * Push a planar position back inside the meadow, sliding along the boundary rather
 * than stopping dead so movement into a wall still feels smooth.
 */
export function constrainToMeadow(
  world: World,
  x: number,
  z: number,
  radius: number,
  out: { x: number; z: number },
) {
  let nextX = x
  let nextZ = z

  const limit = world.playRadius - radius
  const distance = Math.hypot(nextX, nextZ)
  if (distance > limit && distance > 0) {
    nextX = (nextX / distance) * limit
    nextZ = (nextZ / distance) * limit
  }

  if (world.pond) {
    const pondLimit = world.pond.radius * 0.82 + radius
    const pondDx = nextX - world.pond.x
    const pondDz = nextZ - world.pond.z
    const pondDistance = Math.hypot(pondDx, pondDz)
    if (pondDistance < pondLimit && pondDistance > 0.0001) {
      nextX = world.pond.x + (pondDx / pondDistance) * pondLimit
      nextZ = world.pond.z + (pondDz / pondDistance) * pondLimit
    }
  }

  out.x = nextX
  out.z = nextZ
  return out
}
