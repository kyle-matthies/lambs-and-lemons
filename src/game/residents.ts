import { CHAPTERS } from './campaign'
import type { Critter, CritterKind, GameState } from './types'

export interface Resident {
  id: string
  chapterId: string
  critterId: number
  kind: CritterKind
  name: string
  interest: string
  hello: string
  thanks: string
}

// IDs come from the fixed chapter and critter ID, never the current position.
// The same neighbour keeps their name when a place is revisited or restored.
const PEOPLE: [string, string, string, string][][] = [
  [
    [
      'Clover',
      'Picnic planner',
      'I brought a blanket. Then I worried it was the wrong blanket. Do you think grass minds?',
      'Oh, that is lovely. The blanket can stay. You can too.',
    ],
    [
      'Pip',
      'Collector of small things',
      'I found a pebble shaped like a lemon. An ordinary lemon would also be nice.',
      'Perfect. I shall put this afternoon in my collection.',
    ],
    [
      'Mabel',
      'Very occasional baker',
      'The recipe said a pinch. I used a hoof. We may need something to drink.',
      'Just the thing. Next time I will invite you before I start baking.',
    ],
  ],
  [
    [
      'Fern',
      'Pond watcher',
      'I came to see the ripples. They are taking their time today.',
      'There they are. Perhaps they were waiting for company.',
    ],
    [
      'Otis',
      'Amateur sailor',
      'My boat is a leaf. My voyage is currently three inches long.',
      'Supplies! At this rate I could make it to the reeds.',
    ],
    [
      'Dot',
      'Cloud spotter',
      'That cloud looks like a spoon. Yesterday it was a perfectly good potato.',
      'Lemonade and a spoon cloud. An unusually well-equipped afternoon.',
    ],
    [
      'Wren',
      'Quiet tune maker',
      'I have half a song. The frogs keep offering the other half.',
      'There it is. Would you mind if I named the tune after today?',
    ],
    [
      'Nell',
      'Reed basket maker',
      'The trick is to let the reeds bend. I am still learning the letting part.',
      'Thank you. A pause was exactly what this basket needed.',
    ],
    [
      'Bram',
      'Keeper of pond paths',
      'The long way round has the best view. Also the only view of my favourite stone.',
      'I will show you the stone sometime. It is not impressive. That is rather the point.',
    ],
  ],
  [
    [
      'Hazel',
      'Orchard keeper',
      'These trees were planted before I was born. A little shake is all they need.',
      'Good fruit, good company. That is most of orchard keeping.',
    ],
    [
      'Fig',
      'Recipe tinkerer',
      'I am testing whether a lemon can be too lemony. No conclusion yet.',
      'An excellent contribution to the research. I may need a biscuit.',
    ],
    [
      'Bea',
      'Bee enthusiast',
      'I know every bee here. Well, I know three. The rest are very busy.',
      'The bees approve. I am fairly sure that was an approving buzz.',
    ],
    [
      'Alfie',
      'Ladder borrower',
      'I borrowed a ladder to reach a lemon. Then a lemon fell next to the ladder.',
      'Much easier. I should probably return that ladder.',
    ],
    [
      'Juniper',
      'Pressed leaf collector',
      'Every leaf is a little different. It makes choosing one quite difficult.',
      'This one can mark the day we met. The leaf, I mean. Not the cup.',
    ],
    [
      'Pearl',
      'Jar label writer',
      'I make labels before I make jam. It helps me feel organised for a moment.',
      'I have a label for this: a very good afternoon.',
    ],
    [
      'Moss',
      'Shade appreciator',
      'This tree has excellent shade. I have tried several trees to be certain.',
      'Now it has refreshments. The other trees have some catching up to do.',
    ],
  ],
  [
    [
      'Tansy',
      'Hill gardener',
      'Everyone says nothing grows here. Nobody has asked the little flowers.',
      'They are coming back. I knew they had not gone far.',
    ],
    [
      'Archie',
      'Kite mender',
      'The wind and I disagree about which direction my kite should go.',
      'We have agreed to take a break. A rare diplomatic success.',
    ],
    [
      'Dulcie',
      'Pocket poet',
      'I found a rhyme for hill. Unfortunately, so did everyone else.',
      'A cup, a hill, a moment still. That will do for today.',
    ],
    [
      'Basil',
      'Stone stacker',
      'This tower is nearly finished. I have said that about the last six stones.',
      'I shall leave it there. Some things are better with room on top.',
    ],
    [
      'Effie',
      'Weather note taker',
      'My forecast is mostly sky, with a chance of more sky later.',
      'Update: a warm spell, arriving in a small cup.',
    ],
    [
      'Rue',
      'Tiny flower finder',
      'Look closely by the rocks. The smallest flowers always get the nicest corners.',
      'There. A little yellow one. It is very pleased you came.',
    ],
    [
      'Sid',
      'Long walk enthusiast',
      'I meant to take a short walk. Then the path kept being interesting.',
      'A good place to stop. There will be more path tomorrow.',
    ],
  ],
  [
    [
      'Marigold',
      'Gathering organiser',
      'I invited everyone. I am trying very hard not to count the chairs.',
      'There is room. Somehow there is always room.',
    ],
    [
      'Wally',
      'Lantern lighter',
      'You have to light the lanterns before you need them. That is the whole job.',
      'There we go. Just in time for the good light.',
    ],
    [
      'Flora',
      'Table flower arranger',
      'I wanted something informal. I have rearranged it eleven times.',
      'Twelve was the right number. Or perhaps it was the lemonade.',
    ],
    [
      'Jasper',
      'Story collector',
      'Everyone arrives with a story. Mine is mostly about getting slightly lost.',
      'This is a much better ending than the one with the muddy sock.',
    ],
    [
      'Polly',
      'Humming harmoniser',
      'I hum along when I do not know the words. Which is often the best part.',
      'That tastes like the chorus. Shall we join in?',
    ],
    [
      'Milo',
      'Biscuit custodian',
      'I was asked to look after the biscuits. It is a weighty responsibility.',
      'I have saved you one. That was the difficult part.',
    ],
    [
      'Ivy',
      'Garland maker',
      'The garland is a little crooked. So are most of my favourite things.',
      'Leave it like that. It looks like us.',
    ],
    [
      'Percy',
      'Sunset sketcher',
      'The sky keeps changing before I finish. I suspect it is doing it on purpose.',
      'I will put the pencil down for this bit.',
    ],
    [
      'Clementine',
      'Spare chair keeper',
      'I always bring an extra chair. Someone usually needs one.',
      'That chair is yours, if you would like it.',
    ],
    [
      'Robin',
      'Evening walker',
      'This is my favourite hour. It never seems to stay for a whole hour.',
      'Perhaps we can make it last a little longer.',
    ],
    [
      'Bertie',
      'Lantern repairer',
      'A little bent, still perfectly bright. That is how I like my lanterns.',
      'And now they have something worth lighting.',
    ],
    [
      'Opal',
      'Rememberer of good days',
      'I try to remember the small bits. The way everyone settles in, for instance.',
      'Yes. This is one of the days I will keep.',
    ],
  ],
]
const KINDS: CritterKind[] = ['lamb', 'bunny', 'piglet']
export const RESIDENTS: Resident[] = CHAPTERS.flatMap((chapter, index) =>
  PEOPLE[index].map(([name, interest, hello, thanks], i) => ({
    id: `${chapter.id}:${i + 1}`,
    chapterId: chapter.id,
    critterId: i + 1,
    kind: KINDS[i % KINDS.length],
    name,
    interest,
    hello,
    thanks,
  })),
)
export function residentFor(chapterId: string | null, critterId: number) {
  return RESIDENTS.find(
    (r) => r.chapterId === chapterId && r.critterId === critterId,
  )
}
export function nearbyResident(state: GameState): Critter | undefined {
  if (state.mode !== 'story') return undefined
  return state.critters
    .filter((c) => Math.hypot(c.x - state.player.x, c.z - state.player.z) < 3.5)
    .sort(
      (a, b) =>
        Math.hypot(a.x - state.player.x, a.z - state.player.z) -
        Math.hypot(b.x - state.player.x, b.z - state.player.z),
    )[0]
}

