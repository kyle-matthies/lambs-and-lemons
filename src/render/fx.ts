import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three'
import { clamp01 } from '../core/math'
import { randRange } from '../core/rng'

/**
 * Impact juice: particles and expanding zest rings.
 *
 * Both are pooled and instanced, so a heavy combo can throw hundreds of bits of
 * pulp around without touching the allocator or adding draw calls.
 */

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  size: number
  gravity: number
  drag: number
  spin: number
  spinSpeed: number
  color: Color
  /** Additive particles glow; normal ones read as solid pulp. */
  glow: boolean
}

export interface BurstOptions {
  count: number
  color: Color
  speed?: [number, number]
  lift?: [number, number]
  size?: [number, number]
  life?: [number, number]
  gravity?: number
  drag?: number
  glow?: boolean
  /** Bias the spray along a direction rather than a full sphere. */
  direction?: Vector3
  spread?: number
}

const SPIN_AXIS = new Vector3(0.4, 1, 0.2).normalize()
const UP = new Vector3(0, 1, 0)
const TEMP_DIR = new Vector3()

export class ParticleField {
  readonly solidMesh: InstancedMesh
  readonly glowMesh: InstancedMesh

  private readonly particles: Particle[] = []
  private readonly pool: Particle[] = []
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly quaternion = new Quaternion()
  private readonly scale = new Vector3()
  private readonly sprayDir = new Vector3()
  private readonly sprayRotation = new Quaternion()
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    const geometry = new IcosahedronGeometry(0.5, 0)

    const solidMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: true })
    this.solidMesh = new InstancedMesh(geometry, solidMaterial, capacity)
    this.solidMesh.frustumCulled = false
    this.solidMesh.count = 0
    this.solidMesh.setColorAt(0, new Color(1, 1, 1))

    const glowMaterial = new MeshBasicMaterial({
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: true,
    })
    this.glowMesh = new InstancedMesh(geometry, glowMaterial, capacity)
    this.glowMesh.frustumCulled = false
    this.glowMesh.count = 0
    this.glowMesh.renderOrder = 4
    this.glowMesh.setColorAt(0, new Color(1, 1, 1))
  }

  private take(): Particle {
    const recycled = this.pool.pop()
    if (recycled) return recycled
    return {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      gravity: 1,
      drag: 1,
      spin: 0,
      spinSpeed: 0,
      color: new Color(),
      glow: false,
    }
  }

  burst(x: number, y: number, z: number, options: BurstOptions) {
    const {
      count,
      color,
      speed = [1.5, 5],
      lift = [1.5, 4.5],
      size = [0.06, 0.16],
      life = [0.45, 0.95],
      gravity = 14,
      drag = 1.4,
      glow = false,
      direction,
      spread = Math.PI,
    } = options

    if (direction) {
      this.sprayRotation.setFromUnitVectors(UP, TEMP_DIR.copy(direction).normalize())
    }

    for (let index = 0; index < count; index += 1) {
      if (this.particles.length >= this.capacity) break

      const particle = this.take()
      particle.x = x
      particle.y = y
      particle.z = z

      let dx: number
      let dy: number
      let dz: number
      if (direction) {
        // Cone spray around a direction — used for splashes off the mallet.
        const theta = Math.random() * Math.PI * 2
        const phi = Math.random() * spread
        const sinPhi = Math.sin(phi)
        this.sprayDir.set(sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta))
        this.sprayDir.applyQuaternion(this.sprayRotation)
        dx = this.sprayDir.x
        dy = this.sprayDir.y
        dz = this.sprayDir.z
      } else {
        const theta = Math.random() * Math.PI * 2
        const u = Math.random() * 2 - 1
        const r = Math.sqrt(1 - u * u)
        dx = r * Math.cos(theta)
        dy = Math.abs(u) * 0.7 + 0.3
        dz = r * Math.sin(theta)
      }

      const power = randRange(Math.random, speed[0], speed[1])
      particle.vx = dx * power
      particle.vy = dy * randRange(Math.random, lift[0], lift[1])
      particle.vz = dz * power
      particle.maxLife = randRange(Math.random, life[0], life[1])
      particle.life = particle.maxLife
      particle.size = randRange(Math.random, size[0], size[1])
      particle.gravity = gravity
      particle.drag = drag
      particle.spin = Math.random() * Math.PI * 2
      particle.spinSpeed = randRange(Math.random, -14, 14)
      particle.color.copy(color)
      particle.glow = glow
      this.particles.push(particle)
    }
  }

  update(dt: number, groundAt?: (x: number, z: number) => number) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]
      particle.life -= dt
      if (particle.life <= 0) {
        this.particles.splice(index, 1)
        this.pool.push(particle)
        continue
      }

      particle.vy -= particle.gravity * dt
      const drag = Math.exp(-particle.drag * dt)
      particle.vx *= drag
      particle.vz *= drag
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.z += particle.vz * dt
      particle.spin += particle.spinSpeed * dt

      if (groundAt) {
        const floor = groundAt(particle.x, particle.z) + particle.size * 0.4
        if (particle.y < floor) {
          particle.y = floor
          particle.vy = Math.abs(particle.vy) * 0.28
          particle.vx *= 0.6
          particle.vz *= 0.6
        }
      }
    }

    this.writeInstances()
  }

  private writeInstances() {
    let solid = 0
    let glow = 0

    for (const particle of this.particles) {
      const t = clamp01(particle.life / particle.maxLife)
      // Pop in fast, shrink out slow.
      const scale = particle.size * (t > 0.85 ? (1 - t) / 0.15 : Math.pow(t, 0.45))
      this.position.set(particle.x, particle.y, particle.z)
      this.quaternion.setFromAxisAngle(SPIN_AXIS, particle.spin)
      this.scale.setScalar(Math.max(0.0001, scale))
      this.matrix.compose(this.position, this.quaternion, this.scale)

      if (particle.glow) {
        if (glow >= this.capacity) continue
        this.glowMesh.setMatrixAt(glow, this.matrix)
        this.glowMesh.setColorAt(glow, particle.color)
        glow += 1
      } else {
        if (solid >= this.capacity) continue
        this.solidMesh.setMatrixAt(solid, this.matrix)
        this.solidMesh.setColorAt(solid, particle.color)
        solid += 1
      }
    }

    this.solidMesh.count = solid
    this.glowMesh.count = glow
    this.solidMesh.instanceMatrix.needsUpdate = true
    this.glowMesh.instanceMatrix.needsUpdate = true
    if (this.solidMesh.instanceColor) this.solidMesh.instanceColor.needsUpdate = true
    if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true
  }


  clear() {
    while (this.particles.length > 0) this.pool.push(this.particles.pop()!)
    this.solidMesh.count = 0
    this.glowMesh.count = 0
  }

  dispose() {
    this.solidMesh.geometry.dispose()
    ;(this.solidMesh.material as MeshBasicMaterial).dispose()
    ;(this.glowMesh.material as MeshBasicMaterial).dispose()
    this.solidMesh.dispose()
    this.glowMesh.dispose()
  }
}

