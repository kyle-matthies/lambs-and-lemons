import type { GameAssets } from './assets'
import type { GameEvent, GameState } from './types'
import type { DecorationId } from '../lib/storage'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  ttl: number
  maxTtl: number
  size: number
  color: string
  shape: 'dot' | 'leaf' | 'star'
  spin: number
}

interface Floater {
  x: number
  y: number
  ttl: number
  maxTtl: number
  text: string
  color: string
  size: number
}

interface Decal {
  x: number
  y: number
  ttl: number
  maxTtl: number
  size: number
}

export interface RenderFx {
  particles: Particle[]
  floaters: Floater[]
  decals: Decal[]
  shakeTime: number
  shakeDuration: number
  shakeMag: number
}

const MAX_PARTICLES = 140
const MAX_DECALS = 24

export function createRenderFx(): RenderFx {
  return { particles: [], floaters: [], decals: [], shakeTime: 0, shakeDuration: 1, shakeMag: 0 }
}

export function processEvents(fx: RenderFx, events: GameEvent[]) {
  events.forEach((event) => {
    switch (event.type) {
      case 'smash':
        burstParticles(fx, event.x, event.y, 10, '#ffdf3d', 'dot')
        addDecal(fx, event.x, event.y, 58)
        addFloater(fx, event.x, event.y, '+1', '#8c5a10')
        break
      case 'whiff':
        burstParticles(fx, event.x, event.y, 4, '#d8ecb0', 'dot')
        break
      case 'treeHit':
        burstParticles(fx, event.x, event.y - 30, 8, '#57b944', 'leaf')
        addFloater(fx, event.x, event.y - 44, '+2', '#1c7a2e')
        shake(fx, 4, 0.12)
        break
      case 'treeBreak':
        burstParticles(fx, event.x, event.y - 20, 16, '#57b944', 'leaf')
        burstParticles(fx, event.x, event.y, 10, '#ffdf3d', 'dot')
        addFloater(fx, event.x, event.y - 52, '+2', '#1c7a2e')
        shake(fx, 9, 0.25)
        break
      case 'treeRegrow':
        burstParticles(fx, event.x, event.y - 26, 8, '#aef171', 'star')
        break
      case 'pickupLemon':
        burstParticles(fx, event.x, event.y, 5, '#ffe15b', 'star')
        addFloater(fx, event.x, event.y, '+1', '#8c5a10')
        break
      case 'pickupLeaf':
        burstParticles(fx, event.x, event.y, 5, '#7ddc4e', 'star')
        addFloater(fx, event.x, event.y, '+1', '#1c7a2e')
        break
      case 'cupSold':
        burstParticles(
          fx,
          event.x,
          event.y + 20,
          event.sparkle ? 14 : 8,
          event.sparkle ? '#ffd23d' : '#fff3a8',
          'star',
        )
        addFloater(
          fx,
          event.x,
          event.y - 8,
          event.sparkle ? '+10' : '+5',
          event.sparkle ? '#c47f00' : '#8c5a10',
          event.sparkle ? 26 : 22,
        )
        break
      case 'combo':
        addFloater(fx, event.x, event.y - 70, `x${event.level}!`, '#e0442e', 24)
        break
      case 'countdown':
      case 'timeUp':
        break
    }
  })
}

export function updateRenderFx(fx: RenderFx, dt: number) {
  fx.shakeTime = Math.max(0, fx.shakeTime - dt)

  fx.particles.forEach((particle) => {
    particle.ttl -= dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.vy += 260 * dt
    particle.spin += dt * 7
  })
  fx.particles = fx.particles.filter((particle) => particle.ttl > 0)

  fx.floaters.forEach((floater) => {
    floater.ttl -= dt
    floater.y -= 42 * dt
  })
  fx.floaters = fx.floaters.filter((floater) => floater.ttl > 0)

  fx.decals.forEach((decal) => {
    decal.ttl -= dt
  })
  fx.decals = fx.decals.filter((decal) => decal.ttl > 0)
}

