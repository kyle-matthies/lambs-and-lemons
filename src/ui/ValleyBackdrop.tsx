import { useEffect, useRef, useState } from 'react'
import { createGame, drainEvents, updateGame } from '../game/engine'
import type { GameInput } from '../game/types'
import { ValleyRenderer } from '../render/Renderer'

/**
 * The living valley behind the menu.
 *
 * A real round of the simulation, running in its pre-start state with a scripted
 * input walking Lammy in a slow arc while the camera orbits. It costs the same
 * scene the game builds anyway, and it means the first thing anyone sees is the
 * place they're about to help rather than a flat card.
 *
 * Loaded lazily so the menu paints immediately and three.js arrives behind it —
 * the backdrop fades in once the world is built.
 */
export function ValleyBackdrop({ heal = 0.82 }: { heal?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: ValleyRenderer | null = null
    let frame = 0
    let cancelled = false

    // Build a frame late so the menu's own paint isn't blocked by world gen.
    const bootstrap = requestAnimationFrame(() => {
      if (cancelled) return
      const state = createGame(2, 'ready')

      try {
        renderer = new ValleyRenderer(canvas, state, {
          // The menu is a postcard, not a benchmark. It shows the valley as it
          // could be — the round itself always opens drained and grey.
          healOverride: heal,
          bloomFlooded: true,
          adaptive: false,
        })
      } catch (error) {
        console.warn('Valley backdrop unavailable', error)
        return
      }

      const resize = () => {
        const rect = canvas.getBoundingClientRect()
        renderer?.setSize(rect.width, rect.height)
      }
      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)

      const input: GameInput = { active: true, x: 0, y: 0 }
      let last = performance.now()

      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now

        // A long, lazy circle. Slow enough to read as grazing, not patrolling.
        const angle = now * 0.00016
        input.x = Math.cos(angle) * 0.55
        input.y = Math.sin(angle) * 0.55

        updateGame(state, input, dt)
        const events = drainEvents(state)
        if (events.length > 0) renderer?.handleEvents(events, state)
        renderer?.frame(state, dt, true)
        frame = requestAnimationFrame(tick)
      }

      frame = requestAnimationFrame(tick)
      setVisible(true)

      cleanup = () => {
        observer.disconnect()
        cancelAnimationFrame(frame)
        renderer?.dispose()
        renderer = null
      }
    })

    let cleanup: (() => void) | null = null
    return () => {
      cancelled = true
      cancelAnimationFrame(bootstrap)
      cleanup?.()
    }
  }, [heal])

  return (
    <canvas
      ref={canvasRef}
      className={`valley-backdrop${visible ? ' visible' : ''}`}
      aria-hidden="true"
    />
  )
}