// ---------------------------------------------------------------------------
// Zest rings
// ---------------------------------------------------------------------------

interface Ring {
  mesh: Mesh
  life: number
  maxLife: number
  radius: number
  active: boolean
}

/**
 * The visible wavefront of a zest burst: a bright ring that races outward across
 * the grass, arriving a beat before the colour it leaves behind.
 */
export class ZestRings {
  readonly group = new Group()
  private readonly rings: Ring[] = []

  constructor(poolSize = 12) {
    this.group.name = 'zestRings'

    const geometry = new RingGeometry(0.72, 1, 48, 1)
    geometry.rotateX(-Math.PI / 2)

    for (let index = 0; index < poolSize; index += 1) {
      const material = new MeshBasicMaterial({
        color: new Color('#fff2a8'),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: true,
      })
      const mesh = new Mesh(geometry, material)
      mesh.visible = false
      mesh.renderOrder = 3
      this.group.add(mesh)
      this.rings.push({ mesh, life: 0, maxLife: 1, radius: 1, active: false })
    }
  }

  spawn(x: number, y: number, z: number, radius: number, color: Color, duration = 0.75) {
    const ring = this.rings.find((candidate) => !candidate.active) ?? this.rings[0]
    ring.active = true
    ring.life = duration
    ring.maxLife = duration
    ring.radius = radius
    ring.mesh.visible = true
    ring.mesh.position.set(x, y + 0.12, z)
    ring.mesh.scale.setScalar(0.001)
    ;(ring.mesh.material as MeshBasicMaterial).color.copy(color)
  }

  update(dt: number, groundAt?: (x: number, z: number) => number) {
    for (const ring of this.rings) {
      if (!ring.active) continue
      ring.life -= dt
      if (ring.life <= 0) {
        ring.active = false
        ring.mesh.visible = false
        continue
      }

      const t = 1 - ring.life / ring.maxLife
      // Fast start, slow finish — it should feel like a shockwave losing energy.
      const eased = 1 - Math.pow(1 - t, 2.6)
      ring.mesh.scale.setScalar(Math.max(0.001, eased * ring.radius))
      const material = ring.mesh.material as MeshBasicMaterial
      material.opacity = (1 - t) * (1 - t) * 0.85

      if (groundAt) {
        ring.mesh.position.y = groundAt(ring.mesh.position.x, ring.mesh.position.z) + 0.12
      }
    }
  }

  clear() {
    for (const ring of this.rings) {
      ring.active = false
      ring.mesh.visible = false
    }
  }

  dispose() {
    for (const ring of this.rings) {
      ;(ring.mesh.material as MeshBasicMaterial).dispose()
    }
    this.rings[0]?.mesh.geometry.dispose()
  }
}
