import { assetPaths } from './assets'
import { ROUND_OPTIONS } from './constants'
import type { BestRound, GameSnapshot, RoundMinutes } from './types'
import type { LeaderboardEntry } from '../lib/storage'
import { GAME_TITLE } from '../config'

export function GameHud({ snapshot, best }: { snapshot: GameSnapshot; best: BestRound }) {
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
      {snapshot.combo > 0 && <div className="combo-badge">x{snapshot.combo} combo!</div>}
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

export function StartOverlay({
  roundMinutes,
  best,
  onRoundChange,
  onStart,
  onHome,
}: {
  roundMinutes: RoundMinutes
  best: BestRound
  onRoundChange: (minutes: RoundMinutes) => void
  onStart: () => void
  onHome: () => void
}) {
  return (
    <div className="game-overlay">
      <div className="start-panel">
        <img className="title-sun" src={assetPaths.sun} alt="" />
        <h1>{GAME_TITLE}</h1>
        <div className="round-picker" aria-label="Round length in minutes">
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
          Go!
        </button>
        <div className="best-strip">
          <span>{roundMinutes} min</span>
          <strong>{best.sold} sold</strong>
          <span>{best.score} points</span>
        </div>
        <button className="quiet-button" type="button" onClick={onHome}>
          Home
        </button>
      </div>
    </div>
  )
}

export function EndOverlay({
  snapshot,
  isNewBest,
  leaderboard,
  onPlayAgain,
  onHome,
}: {
  snapshot: GameSnapshot
  isNewBest: boolean
  leaderboard: LeaderboardEntry[]
  onPlayAgain: () => void
  onHome: () => void
}) {
  const stats = snapshot.stats
  return (
    <div className="game-overlay">
      <div className="end-panel">
        {isNewBest ? <h2 className="new-best">NEW BEST!</h2> : <h2>Round over</h2>}
        <div className="stat-rows">
          <StatRow icon="🥤" label="Cups sold" value={stats.cupsSold} />
          {stats.sparkleCups > 0 && (
            <StatRow icon="✨" label="Sparkle cups" value={stats.sparkleCups} />
          )}
          <StatRow icon="🍋" label="Lemons smashed" value={stats.lemonsSmashed} />
          <StatRow icon="🌳" label="Tree whacks" value={stats.treeHits} />
          <StatRow icon="⭐" label="Points" value={snapshot.score} />
        </div>
        {leaderboard.length > 0 && (
          <ol className="leaderboard" aria-label="Best rounds">
            {leaderboard.map((entry, index) => (
              <li key={entry.at}>
                <span className="rank">{index + 1}</span>
                <strong>{entry.sold} 🥤</strong>
                <span>{entry.score} pts</span>
                <span className="mins">{entry.minutes} min</span>
              </li>
            ))}
          </ol>
        )}
        <button className="start-button" type="button" onClick={onPlayAgain}>
          Play again
        </button>
        <button className="quiet-button" type="button" onClick={onHome}>
          Home
        </button>
      </div>
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="stat-row">
      <span className="stat-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}
