import { assetPaths } from '../game/assets'

/** A tiny picture comic — readable before you can read. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="game-overlay howto-overlay">
      <div className="start-panel howto-panel">
        <h2>How to play</h2>
        <p className="howto-story">The valley went grey. Lemonade brings the colours back.</p>

        <div className="howto-row">
          <span className="howto-icon">🕹️</span>
          <span className="howto-arrow">→</span>
          <img src={assetPaths.lambIdle} alt="" />
          <strong>MOVE</strong>
        </div>
        <div className="howto-row">
          <span className="howto-icon">🔨</span>
          <span className="howto-arrow">→</span>
          <img src={assetPaths.lemon} alt="" />
          <span className="howto-icon">🌈</span>
          <strong>GATHER</strong>
        </div>
        <div className="howto-row">
          <img src={assetPaths.stand} alt="" />
          <span className="howto-arrow">→</span>
          <span className="howto-icon">🥤</span>
          <strong>BREW</strong>
        </div>
        <div className="howto-row">
          <span className="howto-icon">🥤</span>
          <span className="howto-arrow">→</span>
          <span className="howto-icon">🐰</span>
          <span className="howto-icon">💛</span>
          <strong>GIVE</strong>
        </div>

        <p className="howto-story">Journey: wander, gather fruit, and share a cup. No clock. Arcade: smash and share before sunset!</p>

        <button className="start-button" type="button" onClick={onClose}>
          OK!
        </button>
      </div>
    </div>
  )
}
