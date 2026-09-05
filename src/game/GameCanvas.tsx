import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { assetPaths } from './assets'
import {
  createGame,
  drainEvents,
  finishRound,
  preFreeCritters,
  serveCup,
  stayInChapter,
  swingHammer,
  takeSnapshot,
  updateGame,
} from './engine'
import { useKeyboardInput } from './input'
import { saveCheckpoint, restoreCheckpoint } from './checkpoint'
import { getGuidance, type Guidance } from './guidance'
import {
  nearbyResident,
  residentFor,
  placeNote,
  type Resident,
} from './residents'
import { rememberResident } from '../lib/journal'
import { ResidentPortrait } from '../ui/ResidentPortrait'
import { TREE_HEALTH } from './constants'
import type { GameInput, GameSnapshot, GameState, RoundMinutes } from './types'
import { CHAPTERS, nextChapter, type Chapter } from './campaign'
import { GameHud, StartOverlay, EndOverlay } from './ArcadeOverlays'
import { StoryHud, ChapterOverlay } from './StoryOverlays'
import { ValleyRenderer } from '../render/Renderer'
import {
  readBestScores,
  readJourney,
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
  mode: 'arcade',
  chapterId: null,
  objectives: [],
  objectiveFraction: 0,
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
    cupsBrewed: 0,
    sparkleCups: 0,
    crittersFreed: 0,
  },
}

/** World events that get panned and attenuated relative to the camera. */
const SPATIAL_SOUNDS: Partial<
  Record<GameEvent['type'], Parameters<SoundManager['play']>[0]>
> = {
  smash: 'splat',
  whiff: 'whoosh',
  treeBreak: 'crack',
  treeRegrow: 'regrow',
  pickupLemon: 'pickLemon',
  pickupLeaf: 'pickLeaf',
  cupBrewed: 'brew',
  footstep: 'step',
}

/** ...and the ones that belong to the player, not to a place. */
const FLAT_SOUNDS: Partial<
  Record<GameEvent['type'], Parameters<SoundManager['play']>[0]>
> = {
  countdown: 'tick',
}

/** Below this a zest burst is background colour, not an event worth hearing. */
const ZEST_SOUND_RADIUS = 6

/** How far through a tree is, 0 at full health and approaching 1 as it gives. */
function strain(health: number) {
  return 1 - Math.max(0, Math.min(TREE_HEALTH, health)) / TREE_HEALTH
}

/**
 * Haptics for the moments worth feeling. Android fires these; iOS Safari ignores
 * `navigator.vibrate` entirely, which is fine — it's an enhancement, not a cue.
 */
