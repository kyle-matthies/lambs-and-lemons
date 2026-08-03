import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three'
import { createNoise2D, fbm } from '../core/noise'
import { mulberry32 } from '../core/rng'

/**
 * Distant ridges.
 *
 * Three unlit silhouette bands ringing the valley, each further away, lighter and
 * bluer than the last. They cost three draw calls and no lighting, and they do
 * more for the sense of "this valley sits inside a world" than anything else in
 * the scene: without them the meadow just stops at a fog wall.
 *
 * Deliberately not fogged — these *are* the atmosphere, so their colours are
 * authored directly against the sky's horizon tone rather than blended toward it.
 */

interface RidgeLayer {
  radius: number
  height: number
  roughness: number
  color: string
  /** Vertical offset so nearer ridges sit lower and overlap the ones behind. */
  base: number
}

const LAYERS: RidgeLayer[] = [
  { radius: 128, height: 13, roughness: 1.35, color: '#7d9db9', base: -8 },
  { radius: 196, height: 21, roughness: 1, color: '#9cbcd4', base: -11 },
  { radius: 272, height: 30, roughness: 0.75, color: '#bdd7e8', base: -14 },
]

function buildRidge(layer: RidgeLayer, seed: number, segments = 220) {
  const noise = createNoise2D(mulberry32(seed))
  const positions = new Float32Array(segments * 2 * 3)
  const colors = new Float32Array(segments * 2 * 3)
  const indices: number[] = []

  const crest = new Color(layer.color)
  // Darken the base a touch so each ridge has a little internal form.
  const foot = crest.clone().multiplyScalar(0.82)

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const x = Math.cos(angle)
    const z = Math.sin(angle)

    // Sample the noise on the circle itself so the profile wraps seamlessly.
    const ridgeNoise =
      fbm(noise, x * layer.roughness * 2.6, z * layer.roughness * 2.6, { octaves: 4 }) * 0.5 + 0.5
    const peak = layer.base + layer.height * (0.35 + ridgeNoise * 0.95)

    const top = index * 6
    const bottom = top + 3
    positions[top] = x * layer.radius
    positions[top + 1] = peak
    positions[top + 2] = z * layer.radius
    positions[bottom] = x * layer.radius
    positions[bottom + 1] = layer.base - 40
    positions[bottom + 2] = z * layer.radius

    colors[top] = crest.r
    colors[top + 1] = crest.g
    colors[top + 2] = crest.b
    colors[bottom] = foot.r
    colors[bottom + 1] = foot.g
    colors[bottom + 2] = foot.b
  }

  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments
    const a = index * 2
    const b = a + 1
    const c = next * 2
    const d = c + 1
    indices.push(a, b, c, b, d, c)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export class Horizon {
  readonly group = new Group()
  private readonly materials: MeshBasicMaterial[] = []
  private readonly baseColors: Color[] = []

  constructor(seed: number) {
    this.group.name = 'horizon'

    LAYERS.forEach((layer, index) => {
      const material = new MeshBasicMaterial({
        vertexColors: true,
        fog: false,
        depthWrite: true,
        side: 2 /* DoubleSide — we see the inside of the ring */,
      })
      const mesh = new Mesh(buildRidge(layer, seed * 31 + index * 977), material)
      mesh.frustumCulled = false
      // After the sky, before everything that lives in the valley.
      mesh.renderOrder = -900 + index
      this.group.add(mesh)
      this.materials.push(material)
      this.baseColors.push(new Color(layer.color))
    })
  }

  /**
   * Ridges drain toward the sour haze along with everything else, then warm back
   * up as the valley recovers.
   */
  update(heal: number, sourTint: Color, cameraX: number, cameraZ: number) {
    this.group.position.set(cameraX, 0, cameraZ)
    this.materials.forEach((material, index) => {
      const base = this.baseColors[index]
      const luma = base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722
      material.color
        .setRGB(luma, luma, luma)
        .lerp(sourTint, 0.55)
        .multiplyScalar(0.82)
        .lerp(base, heal)
    })
  }

  dispose() {
    this.group.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose()
    })
    this.materials.forEach((material) => material.dispose())
  }
}
