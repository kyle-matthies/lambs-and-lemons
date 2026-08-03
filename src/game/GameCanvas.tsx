import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { assetPaths } from './assets'
import { createGame, drainEvents, serveCup, swingHammer, takeSnapshot, updateGame } from './engine'
import { useKeyboardInput } from './input'
import type { GameInput, GameSnapshot, GameState, RoundMinutes } from './types'
import { GameHud, StartOverlay, EndOverlay } from './ArcadeOverlays'
import { ValleyRenderer } from '../render/Renderer'
import {
  readBestScores,
  readLeaderboard,
  readQuality,
  recordBestRound,
  recordLeaderboard,
  writeQuality,
  type BestByRound,
  type DecorationId,
  type LeaderboardEntry,
  type QualityChoice,
} from '../lib/storage'
import type { SoundManager } from '../audio/sound'
import type { GameEvent } from './types'

const EMPTY_INPUT: GameInput = { active: false, x: 0, y: 0 }

const emptySnapshot: GameSnapshot = {
  phase: 'ready',
  roundMinutes: 2,
  timeLeft: 120,
  score: 0,
  sold: 0,
  lemons: 0,
  juice: 0,
  leaves: 0,
  cups: 0,
  sparkleCups: 0,
  nearStand: false,
  brewing: false,
  brewProgress: 0,
  combo: 0,
  flockSize: 0,
  lostCritters: 0,
  bloomCoverage: 0,
  canServe: false,
  outcome: null,
  stats: {
    lemonsSmashed: 0,
    treeHits: 0,
    treesBroken: 0,
    lemonsCollected: 0,
    leavesCollected: 0,
    cupsSold: 0,
    sparkleCups: 0,
    crittersFreed: 0,
  },
}

/** World events that get panned and attenuated relative to the camera. */
const SPATIAL_SOUNDS: Partial<Record<GameEvent['type'], Parameters<SoundManager['play']>[0]>> = {
  smash: 'splat',
  whiff: 'boing',
  treeHit: 'thunk',
  treeBreak: 'crack',
  treeRegrow: 'regrow',
  pickupLemon: 'pop',
  pickupLeaf: 'pop',
  cupBrewed: 'brew',
  footstep: 'step',
}

/** ...and the ones that belong to the player, not to a place. */
const FLAT_SOUNDS: Partial<Record<GameEvent['type'], Parameters<SoundManager['play']>[0]>> = {
  countdown: 'tick',
}

/** Below this a zest burst is background colour, not an event worth hearing. */
const ZEST_SOUND_RADIUS = 6

/**
 * Haptics for the moments worth feeling. Android fires these; iOS Safari ignores
 * `navigator.vibrate` entirely, which is fine — it's an enhancement, not a cue.
 */
function buzz(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some browsers throw when the page isn't user-activated yet.
  }
}

