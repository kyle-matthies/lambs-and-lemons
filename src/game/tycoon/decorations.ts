import type { DecorationId } from '../../lib/storage'

/**
 * Canvas 2D drawing for the stand decorations bought in the tycoon shop.
 *
 * This lives with the tycoon screen because that screen is still a 2D scene; the
 * arcade world renders its decorations as real geometry instead. It moves into the
 * 3D stand when the tycoon mode is rebuilt.
 */
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
