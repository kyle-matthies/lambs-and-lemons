import { Suspense, lazy, useState } from 'react'
import { assetPaths } from '../game/assets'
import { GAME_SUBTITLE, GAME_TAGLINE, GAME_TITLE } from '../config'
import { HowToPlay } from './HowToPlay'

// three.js is the bulk of the bundle, so the backdrop arrives after the menu has
// already painted and fades in behind it.
const ValleyBackdrop = lazy(() =>
  import('./ValleyBackdrop').then((module) => ({ default: module.ValleyBackdrop })),
)

export function MenuScreen({
  bestCups,
  purse,
  muted,
  onToggleMute,
  onPlayArcade,
  onPlayTycoon,
}: {
  bestCups: number
  purse: number
  muted: boolean
  onToggleMute: () => void
  onPlayArcade: () => void
  onPlayTycoon: () => void
}) {
  const [showHowTo, setShowHowTo] = useState(false)

  return (
    <main className="game-shell menu-shell">
      <section className="phone-stage menu-stage" aria-label={GAME_TITLE}>
        <Suspense fallback={null}>
          <ValleyBackdrop />
        </Suspense>

        <div className="menu-panel">
          <img className="title-sun menu-sun" src={assetPaths.sun} alt="" />
          <h1 className="menu-title">{GAME_TITLE}</h1>
          <p className="menu-subtitle">{GAME_SUBTITLE}</p>
          <p className="menu-tagline">{GAME_TAGLINE}</p>

          <div className="mode-buttons">
            <button className="mode-button arcade" type="button" onClick={onPlayArcade}>
              <img src={assetPaths.lambSwing} alt="" />
              <strong>Smash!</strong>
              <span>Wake the valley</span>
            </button>
            <button className="mode-button tycoon" type="button" onClick={onPlayTycoon}>
              <img src={assetPaths.stand} alt="" />
              <strong>My Stand</strong>
              <span>Serve + count coins</span>
            </button>
          </div>

          <div className="menu-strip">
            <span>🥤 Best: {bestCups}</span>
            <span>🪙 Coins: {purse}</span>
          </div>

          <div className="menu-actions">
            <button
              className="round-icon-button"
              type="button"
              onClick={() => setShowHowTo(true)}
              aria-label="How to play"
            >
              ?
            </button>
            <button
              className="round-icon-button"
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>

        {showHowTo && <HowToPlay onClose={() => setShowHowTo(false)} />}
      </section>
    </main>
  )
}
