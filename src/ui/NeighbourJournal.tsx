import { CHAPTERS } from '../game/campaign'
import { RESIDENTS, placeNote } from '../game/residents'
import { readJournal } from '../lib/journal'
import { ResidentPortrait } from './ResidentPortrait'

export function NeighbourJournal({ completed }: { completed: string[] }) {
  const journal = readJournal()
  const neighbours = RESIDENTS.filter((r) => journal.met.includes(r.id))
  return (
    <section className="neighbour-journal" aria-label="Valley journal">
      <div className="journal-heading">
        <div>
          <p className="eyebrow">THE GOOD BITS, KEPT</p>
          <h2>Your valley journal</h2>
        </div>
        <span>{journal.shared.length} {journal.shared.length === 1 ? 'cup' : 'cups'} shared</span>
      </div>
      <p className="journal-intro">
        People you’ve met. Little things to remember them by.
      </p>
      {completed.length > 0 && (
        <ul className="keepsake-shelf" aria-label="Keepsakes">
          {CHAPTERS.filter((c) => completed.includes(c.id)).map((c) => {
            const note = placeNote(c.id)
            return (
              <li key={c.id}>
                <span aria-hidden="true">{note.icon}</span>
                <strong>{note.gift}</strong>
                <small>{c.title}</small>
              </li>
            )
          })}
        </ul>
      )}
      {neighbours.length === 0 ? (
        <p className="journal-empty">
          There’s room for a first friend. Say hello to a neighbour in the
          meadow, or bring them a cup.
        </p>
      ) : (
        <ul className="resident-cards">
          {neighbours.map((r) => (
            <li key={r.id}>
              <ResidentPortrait kind={r.kind} name={r.name} />
              <div>
                <small>
                  {CHAPTERS.find((c) => c.id === r.chapterId)?.title}
                </small>
                <h3>{r.name}</h3>
                <p className="resident-interest">{r.interest}</p>
              </div>
              <blockquote>
                “{journal.shared.includes(r.id) ? r.thanks : r.hello}”
              </blockquote>
              <span className="friendship-note">
                {journal.shared.includes(r.id)
                  ? '♥ A cup shared'
                  : 'A new acquaintance'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="journal-footnote">
        Your journal and restored places are kept on this device.
      </p>
    </section>
  )
}
