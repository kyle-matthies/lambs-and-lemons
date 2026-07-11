import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { assetPaths, loadGameAssets, type GameAssets } from './assets'
import { GameAudio } from './audio'
import { DEFAULT_ROUND_MINUTES, GAME_CONFIG, ROUND_OPTIONS } from './config'
import {
  createGame,
  createRoundResult,
  drainEvents,
  drawGame,
  resizeGame,
  swingHammer,
  takeSnapshot,
  updateGame,
  type GameInput,
  type GameSnapshot,
  type GameState,
  type RoundMinutes,
  type RoundResult,
} from './engine'

const EMPTY_INPUT: GameInput = { active: false, x: 0, y: 0 }
const MUTE_KEY = 'lambs-and-lemons-muted'

const emptySnapshot: GameSnapshot = {
  phase: 'ready',
  roundMinutes: DEFAULT_ROUND_MINUTES,
  timeLeft: DEFAULT_ROUND_MINUTES * 60,
  score: 0,
  cupsSold: 0,
  carriedLemons: 0,
  leaves: 0,
  lemonsSmashed: 0,
  lemonsPickedUp: 0,
  leavesPickedUp: 0,
  treeHits: 0,
  nearStand: false,
  brewing: false,
  brewProgress: 0,
}

export function GameCanvas() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const joystickRef = useRef<HTMLDivElement | null>(null)
  const assetsRef = useRef<GameAssets | null>(null)
  const gameRef = useRef<GameState | null>(null)
  const joystickInputRef = useRef<GameInput>(EMPTY_INPUT)
  const keysRef = useRef<Record<string, boolean>>({})
  const joystickPointerRef = useRef<number | null>(null)
  const lastPhaseRef = useRef(emptySnapshot.phase)
  const audioRef = useRef<GameAudio | null>(null)

  const [assetsReady, setAssetsReady] = useState(false)
  const [roundMinutes, setRoundMinutes] = useState<RoundMinutes>(DEFAULT_ROUND_MINUTES)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(emptySnapshot)
  const [stick, setStick] = useState({ x: 0, y: 0 })
  const [leaderboard, setLeaderboard] = useState<RoundResult[]>([])
  const [muted, setMuted] = useState(() => readMuted())

  const bestForRound = useMemo(
    () => getBestForRound(leaderboard, snapshot.roundMinutes),
    [leaderboard, snapshot.roundMinutes],
  )

  useEffect(() => {
    audioRef.current = new GameAudio(readMuted())
    setLeaderboard(readLeaderboard())
  }, [])

  useEffect(() => {
    audioRef.current?.setMuted(muted)
    window.localStorage.setItem(MUTE_KEY, muted ? 'true' : 'false')
  }, [muted])

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
        updateGame(state, getActiveInput(joystickInputRef.current, keysRef.current), dt)
        drainEvents(state).forEach((event) => audioRef.current?.play(event))
        if (state.phase === 'ended' && lastPhaseRef.current !== 'ended') {
          const result = createRoundResult(state)
          const updated = addResult(result)
          setLeaderboard(updated)
          joystickInputRef.current = EMPTY_INPUT
          setStick({ x: 0, y: 0 })
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

  useEffect(() => {
    const active = snapshot.phase === 'playing'
    if (!active) return

    const body = document.body
    const html = document.documentElement
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
      htmlOverscroll: html.style.overscrollBehavior,
    }
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.width = '100%'
    body.style.height = '100%'
    html.style.overscrollBehavior = 'none'

    return () => {
      body.style.overflow = previous.bodyOverflow
      body.style.position = previous.bodyPosition
      body.style.width = previous.bodyWidth
      body.style.height = previous.bodyHeight
      html.style.overscrollBehavior = previous.htmlOverscroll
    }
  }, [snapshot.phase])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      keysRef.current[key] = true
      if (key === ' ') {
        event.preventDefault()
        handleSwing()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      keysRef.current[event.key.toLowerCase()] = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  })

  useEffect(() => {
    const handleMove = (event: globalThis.PointerEvent) => {
      if (joystickPointerRef.current !== event.pointerId) return
      event.preventDefault()
      updateJoystick(event.clientX, event.clientY)
    }
    const handleUp = (event: globalThis.PointerEvent) => {
      if (joystickPointerRef.current !== event.pointerId) return
      releaseJoystick()
    }

    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  const startRound = async () => {
    await audioRef.current?.unlock()
    const stage = stageRef.current
    const rect = stage?.getBoundingClientRect()
    const game = createGame(rect?.width ?? 390, rect?.height ?? 844, roundMinutes, 'playing')
    gameRef.current = game
    lastPhaseRef.current = 'playing'
    joystickInputRef.current = EMPTY_INPUT
    setStick({ x: 0, y: 0 })
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
    joystickInputRef.current = EMPTY_INPUT
    setStick({ x: 0, y: 0 })
    setSnapshot(takeSnapshot(game))
  }

  const handleSwing = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    void audioRef.current?.unlock()
    swingHammer(game)
    drainEvents(game).forEach((event) => audioRef.current?.play(event))
    setSnapshot(takeSnapshot(game))
  }, [])

  const updateJoystick = (clientX: number, clientY: number) => {
    const base = joystickRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const rawX = clientX - centerX
    const rawY = clientY - centerY
    const max = rect.width / 2
    const length = Math.hypot(rawX, rawY)
    const ratio = length > max ? max / length : 1
    const visualX = rawX * ratio
    const visualY = rawY * ratio
    joystickInputRef.current = {
      active: true,
      x: visualX / max,
      y: visualY / max,
    }
    setStick({ x: visualX, y: visualY })
  }

  const releaseJoystick = () => {
    joystickPointerRef.current = null
    joystickInputRef.current = EMPTY_INPUT
    setStick({ x: 0, y: 0 })
  }

  return (
    <main className="game-shell">
      <section className="phone-stage" ref={stageRef} aria-label="Lambs and Lemons game">
        <canvas className="game-canvas" ref={canvasRef} aria-hidden="true" />
        <GameHud
          snapshot={snapshot}
          best={bestForRound}
          muted={muted}
          onToggleMute={() => setMuted((current) => !current)}
        />

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
            ref={joystickRef}
            className="joystick"
            onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
              event.preventDefault()
              joystickPointerRef.current = event.pointerId
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // Some older mobile browsers do not support pointer capture.
              }
              updateJoystick(event.clientX, event.clientY)
            }}
            onContextMenu={(event) => event.preventDefault()}
            role="application"
            aria-label="Move lamb"
          >
            <span
              className="joystick-knob"
              style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }}
            />
          </div>

          <button
            className="smash-control"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              handleSwing()
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <img src={assetPaths.smashButton} alt="" />
            <span>Smash</span>
          </button>
        </div>
      </section>
    </main>
  )
}