export function drawGame(
  context: CanvasRenderingContext2D,
  state: GameState,
  assets: GameAssets,
  fx: RenderFx,
  decorations: DecorationId[] = [],
) {
  const { width, height } = state
  const scale = Math.max(0.82, Math.min(width / 390, height / 844))

  context.save()
  if (fx.shakeTime > 0) {
    const intensity = fx.shakeMag * (fx.shakeTime / fx.shakeDuration)
    context.translate(
      (Math.random() - 0.5) * 2 * intensity,
      (Math.random() - 0.5) * 2 * intensity,
    )
  }

  context.clearRect(-12, -12, width + 24, height + 24)
  context.drawImage(assets.background, 0, 0, width, height)

  // Splat decals sit on the grass, under everything that walks.
  fx.decals.forEach((decal) => {
    context.save()
    context.globalAlpha = 0.32 * Math.min(1, decal.ttl / (decal.maxTtl * 0.4))
    drawSprite(context, assets.splat, decal.x, decal.y, decal.size, decal.size)
    context.restore()
  })

  const drawables: { y: number; draw: () => void }[] = []

  drawables.push({
    y: state.stand.y + 52,
    draw: () => {
      drawSprite(context, assets.stand, state.stand.x, state.stand.y, 126 * scale, 118 * scale)
      drawDecorations(context, state.stand.x, state.stand.y, scale, decorations)
      drawBrewRing(context, state, scale)
    },
  })

  state.trees.forEach((tree) => {
    drawables.push({
      y: tree.y + 54,
      draw: () => {
        const broken = tree.stage === 'broken'
        const image = broken ? assets.stump : assets.tree
        const baseWidth = (broken ? 100 : 122) * scale
        const baseHeight = (broken ? 92 : 132) * scale
        const grow = tree.regrowTimer > 0 ? easeOutBack(1 - tree.regrowTimer / 0.4) : 1
        const wobble = tree.wobbleTimer > 0 ? Math.sin(tree.wobbleTimer * 34) * 0.06 * (tree.wobbleTimer / 0.45) : 0

        context.save()
        context.translate(tree.x, tree.y)
        if (wobble !== 0) context.rotate(wobble)
        context.scale(grow, grow)
        context.drawImage(image, -baseWidth / 2, -baseHeight / 2, baseWidth, baseHeight)
        context.restore()
      },
    })
  })

  state.lemons.forEach((lemon) => {
    drawables.push({
      y: lemon.y + 15,
      draw: () => drawSprite(context, assets.lemon, lemon.x, lemon.y, 34 * scale, 34 * scale),
    })
  })

  state.leaves.forEach((leaf) => {
    drawables.push({
      y: leaf.y + 13,
      draw: () => drawSprite(context, assets.leaf, leaf.x, leaf.y, 32 * scale, 28 * scale),
    })
  })

  drawables.push({
    y: state.player.y + 39,
    draw: () => {
      const swinging = state.player.swingTimer > 0
      drawSprite(
        context,
        swinging ? assets.lambSwing : assets.lambIdle,
        state.player.x,
        state.player.y,
        (swinging ? 122 : 82) * scale,
        (swinging ? 92 : 88) * scale,
        state.player.facingX < -0.1,
      )
    },
  })

  drawables
    .sort((a, b) => a.y - b.y)
    .forEach((drawable) => {
      drawable.draw()
    })

  state.effects.forEach((effect) => {
    context.save()
    context.globalAlpha = Math.max(0, effect.ttl / effect.maxTtl)
    drawSprite(context, assets.splat, effect.x, effect.y, effect.size * scale, effect.size * scale)
    context.restore()
  })

  drawParticles(context, fx)
  drawFloaters(context, fx, scale)
  context.restore()
}

