import type { Chapter } from './campaign'
import type { GameSnapshot } from './types'

/**
 * The story-mode HUD.
 *
 * Everything the arcade HUD shows about *pressure* is gone — no clock, no score,
 * no personal best. What replaces it is a checklist, because a chapter is a list
 * of things to do rather than a race, and because a list is the one readout a
 * child can parse at a glance: an icon they recognise, a number going up, and a
 * tick when it's finished.
 */
export function StoryHud({ snapshot, chapter }: { snapshot: GameSnapshot; chapter: Chapter }) {
  const bloomPercent = Math.round(snapshot.bloomCoverage * 100)

  return (
    <div className="hud story-hud">
      <div className="chapter-strip">
        <span className="chapter-name">{chapter.title}</span>
      </div>

      <ul className="objective-list" aria-label="What to do here">
        {snapshot.objectives.map((line, index) => (
          <li className={line.done ? 'objective done' : 'objective'} key={index}>
            <span className="objective-icon">{line.icon}</span>
            <span className="objective-label">{line.label}</span>
            <strong className="objective-count">
              {line.done ? '✓' : `${line.have}/${line.need}${line.suffix}`}
            </strong>
          </li>
        ))}
      </ul>

      <div className="bloom-meter" aria-label={`Valley colour restored: ${bloomPercent} percent`}>
        <div className="bloom-fill" style={{ width: `${Math.min(100, bloomPercent)}%` }} />
        <span className="bloom-label">🌈 {bloomPercent}%</span>
      </div>

      {snapshot.phase === 'playing' && snapshot.flockSize > 0 && (
        <div className="flock-badge" aria-label={`${snapshot.flockSize} friends following`}>
          🐑 ×{snapshot.flockSize}
        </div>
      )}
    </div>
  )
}

/**
 * The card at the end of a chapter.
 *
 * Placeholder wording for now — the storybook narration that belongs here lands
 * with the writing pass. What it already does correctly is refuse to talk about
 * winning: nothing was beaten, a place simply has its colour back.
 */
export function ChapterOverlay({
  snapshot,
  chapter,
  next,
  onNext,
  onHome,
}: {
  snapshot: GameSnapshot
  chapter: Chapter
  next?: Chapter
  onNext: () => void
  onHome: () => void
}) {
  const bloomPercent = Math.round(snapshot.bloomCoverage * 100)

  return (
    <div className="game-overlay">
      <div className="end-panel triumphant">
        <h2 className="new-best">{chapter.title.toUpperCase()} IS AWAKE!</h2>
        <p className="end-blurb">
          {next
            ? `Everyone here has had a cup. ${next.blurb}`
            : 'Every corner of the valley has its colour back. You walked the whole way.'}
        </p>

        <div className="stat-rows">
          <StatRow icon="💛" label="Friends helped" value={snapshot.stats.crittersFreed} />
          <StatRow icon="🌈" label="Valley colour" value={bloomPercent} suffix="%" />
          <StatRow icon="🍋" label="Lemons smashed" value={snapshot.stats.lemonsSmashed} />
        </div>

        {next ? (
          <button className="start-button" type="button" onClick={onNext}>
            On to {next.title}
          </button>
        ) : (
          <button className="start-button" type="button" onClick={onHome}>
            The end
          </button>
        )}
        <button className="quiet-button" type="button" onClick={onHome}>
          Back to the map
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
