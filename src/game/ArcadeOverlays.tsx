import { assetPaths } from './assets'
import { ROUND_OPTIONS } from './constants'
import type { BestRound, GameSnapshot, RoundMinutes } from './types'
import type { LeaderboardEntry, QualityChoice } from '../lib/storage'
import { GAME_TITLE } from '../config'

export function GameHud({ snapshot, best }: { snapshot: GameSnapshot; best: BestRound }) {
  const friendsTotal = snapshot.stats.crittersFreed + snapshot.lostCritters
  const bloomPercent = Math.round(snapshot.bloomCoverage * 100)

  return (
    <div className="hud">
      <div className="hud-row primary">
        <HudMetric label="Sunset" value={formatTime(snapshot.timeLeft)} />
        <HudMetric
          label="Friends"
          value={`${snapshot.stats.crittersFreed}/${friendsTotal}`}
          detail={`Best ${best.sold}`}
        />
        <HudMetric label="Points" value={`${snapshot.score}`} detail={`Best ${best.score}`} />
      </div>

      {/* How much of the valley has its colour back — the real objective. */}
      <div className="bloom-meter" aria-label={`Valley colour restored: ${bloomPercent} percent`}>
        <div className="bloom-fill" style={{ width: `${Math.min(100, bloomPercent)}%` }} />
        <span className="bloom-label">🌈 {bloomPercent}%</span>
      </div>

      <div className="hud-row inventory">
        <HudMetric image={assetPaths.lemon} label="Lemons" value={`${snapshot.lemons}`} />
        <HudMetric image={assetPaths.splat} label="Juice" value={`${snapshot.juice}`} />
        <HudMetric
          label="Cups"
          value={`${snapshot.cups}`}
          detail={snapshot.sparkleCups > 0 ? `✨ ${snapshot.sparkleCups}` : undefined}
        />
      </div>

      {snapshot.combo > 0 && <div className="combo-badge">x{snapshot.combo} combo!</div>}
      {snapshot.flockSize > 0 && (
        <div className="flock-badge" aria-label={`${snapshot.flockSize} friends following`}>
          🐑 ×{snapshot.flockSize}
        </div>
      )}
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

/**
 * Plain-language guidance on round length. Twelve creatures is a lot of ground
 * to cover, and a minute is genuinely not enough — better to say so than to let
 * a six-year-old pick it and lose.
 */
const ROUND_HINTS: Record<RoundMinutes, string> = {
  1: 'One minute — a mad dash. You probably won\u2019t save everyone!',
  2: 'Two minutes — just right. Keep moving and you\u2019ll make it.',
  3: 'Three minutes — comfy. Time to explore a bit.',
  4: 'Four minutes — plenty of time. Try for sparkle cups!',
  5: 'Five minutes — no rush at all.',
}

const QUALITY_LABELS: Record<QualityChoice, string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const QUALITY_CYCLE: QualityChoice[] = ['auto', 'low', 'medium', 'high']

export function StartOverlay({
  roundMinutes,
  best,
  quality,
  onRoundChange,
  onQualityChange,
  onStart,
  onHome,
}: {
  roundMinutes: RoundMinutes
  best: BestRound
  quality: QualityChoice
  onRoundChange: (minutes: RoundMinutes) => void
  onQualityChange: (choice: QualityChoice) => void
  onStart: () => void
  onHome: () => void
}) {
  return (
    <div className="game-overlay">
      <div className="start-panel">
        <img className="title-sun" src={assetPaths.sun} alt="" />
        <h1>{GAME_TITLE}</h1>
        <p className="start-premise">
          The valley went grey. Find everyone and give them lemonade!
        </p>
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
        <p className="round-hint">{ROUND_HINTS[roundMinutes]}</p>
        <button className="start-button" type="button" onClick={onStart}>
          Go!
        </button>
        <div className="best-strip">
          <span>{roundMinutes} min</span>
          <strong>{best.sold} friends</strong>
          <span>{best.score} points</span>
        </div>
        <div className="start-footer">
          <button className="quiet-button" type="button" onClick={onHome}>
            Home
          </button>
          <button
            className="quiet-button"
            type="button"
            onClick={() =>
              onQualityChange(
                QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(quality) + 1) % QUALITY_CYCLE.length],
              )
            }
          >
            Graphics: {QUALITY_LABELS[quality]}
          </button>
        </div>
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
  const woke = snapshot.outcome === 'valleyWoke'
  const bloomPercent = Math.round(snapshot.bloomCoverage * 100)

  return (
    <div className="game-overlay">
      <div className={`end-panel${woke ? ' triumphant' : ''}`}>
        {woke ? (
          <>
            <h2 className="new-best">THE VALLEY WOKE UP!</h2>
            <p className="end-blurb">Everyone got a cup. The colour is back for good.</p>
          </>
        ) : isNewBest ? (
          <h2 className="new-best">NEW BEST!</h2>
        ) : (
          <>
            <h2>The sun went down</h2>
            <p className="end-blurb">
              {snapshot.lostCritters === 1
                ? 'One friend is still waiting in the grey.'
                : `${snapshot.lostCritters} friends are still waiting in the grey.`}
            </p>
          </>
        )}
        <div className="stat-rows">
          <StatRow icon="💛" label="Friends helped" value={stats.crittersFreed} />
          <StatRow icon="🌈" label="Valley colour" value={bloomPercent} suffix="%" />
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
                <strong>{entry.sold} 💛</strong>
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

function StatRow({
  icon,
  label,
  value,
  suffix,
}: {
  icon: string
  label: string
  value: number
  suffix?: string
}) {
  return (
    <div className="stat-row">
      <span className="stat-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <strong>
        {value}
        {suffix}
      </strong>
    </div>
  )
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}
