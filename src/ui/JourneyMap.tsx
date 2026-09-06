import { NeighbourJournal } from './NeighbourJournal'
import { CHAPTERS } from '../game/campaign'
import type { JourneySave } from '../lib/storage'
import { assetPaths } from '../game/assets'

const PLACES = ['🌼', '🪷', '🍋', '⛰️', '🌅']
export function JourneyMap({
  save,
  onSelect,
  onHome,
}: {
  save: JourneySave
  onSelect: (id: string) => void
  onHome: () => void
}) {
  return (
    <main className="journey-map">
      <header className="map-header">
        <button className="paper-button" onClick={onHome}>
          ← Home
        </button>
        <span>{save.completed.length} of 5 places awake</span>
      </header>
      <div className="map-intro">
        <p className="eyebrow">LAMMY’S LITTLE ADVENTURE</p>
        <h1>
          A little kindness.
          <br />A whole lot of colour.
        </h1>
        <p>Five places. One lamb. A valley full of friends to find.</p>
      </div>
      <ol className="chapter-path" aria-label="Journey chapters">
        {CHAPTERS.map((chapter, index) => {
          const done = save.completed.includes(chapter.id)
          const unlocked =
            index === 0 || save.completed.includes(CHAPTERS[index - 1].id)
          return (
            <li key={chapter.id}>
              <button
                className={`chapter-card${done ? ' complete' : ''}`}
                disabled={!unlocked}
                aria-label={`${chapter.title}${done ? ', complete, visit again' : unlocked ? ', ready to explore' : ', locked'}`}
                onClick={() => onSelect(chapter.id)}
              >
                <span className="chapter-landmark" aria-hidden="true">
                  {PLACES[index]}
                </span>
                <span className="chapter-copy">
                  <small>
                    CHAPTER {index + 1}
                    {done ? ' · COME ON IN' : ''}
                  </small>
                  <strong>{chapter.title}</strong>
                  <span>{chapter.blurb}</span>
                </span>
                <span className="chapter-status" aria-hidden="true">
                  {done ? '✓' : unlocked ? '→' : '🔒'}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <NeighbourJournal completed={save.completed} />
      <footer className="map-footer">
        <img src={assetPaths.lambIdle} alt="Lammy the lamb" />
        <p>
          Take your time. There’s no clock here.
          <br />
          <small>Completed chapters are saved on this device.</small>
        </p>
      </footer>
    </main>
  )
}