export function drawDecorations(
  context: CanvasRenderingContext2D,
  standX: number,
  standY: number,
  scale: number,
  decorations: DecorationId[],
) {
  if (decorations.length === 0) return
  context.save()
  context.translate(standX, standY)

  if (decorations.includes('flowers')) {
    const potX = -74 * scale
    const potY = 44 * scale
    context.fillStyle = '#b05a2a'
    context.fillRect(potX - 10 * scale, potY, 20 * scale, 14 * scale)
    const petals = ['#ff7ac2', '#ffd23d', '#ff8a5c']
    petals.forEach((color, index) => {
      context.fillStyle = color
      context.beginPath()
      context.arc(potX + (index - 1) * 8 * scale, potY - 6 * scale, 5 * scale, 0, Math.PI * 2)
      context.fill()
    })
  }

  if (decorations.includes('umbrella')) {
    const top = -86 * scale
    context.strokeStyle = '#8a4b1f'
    context.lineWidth = 3 * scale
    context.beginPath()
    context.moveTo(46 * scale, top + 30 * scale)
    context.lineTo(46 * scale, -30 * scale)
    context.stroke()
    context.fillStyle = '#ff5b5b'
    context.beginPath()
    context.arc(46 * scale, top + 32 * scale, 34 * scale, Math.PI, 0)
    context.fill()
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(46 * scale, top + 32 * scale, 34 * scale, Math.PI + 0.55, Math.PI + 1.1)
    context.arc(46 * scale, top + 32 * scale, 34 * scale, Math.PI + 1.85, Math.PI + 2.4)
    context.fill()
  }

  if (decorations.includes('bunting')) {
    const y = -58 * scale
    const colors = ['#ff5b5b', '#ffd23d', '#4fb7ff', '#7ddc4e', '#ff7ac2']
    context.strokeStyle = 'rgba(90, 56, 18, 0.7)'
    context.lineWidth = 2 * scale
    context.beginPath()
    context.moveTo(-62 * scale, y)
    context.quadraticCurveTo(0, y + 12 * scale, 62 * scale, y)
    context.stroke()
    colors.forEach((color, index) => {
      const t = index / (colors.length - 1)
      const x = -62 * scale + t * 124 * scale
      const sag = 12 * scale * Math.sin(Math.PI * t)
      context.fillStyle = color
      context.beginPath()
      context.moveTo(x - 6 * scale, y + sag)
      context.lineTo(x + 6 * scale, y + sag)
      context.lineTo(x, y + sag + 12 * scale)
      context.closePath()
      context.fill()
    })
  }

  if (decorations.includes('sign')) {
    const y = 62 * scale
    context.fillStyle = '#ffe57a'
    context.strokeStyle = '#8a4b1f'
    context.lineWidth = 2.5 * scale
    context.beginPath()
    context.roundRect(-30 * scale, y, 60 * scale, 24 * scale, 6 * scale)
    context.fill()
    context.stroke()
    context.fillStyle = '#8a4b1f'
    context.font = `900 ${Math.round(13 * scale)}px Nunito, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('🍋', 0, y + 12 * scale)
  }

  context.restore()
}

function drawBrewRing(context: CanvasRenderingContext2D, state: GameState, scale: number) {
  if (state.brewProgress <= 0) return
  const radius = 30 * scale
  const centerY = state.stand.y - 74 * scale
  context.save()
  context.lineWidth = 8 * scale
  context.lineCap = 'round'
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  context.beginPath()
  context.arc(state.stand.x, centerY, radius, 0, Math.PI * 2)
  context.stroke()
  context.strokeStyle = '#ffb300'
  context.beginPath()
  context.arc(
    state.stand.x,
    centerY,
    radius,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2 * Math.min(1, state.brewProgress),
  )
  context.stroke()
  context.font = `900 ${Math.round(26 * scale)}px Nunito, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('🍋', state.stand.x, centerY)
  context.restore()
}

function drawParticles(context: CanvasRenderingContext2D, fx: RenderFx) {
  fx.particles.forEach((particle) => {
    const life = particle.ttl / particle.maxTtl
    context.save()
    context.globalAlpha = Math.min(1, life * 1.6)
    context.fillStyle = particle.color
    context.translate(particle.x, particle.y)
    if (particle.shape === 'leaf') {
      context.rotate(particle.spin)
      context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2)
    } else if (particle.shape === 'star') {
      context.rotate(particle.spin)
      drawStar(context, particle.size)
    } else {
      context.beginPath()
      context.arc(0, 0, particle.size / 2, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  })
}

function drawStar(context: CanvasRenderingContext2D, size: number) {
  const outer = size / 2
  const inner = outer * 0.45
  context.beginPath()
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner
    const angle = (Math.PI * index) / 5 - Math.PI / 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fill()
}

function drawFloaters(context: CanvasRenderingContext2D, fx: RenderFx, scale: number) {
  fx.floaters.forEach((floater) => {
    const life = floater.ttl / floater.maxTtl
    context.save()
    context.globalAlpha = Math.min(1, life * 2)
    context.font = `900 ${Math.round(floater.size * scale)}px Nunito, ui-rounded, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineWidth = 4 * scale
    context.strokeStyle = 'rgba(255, 252, 232, 0.9)'
    context.strokeText(floater.text, floater.x, floater.y)
    context.fillStyle = floater.color
    context.fillText(floater.text, floater.x, floater.y)
    context.restore()
  })
}

function burstParticles(
  fx: RenderFx,
  x: number,
  y: number,
  count: number,
  color: string,
  shape: Particle['shape'],
) {
  for (let index = 0; index < count; index += 1) {
    if (fx.particles.length >= MAX_PARTICLES) return
    const angle = Math.random() * Math.PI * 2
    const speed = 60 + Math.random() * 160
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 90,
      ttl: 0.5 + Math.random() * 0.4,
      maxTtl: 0.9,
      size: 5 + Math.random() * 7,
      color,
      shape,
      spin: Math.random() * Math.PI * 2,
    })
  }
}

function addFloater(fx: RenderFx, x: number, y: number, text: string, color: string, size = 20) {
  fx.floaters.push({ x, y: y - 16, ttl: 0.8, maxTtl: 0.8, text, color, size })
}

function addDecal(fx: RenderFx, x: number, y: number, size: number) {
  if (fx.decals.length >= MAX_DECALS) fx.decals.shift()
  fx.decals.push({ x, y, ttl: 4, maxTtl: 4, size })
}

function shake(fx: RenderFx, magnitude: number, duration: number) {
  fx.shakeMag = Math.max(fx.shakeMag * (fx.shakeTime / fx.shakeDuration), magnitude)
  fx.shakeTime = Math.max(fx.shakeTime, duration)
  fx.shakeDuration = fx.shakeTime
}

function easeOutBack(t: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function drawSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  flip = false,
) {
  context.save()
  if (flip) {
    context.translate(x, y)
    context.scale(-1, 1)
    context.drawImage(image, -width / 2, -height / 2, width, height)
  } else {
    context.drawImage(image, x - width / 2, y - height / 2, width, height)
  }
  context.restore()
}
