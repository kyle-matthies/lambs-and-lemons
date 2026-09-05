import type { Chapter } from './campaign'
import { placeNote } from './residents'
import type { GameSnapshot } from './types'

export function StoryHud({
  snapshot,
  chapter,
}: {
  snapshot: GameSnapshot
  chapter: Chapter
}) {
  const bloomPercent = Math.round(snapshot.bloomCoverage * 100)
  const restored = snapshot.outcome === 'valleyWoke'
  return (
    <div className="hud story-hud">
      <div className="chapter-strip">
        <span className="chapter-name">{chapter.title}</span>
      </div>
      {restored ? (
        <p className="at-home-note">A place to come back to.</p>
      ) : (
        <ul className="objective-list" aria-label="What to do here">
          {snapshot.objectives.map((line, index) => (
            <li
              className={line.done ? 'objective done' : 'objective'}
              key={index}
            >
              <span className="objective-icon">{line.icon}</span>
              <span className="objective-label">Share a cup</span>
              <strong className="objective-count">
                {line.done ? '✓' : `${line.have}/${line.need}`}
              </strong>
            </li>
          ))}
        </ul>
      )}
      <div
        className="bloom-meter"
        aria-label={`Valley colour restored: ${bloomPercent} percent`}
      >
        <div
          className="bloom-fill"
          style={{ width: `${Math.min(100, bloomPercent)}%` }}
        />
        <span className="bloom-label">🌈 {bloomPercent}%</span>
      </div>
    </div>
  )
}

export function ChapterOverlay({
  snapshot,
  chapter,
  next,
  onNext,
  onHome,
  onStay,
}: {
  snapshot: GameSnapshot
  chapter: Chapter
  next?: Chapter
  onNext: () => void
  onHome: () => void
  onStay: () => void
}) {
  const note = placeNote(chapter.id)
  return (
    <div className="game-overlay">
      <div
        className="end-panel chapter-ending"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chapter-ending-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
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
        <p className="eyebrow">A GOOD DAY IN THE VALLEY</p>
        <h2 id="chapter-ending-title">{chapter.title} is awake</h2>
        <p className="end-blurb">{note.ending}</p>
        <div className="chapter-keepsake">
          <span aria-hidden="true">{note.icon}</span>
          <div>
            <small>A LITTLE SOMETHING FOR YOUR JOURNAL</small>
            <strong>{note.gift}</strong>
          </div>
        </div>
        <p className="chapter-shared">
          {snapshot.lostCritters === 0
            ? 'Everyone here has had a cup.'
            : `${snapshot.stats.crittersFreed} neighbours have shared a cup. There are more friends to find whenever you like.`}
        </p>
        <button className="start-button" autoFocus onClick={onStay}>
          Stay a little longer
        </button>
        {next && (
          <button className="paper-button" onClick={onNext}>
            On to {next.title} →
          </button>
        )}
        <button className="quiet-button" onClick={onHome}>
          Back to the map
        </button>
      </div>
    </div>
  )
}