function buzz(pattern: number | number[]) {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.vibrate !== 'function'
  )
    return
  if (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
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
  chapter,
  onChapterComplete,
  onChapterFinished,
}: {
  sound: SoundManager
  muted: boolean
  onToggleMute: () => void
  onExit: () => void
  /** Trinkets bought in the stand's shop — they dress the arcade stand too. */
  decorations?: DecorationId[]
  /** Present in story mode: which place this is, and what it asks for. */
  chapter?: Chapter
  onChapterComplete?: (chapterId: string) => void
  onChapterFinished?: (chapterId: string) => void
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
  const chapterRef = useRef(chapter)
  soundRef.current = sound
  decorationsRef.current = decorations ?? []

  const pausedRef = useRef(false)
  const actionPointerRef = useRef<number | null>(null)
  const chapterFinishedRef = useRef(onChapterFinished)
  chapterFinishedRef.current = onChapterFinished
  const [conversation, setConversation] = useState<{
    resident: Resident
    shared: boolean
  } | null>(null)
  const [neighbour, setNeighbour] = useState<Resident | null>(null)
  const [sharedMoment, setSharedMoment] = useState<Resident | null>(null)
  const [paused, setPaused] = useState(false)
  const [rendererError, setRendererError] = useState(false)
  const [journalAvailable, setJournalAvailable] = useState(true)
  const [saveAvailable, setSaveAvailable] = useState(true)
  const [guidance, setGuidance] = useState<Guidance | null>(null)
  const [ready, setReady] = useState(false)
  const [roundMinutes, setRoundMinutes] = useState<RoundMinutes>(2)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(emptySnapshot)
  const [stick, setStick] = useState({ active: false, x: 0, y: 0 })
  const [bestByRound, setBestByRound] = useState<BestByRound>({})
  const [isNewBest, setIsNewBest] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [quality, setQuality] = useState<QualityChoice>(() => readQuality())
  // Resolved once the world is built, because `?chapter=` can supply it too.
  const [activeChapter, setActiveChapter] = useState<Chapter | undefined>(
    chapter,
  )
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
      const duskParam = params.get('dusk')
      // `?chapter=N` drops straight into a place without playing the journey to
      // it — the only practical way to look at, or screenshot, chapter five.
      const chapterParam = Number(params.get('chapter'))
      const linkedChapter = Number.isFinite(chapterParam)
        ? CHAPTERS[chapterParam - 1]
        : undefined
      const playing = chapterRef.current ?? linkedChapter
      if (playing !== chapterRef.current) setActiveChapter(playing)
      const game = createGame(
        roundMinutesRef.current,
        autoStart || playing ? 'playing' : 'ready',
        20260802,
        playing,
      )
      if (
        playing &&
        !params.has('over') &&
        !params.has('flock') &&
        !params.has('heal')
      ) {
        const restored = restoreCheckpoint(game)
        if (restored) {
          for (const critter of game.critters.filter(
            (c) => c.state !== 'lost',
          )) {
            const resident = residentFor(game.chapterId, critter.id)
            if (resident && !rememberResident(resident.id, true))
              setJournalAvailable(false)
          }
        }
        // Older completion-only saves still open a welcoming restored place.
        if (!restored && readJourney().completed.includes(playing.id)) {
          finishRound(game, 'valleyWoke')
          stayInChapter(game)
          drainEvents(game)
        }
      }
      const flockParam = Number(params.get('flock'))
      if (Number.isFinite(flockParam) && flockParam > 0)
        preFreeCritters(game, flockParam)
      const overParam = params.get('over')
      if (overParam === 'woke' || overParam === 'sunset') {
        finishRound(game, overParam === 'woke' ? 'valleyWoke' : 'sunset')
      }
      gameRef.current = game
      lastPhaseRef.current = game.phase === 'ended' ? 'playing' : game.phase
      try {
        rendererRef.current = new ValleyRenderer(canvas, game, {
          healOverride: healParam === null ? undefined : Number(healParam),
          duskOverride: duskParam === null ? undefined : Number(duskParam),
          floaterLayer: floaterLayerRef.current,
          decorations: decorationsRef.current,
          tier: savedQuality === 'auto' ? undefined : savedQuality,
          // A manual choice is a choice: don't quietly override it.
          adaptive: savedQuality === 'auto',
        })
      } catch (error) {
        console.error('Unable to start the 3D renderer', error)
        setRendererError(true)
        return
      }
      setSnapshot(takeSnapshot(game))
      setReady(true)
      soundRef.current.startScene()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(handle)
      if (gameRef.current) saveCheckpoint(gameRef.current)
      rendererRef.current?.dispose()
      rendererRef.current = null
      soundRef.current.stopScene()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const lost = (event: Event) => {
      event.preventDefault()
      if (gameRef.current) saveCheckpoint(gameRef.current)
      pausedRef.current = true
      actionPointerRef.current = null
      inputRef.current = EMPTY_INPUT
      soundRef.current.stopScene()
      setRendererError(true)
    }
    canvas?.addEventListener('webglcontextlost', lost)
    return () => canvas?.removeEventListener('webglcontextlost', lost)
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
    let lastSaveTime = 0

    const tick = (now: number) => {
      const state = gameRef.current
      const renderer = rendererRef.current
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      if (pausedRef.current || document.hidden) {
        frame = requestAnimationFrame(tick)
        return
      }
      if (state && renderer) {
        if (actionPointerRef.current !== null && state.phase === 'playing') {
          if (!serveCup(state)) swingHammer(state)
        }
        updateGame(state, inputRef.current, dt)

        const events = drainEvents(state)
        if (events.length > 0) {
          renderer.handleEvents(events, state)
          const sound = soundRef.current
          for (const event of events) {
            const flat = FLAT_SOUNDS[event.type]
            if (flat) sound.play(flat)

            const spatial = SPATIAL_SOUNDS[event.type]
            if (spatial && 'x' in event && 'z' in event)
              sound.playAt(spatial, event.x, event.z)

            switch (event.type) {
              case 'zest':
                // Only the big bursts get a voice, or every smash would chime twice.
                if (event.radius >= ZEST_SOUND_RADIUS)
                  sound.playAt('zest', event.x, event.z)
                break
              case 'smash':
                buzz(12)
                break
              case 'treeHit':
                // A trunk that's nearly through rings tighter and louder, so
                // you can hear the next swing is the one that fells it.
                sound.playAt('thunk', event.x, event.z, {
                  pitch: 1 + strain(event.health) * 0.18,
                  gain: 1 + strain(event.health) * 0.2,
                })
                break
              case 'combo':
                // The ping walks up a scale with the streak, so a long run of
                // hits plays a rising phrase instead of the same chime.
                sound.playAt('combo', event.x, event.z, { level: event.level })
                break
              case 'treeBreak':
                buzz([18, 40, 26])
                break
              case 'critterServed': {
                const resident = residentFor(state.chapterId, event.critterId)
                if (resident) {
                  if (!rememberResident(resident.id, true))
                    setJournalAvailable(false)
                  setSharedMoment(resident)
                }
                sound.playAt(
                  event.sparkle ? 'sparkle' : 'ding',
                  event.x,
                  event.z,
                )
                sound.playAt('bleat', event.x, event.z)
                buzz([22, 50, 22, 50, 38])
                break
              }
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
            state.phase === 'playing' && state.mode === 'arcade'
              ? 1 -
                Math.min(
                  1,
                  state.timeLeft / Math.max(1, state.roundMinutes * 60),
                )
              : 0
          sound.updateMix(state.bloomCoverage, urgency, renderer.windStrength)
        }

        if (state.phase === 'ended' && lastPhaseRef.current !== 'ended') {
          // Only a timed round has a time to be best at. A chapter ends in the
          // same `ended` phase but carries the default two-minute setting it
          // never used, so recording it here would overwrite the player's real
          // two-minute Smash best with an untimed journey result and file it on
          // the leaderboard as though it had been raced.
          if (state.chapterId) {
            saveCheckpoint(state)
            chapterFinishedRef.current?.(state.chapterId)
          }
          actionPointerRef.current = null
          let newBest = false
          if (state.mode === 'arcade') {
            const recorded = recordBestRound(
              bestRef.current,
              state.roundMinutes,
              state.inventory.sold,
              state.inventory.score,
            )
            newBest = recorded.isNewBest
            bestRef.current = recorded.best
            setBestByRound(recorded.best)
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
          }
          soundRef.current.play(newBest ? 'cheer' : 'fanfare')
          inputRef.current = EMPTY_INPUT
          joystickActiveRef.current = false
          setStick({ active: false, x: 0, y: 0 })
        }
        lastPhaseRef.current = state.phase

        renderer.frame(state, dt)
        if (now - lastUiTime > 90) {
          setSnapshot(takeSnapshot(state))
          setGuidance(getGuidance(state))
          const nearby = nearbyResident(state)
          setNeighbour(
            nearby ? (residentFor(state.chapterId, nearby.id) ?? null) : null,
          )
          lastUiTime = now
          if (now - lastSaveTime > 5000 && state.mode === 'story') {
            setSaveAvailable(saveCheckpoint(state))
            lastSaveTime = now
          }
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
    if (!game || pausedRef.current || game.phase !== 'playing') return
    if (serveCup(game)) return
    swingHammer(game)
  }, [])

  useKeyboardInput(
    inputRef,
    joystickActiveRef,
    handleAction,
    ready && !paused && snapshot.phase === 'playing',
  )

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

  const releaseJoystick = useCallback(() => {
    joystickPointerRef.current = null
    joystickActiveRef.current = false
    inputRef.current = EMPTY_INPUT
    setStick({ active: false, x: 0, y: 0 })
  }, [])

  const pauseGame = useCallback(() => {
    if (gameRef.current?.phase !== 'playing') return
    if (gameRef.current?.mode === 'story')
      setSaveAvailable(saveCheckpoint(gameRef.current))
    pausedRef.current = true
    setPaused(true)
    releaseJoystick()
    actionPointerRef.current = null
    soundRef.current.stopScene()
  }, [releaseJoystick])
  const resumeGame = useCallback(() => {
    pausedRef.current = false
    setPaused(false)
    setConversation(null)
    soundRef.current.startScene()
  }, [])
  useEffect(() => {
    if (!sharedMoment) return
    const timer = window.setTimeout(() => setSharedMoment(null), 8000)
    return () => window.clearTimeout(timer)
  }, [sharedMoment])
  const talkToNeighbour = () => {
    const state = gameRef.current
    if (!state) return
    const nearby = nearbyResident(state)
    const resident = nearby && residentFor(state.chapterId, nearby.id)
    if (!nearby || !resident) return
    pauseGame()
    const shared = nearby.state !== 'lost'
    if (!rememberResident(resident.id, shared)) setJournalAvailable(false)
    setSharedMoment(null)
    setConversation({ resident, shared })
  }
  const stayHere = () => {
    const state = gameRef.current
    if (!state || !stayInChapter(state)) return
    lastPhaseRef.current = 'playing'
    setSnapshot(takeSnapshot(state))
    setSharedMoment(null)
    setSaveAvailable(saveCheckpoint(state))
    soundRef.current.startScene()
  }
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pauseGame()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        if (pausedRef.current) resumeGame()
        else pauseGame()
      }
    }
    window.addEventListener('blur', pauseGame)
    window.addEventListener('keydown', onEscape)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', pauseGame)
      window.removeEventListener('keydown', onEscape)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pauseGame, resumeGame])

  return (
    <main className="game-shell immersive">
      <section
        className="phone-stage world"
        ref={stageRef}
        aria-label="Lambs & Lemons: The Sour Valley"
      >
        <canvas className="game-canvas" ref={canvasRef} aria-hidden="true" />
        <div
          className="floater-layer"
          ref={floaterLayerRef}
          aria-hidden="true"
        />

        {/* Held back until the world exists — a HUD full of zeros over an empty
            canvas is worse than no HUD. */}
        {ready &&
          (activeChapter ? (
            <StoryHud snapshot={snapshot} chapter={activeChapter} />
          ) : (
            <GameHud snapshot={snapshot} best={bestForRound} />
          ))}

        {!ready && !rendererError && (
          <div className="loading-panel" role="status">
            Growing the valley…
          </div>
        )}
        {rendererError && (
          <div className="game-overlay">
            <div className="end-panel" role="alert">
              <h2>The valley couldn’t open</h2>
              <p>
                Your browser’s 3D graphics are unavailable. Try reopening the
                game in Safari or Chrome.
              </p>
              <button
                className="start-button"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
              <button className="quiet-button" onClick={onExit}>
                Back home
              </button>
            </div>
          </div>
        )}
        {ready && snapshot.phase === 'playing' && (
          <button
            className="pause-control paper-button"
            aria-label="Pause game"
            onClick={pauseGame}
          >
            Ⅱ
          </button>
        )}
        {paused && !conversation && (
          <div className="game-overlay pause-overlay">
            <div
              className="end-panel pause-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pause-title"
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button',
                  ),
                )
                const first = buttons[0],
                  last = buttons[buttons.length - 1]
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault()
                  last?.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault()
                  first?.focus()
                }
              }}
            >
              <span className="pause-lemon" aria-hidden="true">
                🍋
              </span>
              <p className="eyebrow">TAKE A LITTLE BREAK</p>
              <h2 id="pause-title">The valley can wait.</h2>
              <p>
                {activeChapter
                  ? placeNote(activeChapter.id).invitation
                  : 'Your game is paused. Stay a while.'}
              </p>
              <button className="start-button" autoFocus onClick={resumeGame}>
                Keep playing
              </button>
              <button className="paper-button" onClick={onToggleMute}>
                {muted ? 'Turn sound on' : 'Turn sound off'}
              </button>
              <button className="quiet-button" onClick={onExit}>
                {activeChapter ? 'Journal & chapter map' : 'Back home'}
              </button>
              <small>
                {activeChapter
                  ? saveAvailable && journalAvailable
                    ? 'Your journey saves on this device as you play.'
                    : 'Saving is unavailable. Keep this tab open to keep your progress.'
                  : 'Leaving ends this round.'}
              </small>
            </div>
          </div>
        )}
        {conversation && (
          <div className="game-overlay conversation-overlay">
            <div
              className="conversation-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="conversation-name"
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault()
                  event.currentTarget.querySelector('button')?.focus()
                }
              }}
            >
              <ResidentPortrait
                kind={conversation.resident.kind}
                name={conversation.resident.name}
              />
              <p className="eyebrow">{conversation.resident.interest}</p>
              <h2 id="conversation-name">{conversation.resident.name}</h2>
              <p className="conversation-words">
                “
                {conversation.shared
                  ? conversation.resident.thanks
                  : conversation.resident.hello}
                ”
              </p>
              <small>
                {conversation.shared
                  ? '♥ A cup shared. A friend to come back to.'
                  : 'Added to your valley journal.'}
              </small>
              <button className="start-button" autoFocus onClick={resumeGame}>
                See you around
              </button>
            </div>
          </div>
        )}
        {sharedMoment && !paused && snapshot.phase === 'playing' && (
          <div className="shared-moment" role="status">
            <ResidentPortrait
              kind={sharedMoment.kind}
              name={sharedMoment.name}
            />
            <div>
              <strong>{sharedMoment.name} · a cup shared</strong>
              <p>“{sharedMoment.thanks}”</p>
            </div>
          </div>
        )}
        {ready && !paused && snapshot.phase === 'playing' && guidance && (
          <aside className="field-guide" aria-label="Your next step">
            {neighbour && (
              <button
                className="neighbour-talk paper-button"
                onClick={talkToNeighbour}
              >
                Say hello to {neighbour.name} <span aria-hidden="true">↗</span>
              </button>
            )}
            <div className="guide-inventory">
              <span>🍋 {snapshot.lemons + snapshot.juice}</span>
              <span>🥤 {snapshot.cups}/3</span>
              {snapshot.brewing && (
                <span className="brewing-label">Mixing…</span>
              )}
            </div>
            <div className="guide-step">
              <span className="guide-icon" aria-hidden="true">
                {guidance.icon}
              </span>
              <div>
                <strong>
                  {snapshot.canServe
                    ? 'A cup of kindness. Tap Give!'
                    : guidance.title}
                </strong>
                <small>{guidance.detail}</small>
              </div>
              {guidance.angle !== null && (
                <span
                  className="guide-compass"
                  aria-label={`Target about ${guidance.distance} steps away`}
                >
                  <b style={{ transform: `rotate(${guidance.angle}deg)` }}>↑</b>
                  <small>{guidance.distance}</small>
                </span>
              )}
            </div>
          </aside>
        )}

        {ready && snapshot.phase === 'ready' && !activeChapter && (
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

        {snapshot.phase === 'ended' &&
          (activeChapter ? (
            <ChapterOverlay
              snapshot={snapshot}
              chapter={activeChapter}
              next={nextChapter(activeChapter.id)}
              onNext={() => onChapterComplete?.(activeChapter.id)}
              onHome={onExit}
              onStay={stayHere}
            />
          ) : (
            <EndOverlay
              snapshot={snapshot}
              isNewBest={isNewBest}
              leaderboard={leaderboard}
              onPlayAgain={startRound}
              onHome={onExit}
            />
          ))}

        {/* Outside the controls strip: it's a setting, not a game control, and
            the strip is only ~180px tall so anchoring to its top misplaces it. */}
        <button
          className="mute-control"
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        <div
          className={`controls-layer${ready && !paused && snapshot.phase === 'playing' ? '' : ' idle'}`}
          inert={!ready || paused || snapshot.phase !== 'playing'}
          aria-hidden={!ready || paused || snapshot.phase !== 'playing'}
        >
          <div
            className="joystick"
            onPointerDown={(event) => {
              if (joystickPointerRef.current !== null || pausedRef.current)
                return
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
              if (joystickPointerRef.current === event.pointerId)
                updateJoystick(event)
            }}
            onPointerUp={(event) => {
              if (joystickPointerRef.current === event.pointerId)
                releaseJoystick()
            }}
            onPointerCancel={(event) => {
              if (joystickPointerRef.current === event.pointerId)
                releaseJoystick()
            }}
            onLostPointerCapture={releaseJoystick}
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
            aria-label={
              snapshot.canServe
                ? 'Give a cup'
                : activeChapter
                  ? 'Gather'
                  : 'Smash'
            }
            onPointerDown={(event) => {
              event.preventDefault()
              if (actionPointerRef.current !== null) return
              actionPointerRef.current = event.pointerId
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                /* Synthetic touch. */
              }
              handleAction()
            }}
            onPointerUp={(event) => {
              if (actionPointerRef.current === event.pointerId)
                actionPointerRef.current = null
            }}
            onPointerCancel={(event) => {
              if (actionPointerRef.current === event.pointerId)
                actionPointerRef.current = null
            }}
            onLostPointerCapture={(event) => {
              if (actionPointerRef.current === event.pointerId)
                actionPointerRef.current = null
            }}
            onClick={(event) => {
              if (event.detail === 0) handleAction()
            }}
          >
            {snapshot.canServe ? (
              <span className="serve-glyph" aria-hidden="true">
                🥤
              </span>
            ) : (
              <img src={assetPaths.smashButton} alt="" />
            )}
            <span>
              {snapshot.canServe ? 'Give!' : activeChapter ? 'Gather' : 'Smash'}
            </span>
          </button>
        </div>
        {ready && !paused && (
          <p className="keyboard-hint">
            <kbd>W A S D</kbd> or arrows to move <span>·</span> <kbd>Space</kbd>{' '}
            {activeChapter ? 'to gather / give' : 'to smash'} <span>·</span>{' '}
            <kbd>Esc</kbd> to pause
          </p>
        )}
      </section>
    </main>
  )
}
