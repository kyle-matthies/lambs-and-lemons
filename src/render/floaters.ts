import { Vector3, type Camera } from 'three'

/**
 * Score popups that live in the world but render as crisp DOM text.
 *
 * Drawing text in WebGL means either a font atlas (a download, and blurry when
 * scaled) or an SDF pipeline (overkill here). Projecting a world position to
 * screen space and moving a `<span>` gives pixel-perfect type at any resolution
 * for almost nothing — the pool is reused, and positions are written straight to
 * `style.transform` rather than going through React.
 */

interface Floater {
  element: HTMLSpanElement
  x: number
  y: number
  z: number
  life: number
  maxLife: number
  rise: number
  active: boolean
}

const POOL_SIZE = 24

export class Floaters {
  private readonly pool: Floater[] = []
  private readonly projected = new Vector3()

  constructor(container: HTMLElement) {
    for (let index = 0; index < POOL_SIZE; index += 1) {
      const element = document.createElement('span')
      element.className = 'world-floater'
      element.style.opacity = '0'
      container.appendChild(element)
      this.pool.push({ element, x: 0, y: 0, z: 0, life: 0, maxLife: 1, rise: 1, active: false })
    }
  }

  spawn(x: number, y: number, z: number, text: string, variant = '') {
    // Recycle the oldest if we've run out — a burst should never drop the newest
    // popup, which is the one the player is actually looking for.
    let floater = this.pool.find((candidate) => !candidate.active)
    if (!floater) {
      floater = this.pool.reduce((oldest, candidate) =>
        candidate.life < oldest.life ? candidate : oldest,
      )
    }

    floater.active = true
    floater.x = x
    floater.y = y
    floater.z = z
    floater.maxLife = 1.05
    floater.life = floater.maxLife
    floater.rise = 1.5
    floater.element.textContent = text
    floater.element.className = `world-floater${variant ? ` ${variant}` : ''}`
    floater.element.style.opacity = '1'
  }

  update(camera: Camera, width: number, height: number, dt: number) {
    for (const floater of this.pool) {
      if (!floater.active) continue

      floater.life -= dt
      if (floater.life <= 0) {
        floater.active = false
        floater.element.style.opacity = '0'
        continue
      }

      const t = 1 - floater.life / floater.maxLife
      floater.y += floater.rise * dt

      this.projected.set(floater.x, floater.y, floater.z).project(camera)
      // Behind the camera: hide rather than mirror it onto the wrong side.
      if (this.projected.z > 1) {
        floater.element.style.opacity = '0'
        continue
      }

      const screenX = (this.projected.x * 0.5 + 0.5) * width
      const screenY = (-this.projected.y * 0.5 + 0.5) * height
      // Pop in, hold, fade out.
      const scale = t < 0.18 ? 0.6 + (t / 0.18) * 0.55 : 1.15 - (t - 0.18) * 0.18
      floater.element.style.transform = `translate(-50%, -50%) translate(${screenX.toFixed(
        1,
      )}px, ${screenY.toFixed(1)}px) scale(${scale.toFixed(3)})`
      floater.element.style.opacity = String(Math.min(1, (1 - t) * 2.6))
    }
  }

  clear() {
    for (const floater of this.pool) {
      floater.active = false
      floater.element.style.opacity = '0'
    }
  }

  dispose() {
    for (const floater of this.pool) floater.element.remove()
    this.pool.length = 0
  }
}