function GameHud({
  snapshot,
  best,
  muted,
  onToggleMute,
}: {
  snapshot: GameSnapshot
  best: RoundResult | null
  muted: boolean
  onToggleMute: () => void
}) {
  return (
    <div className="hud">
      <div className="hud-row primary">
        <HudMetric label="Time" value={formatTime(snapshot.timeLeft)} />
        <HudMetric label="Cups" value={`${snapshot.cupsSold}`} detail={`Best ${best?.cupsSold ?? 0}`} />
        <HudMetric label="Points" value={`${snapshot.score}`} detail={`Best ${best?.score ?? 0}`} />
      </div>
      <div className="hud-row inventory">
        <HudMetric image={assetPaths.lemon} label="Carry" value={`${snapshot.carriedLemons}`} />
        <HudMetric image={assetPaths.leaf} label="Leaves" value={`${snapshot.leaves}`} />
        <HudMetric label="Tree" value={`${snapshot.treeHits}`} detail="hits" />
      </div>
      <button className="mute-toggle" type="button" onClick={onToggleMute}>
        {muted ? 'Sound Off' : 'Sound On'}
      </button>
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
  best: RoundResult | null
  onRoundChange: (minutes: RoundMinutes) => void
  onStart: () => void | Promise<void>
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
          Start Smashing
        </button>
        <div className="best-strip">
          <span>{roundMinutes} min</span>
          <strong>{best?.cupsSold ?? 0} cups</strong>
          <span>{best?.score ?? 0} points</span>
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
  best: RoundResult | null
  onPlayAgain: () => void | Promise<void>
  onRounds: () => void
}) {
  return (
    <div className="game-overlay">
      <div className="end-panel">
        <h2>Time's Up</h2>
        <div className="cups-result">
          <img src={assetPaths.stand} alt="" />
          <strong>{snapshot.cupsSold}</strong>
          <span>cups sold</span>
        </div>
        <div className="result-grid">
          <ResultStat label="Points" value={snapshot.score} />
          <ResultStat label="Best cups" value={best?.cupsSold ?? 0} />
          <ResultStat label="Smashed" value={snapshot.lemonsSmashed} />
          <ResultStat label="Picked" value={snapshot.lemonsPickedUp} />
          <ResultStat label="Leaves" value={snapshot.leavesPickedUp} />
          <ResultStat label="Tree hits" value={snapshot.treeHits} />
        </div>
        <button className="start-button" type="button" onClick={onPlayAgain}>
          Play Again
        </button>
        <button className="quiet-button" type="button" onClick={onRounds}>
          Rounds
        </button>
      </div>
    </div>
  )
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getActiveInput(joystick: GameInput, keys: Record<string, boolean>): GameInput {
  let x = 0
  let y = 0
  if (keys.arrowleft || keys.a) x -= 1
  if (keys.arrowright || keys.d) x += 1
  if (keys.arrowup || keys.w) y -= 1
  if (keys.arrowdown || keys.s) y += 1

  if (x !== 0 || y !== 0) {
    const length = Math.hypot(x, y) || 1
    return { active: true, x: x / length, y: y / length }
  }

  return joystick
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function readMuted() {
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'true'
  } catch {
    return false
  }
}

function readLeaderboard(): RoundResult[] {
  try {
    const raw = window.localStorage.getItem(GAME_CONFIG.leaderboardKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RoundResult[]) : []
  } catch {
    return []
  }
}

function addResult(result: RoundResult) {
  const updated = [...readLeaderboard(), result]
    .sort((a, b) => b.cupsSold - a.cupsSold || b.score - a.score)
    .slice(0, GAME_CONFIG.maxLeaderboardEntries)
  try {
    window.localStorage.setItem(GAME_CONFIG.leaderboardKey, JSON.stringify(updated))
  } catch {
    // Private browsing can reject localStorage writes; gameplay should continue.
  }
  return updated
}

function getBestForRound(leaderboard: RoundResult[], roundMinutes: RoundMinutes) {
  return (
    leaderboard
      .filter((result) => result.roundMinutes === roundMinutes)
      .sort((a, b) => b.cupsSold - a.cupsSold || b.score - a.score)[0] ?? null
  )
}
