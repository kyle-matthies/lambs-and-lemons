import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'

/**
 * The arc the mallet leaves behind it.
 *
 * A ribbon built from a short history of the mallet head's world position, widest
 * and brightest at the head and tapering to nothing at the tail. It's the single
 * cheapest way to make a swing feel like it has weight and speed: without it the
 * mallet just teleports through its arc between frames.
 */

const SEGMENTS = 14

export class SwingTrail {
  readonly mesh: Mesh

  private readonly points: Vector3[] = []
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly geometry: BufferGeometry
  private readonly material: MeshBasicMaterial
  private readonly up = new Vector3(0, 1, 0)
  private readonly direction = new Vector3()
  private readonly side = new Vector3()
  private strength = 0

  constructor(color = new Color('#fff4c2')) {
    this.positions = new Float32Array(SEGMENTS * 2 * 3)
    this.colors = new Float32Array(SEGMENTS * 2 * 4)

    const indices: number[] = []
    for (let index = 0; index < SEGMENTS - 1; index += 1) {
      const a = index * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }

    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 4))
    this.geometry.setIndex(indices)

    this.material = new MeshBasicMaterial({
      color,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      toneMapped: true,
    })

    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    this.mesh.visible = false

    for (let index = 0; index < SEGMENTS; index += 1) this.points.push(new Vector3())
  }

  /**
   * @param tip      current world position of the mallet head
   * @param strength 0-1; 1 during the strike, falling to 0 as the swing recovers
   */
  update(tip: Vector3, strength: number) {
    this.strength = strength

    if (strength <= 0.01) {
      this.mesh.visible = false
      // Collapse the history so the next swing doesn't smear in from the old pose.
      for (const point of this.points) point.copy(tip)
      return
    }

    this.mesh.visible = true
    // Shift the history along and push the new head position on the front.
    for (let index = this.points.length - 1; index > 0; index -= 1) {
      this.points[index].copy(this.points[index - 1])
    }
    this.points[0].copy(tip)

    for (let index = 0; index < SEGMENTS; index += 1) {
      const point = this.points[index]
      const next = this.points[Math.min(SEGMENTS - 1, index + 1)]

      this.direction.subVectors(point, next)
      if (this.direction.lengthSq() < 1e-8) this.direction.set(0, 0, 0.001)
      this.side.crossVectors(this.direction, this.up).normalize()

      // Taper: full width at the head, pinched to nothing at the tail.
      const t = index / (SEGMENTS - 1)
      const width = (1 - t) * (1 - t) * 0.16 + 0.01

      const base = index * 6
      this.positions[base] = point.x + this.side.x * width
      this.positions[base + 1] = point.y + this.side.y * width
      this.positions[base + 2] = point.z + this.side.z * width
      this.positions[base + 3] = point.x - this.side.x * width
      this.positions[base + 4] = point.y - this.side.y * width
      this.positions[base + 5] = point.z - this.side.z * width

      const alpha = (1 - t) * (1 - t) * strength
      for (const offset of [0, 4]) {
        const cursor = index * 8 + offset
        this.colors[cursor] = 1
        this.colors[cursor + 1] = 1
        this.colors[cursor + 2] = 1
        this.colors[cursor + 3] = alpha
      }
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
  }

  get active() {
    return this.strength > 0.01
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
