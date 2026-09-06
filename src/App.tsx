import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import {
  CHAPTERS,
  chapterById,
  nextChapter,
  FIRST_CHAPTER,
} from './game/campaign'
import { SoundManager } from './audio/sound'
import {
  readBestScores,
  readJourney,
  completeChapter,
  readMuted,
  readTycoonSave,
  writeMuted,
  writeTycoonSave,
  type TycoonSave,
} from './lib/storage'
import { JourneyMap } from './ui/JourneyMap'
import './App.css'
import './refinement.css'

// Both play modes pull in three.js, so both load on demand — the menu stays
// interactive on a small download and the renderer arrives behind it.
const GameCanvas = lazy(() =>
  import('./game/GameCanvas').then((module) => ({
    default: module.GameCanvas,
  })),
)
const TycoonScreen = lazy(() =>
  import('./game/tycoon/TycoonScreen').then((module) => ({
    default: module.TycoonScreen,
  })),
)

type Screen = 'menu' | 'arcade' | 'tycoon' | 'story' | 'map'

/**
 * Deep links: `?mode=arcade` or `?mode=stand` opens straight into a mode, and
 * `&go=1` skips the round-setup card. `?chapter=N` opens that chapter of the
 * journey — the only practical way to look at the fifth place without playing
 * the four before it. Handy for sharing, and it lets the tests (and visual
 * iteration) land in the valley without clicking through menus.
 */
function initialScreen(): Screen {
  if (typeof window === 'undefined') return 'menu'
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (params.get('chapter') || mode === 'story' || mode === 'journey')
    return 'story'
  if (mode === 'arcade' || mode === 'smash') return 'arcade'
  if (mode === 'stand' || mode === 'tycoon') return 'tycoon'
  return 'menu'
}

/** Which chapter `?chapter=N` asked for, counting from one. */
function initialChapter(): string {
  if (typeof window === 'undefined') return FIRST_CHAPTER
  const requested = Number(
    new URLSearchParams(window.location.search).get('chapter'),
  )
  return CHAPTERS[requested - 1]?.id ?? readJourney().current
}

function App() {
  const soundRef = useRef<SoundManager | null>(null)
  if (!soundRef.current) soundRef.current = new SoundManager()
  const sound = soundRef.current

  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [journey, setJourney] = useState(readJourney)
  const [chapterId, setChapterId] = useState(initialChapter)
  const [muted, setMuted] = useState(() => readMuted())
  const [tycoonSave, setTycoonSave] = useState<TycoonSave>(() =>
    readTycoonSave(),
  )

  useEffect(() => {
    sound.setMuted(muted)
  }, [sound, muted])

  useEffect(() => {
    const unlock = () => sound.unlock()
    const resume = () => sound.resume()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [sound])

  const bestCups = useMemo(() => {
    if (screen !== 'menu') return 0
    const best = readBestScores()
    return Math.max(0, ...Object.values(best).map((round) => round.sold))
  }, [screen])

  const toggleMute = () => {
    setMuted((current) => {
      const next = !current
      writeMuted(next)
      return next
    })
  }

  const saveTycoon = (save: TycoonSave) => {
    setTycoonSave(save)
    writeTycoonSave(save)
  }

  const goHome = () => {
    sound.play('tap')
    sound.stopScene()
    setScreen('menu')
  }

  if (screen === 'map') {
    return (
      <JourneyMap
        save={journey}
        onHome={goHome}
        onSelect={(id) => {
          setChapterId(id)
          sound.play('tap')
          setScreen('story')
        }}
      />
    )
  }

  if (screen === 'story') {
    return (
      <Suspense fallback={<div className="boot-panel">Setting out…</div>}>
        {/* Keyed on the chapter: moving to the next place has to rebuild the
            world, and the world is built once per mount. */}
        <GameCanvas
          key={chapterId}
          sound={sound}
          muted={muted}
          onToggleMute={toggleMute}
          onExit={() => {
            sound.stopScene()
            setScreen('map')
          }}
          onChapterFinished={(id) =>
            setJourney((current) => completeChapter(current, id))
          }
          decorations={tycoonSave.decorations}
          chapter={chapterById(chapterId)}
          onChapterComplete={(finished) => {
            sound.play('tap')
            const next = nextChapter(finished)
            if (next) setChapterId(next.id)
            else setScreen('map')
          }}
        />
      </Suspense>
    )
  }

  if (screen === 'arcade') {
    return (
      <Suspense
        fallback={<div className="boot-panel">Growing the valley…</div>}
      >
        <GameCanvas
          sound={sound}
          muted={muted}
          onToggleMute={toggleMute}
          onExit={goHome}
          decorations={tycoonSave.decorations}
        />
      </Suspense>
    )
  }

  if (screen === 'tycoon') {
    return (
      <Suspense fallback={<div className="boot-panel">Opening the stand…</div>}>
        <TycoonScreen
          sound={sound}
          muted={muted}
          onToggleMute={toggleMute}
          onExit={goHome}
          save={tycoonSave}
          onSave={saveTycoon}
        />
      </Suspense>
    )
  }

  return (
    <MenuScreen
      bestCups={bestCups}
      purse={tycoonSave.purse}
      muted={muted}
      onToggleMute={toggleMute}
      onPlayArcade={() => {
        sound.play('tap')
        setScreen('arcade')
      }}
      onPlayTycoon={() => {
        sound.play('tap')
        setScreen('tycoon')
      }}
      onPlayStory={() => {
        sound.play('tap')
        setChapterId(journey.current)
        setScreen('story')
      }}
      storyChapter={chapterById(journey.current)?.title ?? 'Set out'}
      completedChapters={journey.completed.length}
      onOpenMap={() => setScreen('map')}
    />
  )
}

export default App
