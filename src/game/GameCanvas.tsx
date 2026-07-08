import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { assetPaths, loadGameAssets, type GameAssets } from './assets'
import { createGame, drainEvents, resizeGame, swingHammer, takeSnapshot, updateGame } from './engine'
import { createRenderFx, drawGame, processEvents, updateRenderFx } from './render'
import { useKeyboardInput } from './input'
import type { GameInput, GameSnapshot, GameState, RoundMinutes } from './types'
import { GameHud, StartOverlay, EndOverlay } from './ArcadeOverlays'
import {
  readBestScores,
  readLeaderboard,
  recordBestRound,
  recordLeaderboard,
  type BestByRound,
  type DecorationId,
  type LeaderboardEntry,
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
  nearStand: false,
  brewing: false,
  combo: 0,
  stats: {
    lemonsSmashed: 0,
    treeHits: 0,
    treesBroken: 0,
    lemonsCollected: 0,
    leavesCollected: 0,
    cupsSold: 0,
    sparkleCups: 0,
  },
}

const EVENT_SOUNDS: Partial<Record<GameEvent['type'], Parameters<SoundManager['play']>[0]>> = {
  smash: 'splat',
  whiff: 'boing',
  treeHit: 'thunk',
  treeBreak: 'crack',
  treeRegrow: 'regrow',
  pickupLemon: 'pop',
  pickupLeaf: 'pop',
  countdown: 'tick',
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
  decorations: DecorationId[]
}) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const assetsRef = useRef<GameAssets | null>(null)
  const gameRef = useRef<GameState | null>(null)
  const fxRef = useRef(createRenderFx())
  const inputRef = useRef<GameInput>(EMPTY_INPUT)
  const joystickPointerRef = useRef<number | null>(null)
  const joystickActiveRef = useRef(false)
  const lastPhaseRef = useRef(emptySnapshot.phase)
  const bestRef = useRef<BestByRound>({})
  const soundRef = useRef(sound)
  const decorationsRef = useRef(decorations)
  soundRef.current = sound
  decorationsRef.current = decorations

  const [assetsReady, setAssetsReady] = useState(false)
  const [roundMinutes, setRoundMinutes] = useState<RoundMinutes>(2)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(emptySnapshot)
  const [stick, setStick] = useState({ active: false, x: 0, y: 0 })
  const [bestByRound, setBestByRound] = useState<BestByRound>({})
  const [isNewBest, setIsNewBest] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

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

  useEffect(() => {
    let mounted = true
    loadGameAssets().then((assets) => {
      if (!mounted) return
      assetsRef.current = assets
      setAssetsReady(true)
    })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return

    const resize = () => {
      const rect = stage.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (!gameRef.current) {
        gameRef.current = createGame(rect.width, rect.height, roundMinutes, 'ready')
      } else {
        resizeGame(gameRef.current, rect.width, rect.height)
      }
      setSnapshot(takeSnapshot(gameRef.current))
      const assets = assetsRef.current
      if (assets) drawGame(context, gameRef.current, assets, fxRef.current, decorationsRef.current)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    window.addEventListener('orientationchange', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', resize)
    }
  }, [roundMinutes])

  useEffect(() => {
    if (!assetsReady) return

    let frame = 0
    let lastTime = performance.now()
    let lastUiTime = 0

    const tick = (now: number) => {
      const state = gameRef.current
      const assets = assetsRef.current
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      const dt = Math.min(0.04, (now - lastTime) / 1000)
      lastTime = now

      if (state && assets && context) {
        updateGame(state, inputRef.current, dt)

        const events = drainEvents(state)
        if (events.length > 0) {
          processEvents(fxRef.current, events)
          events.forEach((event) => {
            const sfx = EVENT_SOUNDS[event.type]
            if (sfx) soundRef.current.play(sfx)
            if (event.type === 'cupSold') {
              soundRef.current.play(event.sparkle ? 'sparkle' : 'ding')
            }
          })
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
        updateRenderFx(fxRef.current, dt)
        drawGame(context, state, assets, fxRef.current, decorationsRef.current)
        if (now - lastUiTime > 90) {
          setSnapshot(takeSnapshot(state))
          lastUiTime = now
        }
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [assetsReady])

  const startRound = () => {
    const stage = stageRef.current
    const rect = stage?.getBoundingClientRect()
    const width = rect?.width ?? 390
    const height = rect?.height ?? 844
    const game = createGame(width, height, roundMinutes, 'playing')
    gameRef.current = game
    fxRef.current = createRenderFx()
    lastPhaseRef.current = 'playing'
    inputRef.current = EMPTY_INPUT
    joystickActiveRef.current = false
    setIsNewBest(false)
    setStick({ active: false, x: 0, y: 0 })
    setSnapshot(takeSnapshot(game))
    sound.play('tap')
  }

  const handleRoundChange = (minutes: RoundMinutes) => {
    setRoundMinutes(minutes)
    sound.play('tap')
    const current = gameRef.current
    if (!current || current.phase !== 'ready') return

    const game = createGame(current.width, current.height, minutes, 'ready')
    gameRef.current = game
    setSnapshot(takeSnapshot(game))
  }

  const handleSwing = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    swingHammer(game)
  }, [])

  useKeyboardInput(inputRef, joystickActiveRef, handleSwing)

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
    <main className="game-shell">
      <section className="phone-stage" ref={stageRef} aria-label="Lammy's Lemonade Smash arcade">
        <canvas className="game-canvas" ref={canvasRef} aria-hidden="true" />
        <GameHud snapshot={snapshot} best={bestForRound} />

        {!assetsReady && <div className="loading-panel">Loading</div>}

        {snapshot.phase === 'ready' && (
          <StartOverlay
            roundMinutes={roundMinutes}
            best={bestForRound}
            onRoundChange={handleRoundChange}
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
            className="mute-control"
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          <button
            className="smash-control"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              handleSwing()
            }}
          >
            <img src={assetPaths.smashButton} alt="" />
            <span>Smash</span>
          </button>
        </div>
      </section>
    </main>
  )
}
