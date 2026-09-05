import type { CritterKind } from '../game/types'

/** Small original paper-cut portraits use the same three silhouettes as the world. */
export function ResidentPortrait({
  kind,
  name,
}: {
  kind: CritterKind
  name: string
}) {
  const wool = kind === 'lamb',
    bunny = kind === 'bunny'
  const coat = wool ? '#f4ead7' : bunny ? '#d9b691' : '#eab5ab'
  return (
    <svg
      className="resident-portrait"
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${name} the ${kind}`}
    >
      <circle
        cx="50"
        cy="50"
        r="48"
        fill={wool ? '#d5dfbf' : bunny ? '#e7d8ae' : '#c9daca'}
      />
      {bunny ? (
        <>
          <ellipse
            cx="35"
            cy="27"
            rx="9"
            ry="23"
            fill={coat}
            transform="rotate(-13 35 27)"
          />
          <ellipse
            cx="65"
            cy="27"
            rx="9"
            ry="23"
            fill={coat}
            transform="rotate(13 65 27)"
          />
          <ellipse cx="35" cy="25" rx="4" ry="15" fill="#efc8ba" />
          <ellipse cx="65" cy="25" rx="4" ry="15" fill="#efc8ba" />
        </>
      ) : (
        <>
          <ellipse
            cx="23"
            cy="44"
            rx="16"
            ry="9"
            fill={coat}
            transform="rotate(25 23 44)"
          />
          <ellipse
            cx="77"
            cy="44"
            rx="16"
            ry="9"
            fill={coat}
            transform="rotate(-25 77 44)"
          />
        </>
      )}
      <ellipse cx="50" cy="65" rx="30" ry="27" fill={coat} />
      {wool && (
        <g fill="#fff7e7">
          {[30, 43, 57, 70].map((x, i) => (
            <circle key={x} cx={x} cy={i === 0 || i === 3 ? 45 : 38} r="12" />
          ))}
        </g>
      )}
      <g fill="#354439">
        <ellipse cx="39" cy="62" rx="2.8" ry="3.8" />
        <ellipse cx="61" cy="62" rx="2.8" ry="3.8" />
      </g>
      {kind === 'piglet' ? (
        <>
          <ellipse cx="50" cy="74" rx="13" ry="9" fill="#d99089" />
          <g fill="#95695b">
            <circle cx="46" cy="74" r="2" />
            <circle cx="54" cy="74" r="2" />
          </g>
        </>
      ) : (
        <>
          <path d="M46 72 Q50 68 54 72 L50 76Z" fill="#95695b" />
          <path
            d="M43 79 Q50 84 57 79"
            fill="none"
            stroke="#95695b"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}
