import { useEffect, useMemo, useRef, useState } from 'react'
import { GameCanvas } from './game/GameCanvas'
import { TycoonScreen } from './game/tycoon/TycoonScreen'
import { MenuScreen } from './ui/MenuScreen'
import { SoundManager } from './audio/sound'
import {
  readBestScores,
  readMuted,
  readTycoonSave,
  writeMuted,
  writeTycoonSave,
  type TycoonSave,
} from './lib/storage'
import './App.css'

type Screen = 'menu' | 'arcade' | 'tycoon'

function App() {
  const soundRef = useRef<SoundManager | null>(null)
  if (!soundRef.current) soundRef.current = new SoundManager()
  const sound = soundRef.current

  const [screen, setScreen] = useState<Screen>('menu')
  const [muted, setMuted] = useState(() => readMuted())
  const [tycoonSave, setTycoonSave] = useState<TycoonSave>(() => readTycoonSave())

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
    setScreen('menu')
  }

  if (screen === 'arcade') {
    return (
      <GameCanvas
        sound={sound}
        muted={muted}
        onToggleMute={toggleMute}
        onExit={goHome}
        decorations={tycoonSave.decorations}
      />
    )
  }

  if (screen === 'tycoon') {
    return (
      <TycoonScreen
        sound={sound}
        muted={muted}
        onToggleMute={toggleMute}
        onExit={goHome}
        save={tycoonSave}
        onSave={saveTycoon}
      />
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
    />
  )
}

export default App
