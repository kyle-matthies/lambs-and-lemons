import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { assetPaths, loadGameAssets, type GameAssets } from './assets'
import {
  createGame,
  drawGame,
  resizeGame,
  sellLemonade,
  swingHammer,
  takeSnapshot,
  updateGame,
  type BestRound,
  type GameInput,
  type GameSnapshot,
  type GameState,
  type RoundMinutes,
} from './engine'

type BestByRound = Partial<Record<RoundMinutes, BestRound>>

const ROUND_OPTIONS: RoundMinutes[] = [1, 2, 3, 4, 5]
const STORAGE_KEY = 'lambs-and-lemons-best'
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
  canSell: false,
}

export function GameCanvas() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const assetsRef = useRef<GameAssets | null>(null)
  const gameRef = useRef<GameState | null>(null)
  const inputRef = useRef<GameInput>(EMPTY_INPUT)
  const joystickPointerRef = useRef<number | null>(null)
  const lastPhaseRef = useRef(emptySnapshot.phase)
  const bestRef = useRef<BestByRound>({})

  const [assetsReady, setAssetsReady] = useState(false)
  const [roundMinutes, setRoundMinutes] = useState<RoundMinutes>(2)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(emptySnapshot)
  const [stick, setStick] = useState({ active: false, x: 0, y: 0 })
  const [bestByRound, setBestByRound] = useState<BestByRound>({})

  const bestForRound = useMemo(
    () => bestByRound[snapshot.roundMinutes] ?? { sold: 0, score: 0 },
    [bestByRound, snapshot.roundMinutes],
  )

  useEffect(() => {
    const loaded = readBestScores()
    bestRef.current = loaded
    setBestByRound(loaded)
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
      if (assets) drawGame(context, gameRef.current, assets)
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
        if (state.phase === 'ended' && lastPhaseRef.current !== 'ended') {
          const updated = recordBestRound(
            bestRef.current,
            state.roundMinutes,
            state.inventory.sold,
            state.inventory.score,
          )
          bestRef.current = updated
          setBestByRound(updated)
          inputRef.current = EMPTY_INPUT
          setStick({ active: false, x: 0, y: 0 })
        }
        lastPhaseRef.current = state.phase
        drawGame(context, state, assets)
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
    lastPhaseRef.current = 'playing'
    inputRef.current = EMPTY_INPUT
    setStick({ active: false, x: 0, y: 0 })
    setSnapshot(takeSnapshot(game))
  }

  const handleRoundChange = (minutes: RoundMinutes) => {
    setRoundMinutes(minutes)
    const current = gameRef.current
    if (!current || current.phase !== 'ready') return

    const game = createGame(current.width, current.height, minutes, 'ready')
    gameRef.current = game
    setSnapshot(takeSnapshot(game))
  }

  const resetToReady = () => {
    const stage = stageRef.current
    const rect = stage?.getBoundingClientRect()
    const game = createGame(rect?.width ?? 390, rect?.height ?? 844, roundMinutes, 'ready')
    gameRef.current = game
    lastPhaseRef.current = 'ready'
    inputRef.current = EMPTY_INPUT
    setStick({ active: false, x: 0, y: 0 })
    setSnapshot(takeSnapshot(game))
  }

  const handleSwing = () => {
    const game = gameRef.current
    if (!game) return
    swingHammer(game)
    setSnapshot(takeSnapshot(game))
  }

  const handleSell = () => {
    const game = gameRef.current
    if (!game) return
    sellLemonade(game)
    setSnapshot(takeSnapshot(game))
  }

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
    inputRef.current = EMPTY_INPUT
    setStick({ active: false, x: 0, y: 0 })
  }

  return (
    <main className="game-shell">
      <section className="phone-stage" ref={stageRef} aria-label="Lambs and Lemons game">
        <canvas className="game-canvas" ref={canvasRef} aria-hidden="true" />
        <GameHud snapshot={snapshot} best={bestForRound} />

        {!assetsReady && <div className="loading-panel">Loading</div>}

        {snapshot.phase === 'ready' && (
          <StartOverlay
            roundMinutes={roundMinutes}
            best={bestForRound}
            onRoundChange={handleRoundChange}
            onStart={startRound}
          />
        )}

        {snapshot.phase === 'ended' && (
          <EndOverlay
            snapshot={snapshot}
            best={bestForRound}
            onPlayAgain={startRound}
            onRounds={resetToReady}
          />
        )}

        <div className="controls-layer" aria-hidden={snapshot.phase !== 'playing'}>
          <div
            className="joystick"
            onPointerDown={(event) => {
              joystickPointerRef.current = event.pointerId
              event.currentTarget.setPointerCapture(event.pointerId)
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
            className="sell-control"
            type="button"
            disabled={!snapshot.canSell}
            onClick={handleSell}
          >
            Sell
          </button>

          <button className="smash-control" type="button" onClick={handleSwing}>
            <img src={assetPaths.smashButton} alt="" />
            <span>Smash</span>
          </button>
        </div>
      </section>
    </main>
  )
}

function GameHud({ snapshot, best }: { snapshot: GameSnapshot; best: BestRound }) {
  return (
    <div className="hud">
      <div className="hud-row primary">
        <HudMetric label="Time" value={formatTime(snapshot.timeLeft)} />
        <HudMetric label="Sold" value={`${snapshot.sold}`} detail={`Best ${best.sold}`} />
        <HudMetric label="Points" value={`${snapshot.score}`} detail={`Best ${best.score}`} />
      </div>
      <div className="hud-row inventory">
        <HudMetric image={assetPaths.lemon} label="Lemons" value={`${snapshot.lemons}`} />
        <HudMetric image={assetPaths.splat} label="Juice" value={`${snapshot.juice}`} />
        <HudMetric image={assetPaths.leaf} label="Leaves" value={`${snapshot.leaves}`} />
      </div>
    </div>
  )
}

function HudMetric({
  image,
  label,
  value,
  detail,
}: {
  image?: string
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="hud-card">
      {image && <img src={image} alt="" />}
      <span className="hud-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function StartOverlay({
  roundMinutes,
  best,
  onRoundChange,
  onStart,
}: {
  roundMinutes: RoundMinutes
  best: BestRound
  onRoundChange: (minutes: RoundMinutes) => void
  onStart: () => void
}) {
  return (
    <div className="game-overlay">
      <div className="start-panel">
        <img className="title-sun" src={assetPaths.sun} alt="" />
        <h1>Lambs and Lemons</h1>
        <div className="round-picker" aria-label="Round length">
          {ROUND_OPTIONS.map((minutes) => (
            <button
              className={minutes === roundMinutes ? 'selected' : ''}
              key={minutes}
              type="button"
              onClick={() => onRoundChange(minutes)}
            >
              {minutes}
            </button>
          ))}
        </div>
        <button className="start-button" type="button" onClick={onStart}>
          Start
        </button>
        <div className="best-strip">
          <span>{roundMinutes} min</span>
          <strong>{best.sold} sold</strong>
          <span>{best.score} points</span>
        </div>
      </div>
    </div>
  )
}

function EndOverlay({
  snapshot,
  best,
  onPlayAgain,
  onRounds,
}: {
  snapshot: GameSnapshot
  best: BestRound
  onPlayAgain: () => void
  onRounds: () => void
}) {
  return (
    <div className="game-overlay">
      <div className="end-panel">
        <h2>Round over</h2>
        <div className="score-stack">
          <div>
            <span>Sold</span>
            <strong>{snapshot.sold}</strong>
          </div>
          <div>
            <span>Points</span>
            <strong>{snapshot.score}</strong>
          </div>
          <div>
            <span>Best</span>
            <strong>{best.sold}</strong>
          </div>
        </div>
        <button className="start-button" type="button" onClick={onPlayAgain}>
          Play again
        </button>
        <button className="quiet-button" type="button" onClick={onRounds}>
          Rounds
        </button>
      </div>
    </div>
  )
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function readBestScores(): BestByRound {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as BestByRound
  } catch {
    return {}
  }
}

function recordBestRound(
  existing: BestByRound,
  roundMinutes: RoundMinutes,
  sold: number,
  score: number,
) {
  const current = existing[roundMinutes] ?? { sold: 0, score: 0 }
  const shouldReplace = sold > current.sold || (sold === current.sold && score > current.score)
  if (!shouldReplace) return existing

  const updated = {
    ...existing,
    [roundMinutes]: { sold, score },
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}