export const PLACE_NOTES = [
  {
    icon: '🌼',
    gift: 'Clover’s picnic flower',
    invitation:
      'Clover has put a blanket out. Bring a little lemonade for the neighbours.',
    ending:
      'Clover smooths out the blanket. Pip sets down a particularly good pebble. Mabel promises to bring biscuits next time. It already feels like home.',
  },
  {
    icon: '🪷',
    gift: 'Fern’s pond sketch',
    invitation:
      'Take the path around the water. Fern and the pond neighbours would welcome some company.',
    ending:
      'The reeds rustle, the leaf boat sets sail, and Wren finally finds the rest of the tune. Nobody is in a hurry to go anywhere.',
  },
  {
    icon: '🍋',
    gift: 'Hazel’s handwritten recipe',
    invitation:
      'Hazel is sharing the harvest. Gather fallen fruit or gently shake the trees, then put the kettle of lemonade to use.',
    ending:
      'Hazel writes the recipe on the back of an old label. “The secret,” she says, “is having someone to share it with.”',
  },
  {
    icon: '🌱',
    gift: 'Tansy’s pressed wildflower',
    invitation:
      'Tansy knows where the tiny flowers grow. Bring lemonade to five neighbours along the hill paths.',
    ending:
      'Between the stones, a little yellow flower opens. Tansy had kept a space for it all along. She presses one for your journal.',
  },
  {
    icon: '🏮',
    gift: 'Opal’s evening postcard',
    invitation:
      'There is a seat for everyone tonight. Find the neighbours and bring a cup to each of them.',
    ending:
      'The lanterns are lit. Someone moves a chair to make room. Opal writes the date on a postcard, then puts her pencil away. The rest of the evening is for being here.',
  },
]
export function placeNote(chapterId: string) {
  return (
    PLACE_NOTES[CHAPTERS.findIndex((c) => c.id === chapterId)] ?? PLACE_NOTES[0]
  )
}