export function GameCanvas({
  sound,
  muted,
  onToggleMute,
  onExit,
  decorations,
}: {
  sound: SoundManager
  muted: boolean
  onToggleMute: () => void
  onExit: () => void
  /** Trinkets bought in the stand's shop — they dress the arcade stand too. */
  decorations?: DecorationId[]
}) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const floaterLayerRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<ValleyRenderer | null>(null)
  const gameRef = useRef<GameState | null>(null)
  const inputRef = useRef<GameInput>(EMPTY_INPUT)
  const joystickPointerRef = useRef<number | null>(null)
  const joystickActiveRef = useRef(false)
  const lastPhaseRef = useRef(emptySnapshot.phase)
  const bestRef = useRef<BestByRound>({})
  const soundRef = useRef(sound)
  const roundMinutesRef = useRef<RoundMinutes>(2)
  const listenerRef = useRef({ x: 0, z: 0, forwardX: 0, forwardZ: -1 })
  const decorationsRef = useRef(decorations ?? [])
  soundRef.current = sound
  decorationsRef.current = decorations ?? []

  const [ready, setReady] = useState(false)
  const [roundMinutes, setRoundMinutes] = useState<RoundMinutes>(2)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(emptySnapshot)
  const [stick, setStick] = useState({ active: false, x: 0, y: 0 })
  const [bestByRound, setBestByRound] = useState<BestByRound>({})
  const [isNewBest, setIsNewBest] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [quality, setQuality] = useState<QualityChoice>(() => readQuality())
  roundMinutesRef.current = roundMinutes

  const bestForRound = useMemo(
    () => bestByRound[snapshot.roundMinutes] ?? { sold: 0, score: 0 },
    [bestByRound, snapshot.roundMinutes],
  )

  useEffect(() => {
    const loaded = readBestScores()
    bestRef.current = loaded
    setBestByRound(loaded)
    setLeaderboard(readLeaderboard())
  }, [])

  // Build the valley once. Deferred by a frame so the loading panel actually
  // paints before we spend ~100ms generating terrain, grass and flora.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const handle = requestAnimationFrame(() => {
      if (cancelled) return
      const params = new URLSearchParams(
        typeof window === 'undefined' ? '' : window.location.search,
      )
      const autoStart = params.get('go') === '1'
      const savedQuality = readQuality()
      const healParam = params.get('heal')
      const game = createGame(roundMinutesRef.current, autoStart ? 'playing' : 'ready')
      gameRef.current = game
      lastPhaseRef.current = game.phase
      try {
        rendererRef.current = new ValleyRenderer(canvas, game, {
          healOverride: healParam === null ? undefined : Number(healParam),
          floaterLayer: floaterLayerRef.current,
          decorations: decorationsRef.current,
          tier: savedQuality === 'auto' ? undefined : savedQuality,
          // A manual choice is a choice: don't quietly override it.
          adaptive: savedQuality === 'auto',
        })
      } catch (error) {
        console.error('Unable to start the 3D renderer', error)
        return
      }
      setSnapshot(takeSnapshot(game))
      setReady(true)
      soundRef.current.startScene()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(handle)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  // Keep the drawing buffer matched to the stage element.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const resize = () => {
      const rect = stage.getBoundingClientRect()
      rendererRef.current?.setSize(rect.width, rect.height)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    window.addEventListener('orientationchange', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', resize)
    }
  }, [ready])

  useEffect(() => {
    if (!ready) return

    let frame = 0
    let lastTime = performance.now()
    let lastUiTime = 0

    const tick = (now: number) => {
      const state = gameRef.current
      const renderer = rendererRef.current
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      if (state && renderer) {
        updateGame(state, inputRef.current, dt)

        const events = drainEvents(state)
        if (events.length > 0) {
          renderer.handleEvents(events, state)
          const sound = soundRef.current
          for (const event of events) {
            const flat = FLAT_SOUNDS[event.type]
            if (flat) sound.play(flat)

            const spatial = SPATIAL_SOUNDS[event.type]
            if (spatial && 'x' in event && 'z' in event) sound.playAt(spatial, event.x, event.z)

            switch (event.type) {
              case 'zest':
                // Only the big bursts get a voice, or every smash would chime twice.
                if (event.radius >= ZEST_SOUND_RADIUS) sound.playAt('zest', event.x, event.z)
                break
              case 'smash':
                buzz(12)
                break
              case 'treeBreak':
                buzz([18, 40, 26])
                break
              case 'critterServed':
                sound.playAt(event.sparkle ? 'sparkle' : 'ding', event.x, event.z)
                sound.playAt('bleat', event.x, event.z)
                buzz([22, 50, 22, 50, 38])
                break
              case 'flockJoin':
                sound.playAt('bleat', event.x, event.z)
                sound.play('coin')
                break
              case 'valleyWoke':
                sound.play('fanfare')
                sound.music?.celebrate()
                buzz([40, 70, 40, 70, 120])
                break
              default:
                break
            }
          }
        }

        {
          // Adaptive mix: the score and the ambience follow the same recovery
          // number the lighting does, and the wind you hear is the gust the
          // grass is bending to.
          const sound = soundRef.current
          renderer.readListener(listenerRef.current)
          sound.setListener(
            listenerRef.current.x,
            listenerRef.current.z,
            listenerRef.current.forwardX,
            listenerRef.current.forwardZ,
          )
          const urgency =
            state.phase === 'playing'
              ? 1 - Math.min(1, state.timeLeft / Math.max(1, state.roundMinutes * 60))
              : 0
          sound.updateMix(state.bloomCoverage, urgency, renderer.windStrength)
        }

        if (state.phase === 'ended' && lastPhaseRef.current !== 'ended') {
          const { best, isNewBest: newBest } = recordBestRound(
            bestRef.current,
            state.roundMinutes,
            state.inventory.sold,
            state.inventory.score,
          )
          bestRef.current = best
          setBestByRound(best)
          setIsNewBest(newBest)
          setLeaderboard(
            recordLeaderboard({
              sold: state.inventory.sold,
              score: state.inventory.score,
              minutes: state.roundMinutes,
              sparkleCups: state.stats.sparkleCups,
              at: Date.now(),
            }),
          )
          soundRef.current.play(newBest ? 'cheer' : 'fanfare')
          inputRef.current = EMPTY_INPUT
          joystickActiveRef.current = false
          setStick({ active: false, x: 0, y: 0 })
        }
        lastPhaseRef.current = state.phase

        renderer.frame(state, dt)
        if (now - lastUiTime > 90) {
          setSnapshot(takeSnapshot(state))
          lastUiTime = now
        }
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ready])

  const startRound = () => {
    const game = createGame(roundMinutesRef.current, 'playing')
    gameRef.current = game
    rendererRef.current?.reset(game)
    lastPhaseRef.current = 'playing'
    inputRef.current = EMPTY_INPUT
    joystickActiveRef.current = false
    setIsNewBest(false)
    setStick({ active: false, x: 0, y: 0 })
    setSnapshot(takeSnapshot(game))
    sound.play('tap')
    sound.startScene()
  }

  const handleRoundChange = (minutes: RoundMinutes) => {
    setRoundMinutes(minutes)
    roundMinutesRef.current = minutes
    sound.play('tap')
    const current = gameRef.current
    if (!current || current.phase !== 'ready') return
    current.roundMinutes = minutes
    current.timeLeft = minutes * 60
    current.lastWholeSecond = minutes * 60
    setSnapshot(takeSnapshot(current))
  }

  const handleQualityChange = (choice: QualityChoice) => {
    setQuality(choice)
    writeQuality(choice)
    sound.play('tap')
    // 'auto' re-detects when the next round builds; a fixed tier applies now.
    if (choice !== 'auto') rendererRef.current?.setQualityTier(choice)
  }

  /**
   * One button does both jobs. Standing next to someone who needs a cup, it hands
   * the cup over; the rest of the time it swings the mallet. Two thumbs, one
   * verb — which is all a six-year-old should have to think about.
   */
  const handleAction = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    if (serveCup(game)) return
    swingHammer(game)
  }, [])

  useKeyboardInput(inputRef, joystickActiveRef, handleAction)

  const updateJoystick = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const rect = target.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const rawX = event.clientX - centerX
    const rawY = event.clientY - centerY
    const max = rect.width * 0.32
    const length = Math.hypot(rawX, rawY)
    const ratio = length > max ? max / length : 1
    const visualX = rawX * ratio
    const visualY = rawY * ratio
    const inputLength = Math.max(1, max)
    inputRef.current = {
      active: true,
      x: visualX / inputLength,
      y: visualY / inputLength,
    }
    setStick({ active: true, x: visualX, y: visualY })
  }

  const releaseJoystick = () => {
    joystickPointerRef.current = null
    joystickActiveRef.current = false
    inputRef.current = EMPTY_INPUT
    setStick({ active: false, x: 0, y: 0 })
  }

  return (
    <main className="game-shell immersive">
      <section className="phone-stage world" ref={stageRef} aria-label="Lambs & Lemons: The Sour Valley">
        <canvas className="game-canvas" ref={canvasRef} aria-hidden="true" />
        <div className="floater-layer" ref={floaterLayerRef} aria-hidden="true" />
        <GameHud snapshot={snapshot} best={bestForRound} />

        {!ready && <div className="loading-panel">Growing the valley…</div>}

        {snapshot.phase === 'ready' && (
          <StartOverlay
            roundMinutes={roundMinutes}
            best={bestForRound}
            quality={quality}
            onRoundChange={handleRoundChange}
            onQualityChange={handleQualityChange}
            onStart={startRound}
            onHome={onExit}
          />
        )}

        {snapshot.phase === 'ended' && (
          <EndOverlay
            snapshot={snapshot}
            isNewBest={isNewBest}
            leaderboard={leaderboard}
            onPlayAgain={startRound}
            onHome={onExit}
          />
        )}

        {/* Outside the controls strip: it's a setting, not a game control, and
            the strip is only ~180px tall so anchoring to its top misplaces it. */}
        <button
          className="mute-control"
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        <div className="controls-layer" aria-hidden={snapshot.phase !== 'playing'}>
          <div
            className="joystick"
            onPointerDown={(event) => {
              joystickPointerRef.current = event.pointerId
              joystickActiveRef.current = true
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // Synthetic pointers (tests) can't be captured; movement still works.
              }
              updateJoystick(event)
            }}
            onPointerMove={(event) => {
              if (joystickPointerRef.current === event.pointerId) updateJoystick(event)
            }}
            onPointerUp={releaseJoystick}
            onPointerCancel={releaseJoystick}
            role="application"
            aria-label="Move lamb"
          >
            <span
              className="joystick-knob"
              style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }}
            />
          </div>

          <button
            className={`smash-control${snapshot.canServe ? ' serving' : ''}`}
            type="button"
            aria-label={snapshot.canServe ? 'Give a cup' : 'Smash'}
            onPointerDown={(event) => {
              event.preventDefault()
              handleAction()
            }}
          >
            {snapshot.canServe ? (
              <span className="serve-glyph" aria-hidden="true">
                🥤
              </span>
            ) : (
              <img src={assetPaths.smashButton} alt="" />
            )}
            <span>{snapshot.canServe ? 'Give!' : 'Smash'}</span>
          </button>
        </div>
      </section>
    </main>
  )
}
