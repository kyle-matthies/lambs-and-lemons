/**
 * The sound library.
 *
 * Every entry is an *instrument*, not a beep: layers stacked from `dsp.ts` that
 * together describe a physical event. The impacts follow the same recipe every
 * time —
 *
 *   transient  the moment of contact, 10 ms of bright noise
 *   body       what was hit, and what it's made of
 *   sub        how heavy it was; felt more than heard
 *   texture    what came off it — pulp, splinters, leaves
 *   tail       where you were standing when it happened
 *
 * — because that's what separates a satisfying smash from a click. The layers
 * are randomised per hit, so smashing a hundred lemons never machine-guns the
 * same waveform back at you.
 */

import {
  creak,
  fmBell,
  grainBurst,
  modalLayer,
  noiseLayer,
  swoosh,
  toneLayer,
  type Voice,
} from './dsp'

export type SfxName =
  | 'whoosh'
  | 'splat'
  | 'thunk'
  | 'crack'
  | 'pop'
  | 'pickLemon'
  | 'pickLeaf'
  | 'ding'
  | 'sparkle'
  | 'coin'
  | 'cheer'
  | 'uhOh'
  | 'tick'
  | 'tap'
  | 'fanfare'
  | 'regrow'
  | 'zest'
  | 'bleat'
  | 'step'
  | 'brew'
  | 'combo'

/** Small symmetric jitter around 1, for per-hit variation. */
function vary(spread: number) {
  return 1 + (Math.random() * 2 - 1) * spread
}

/**
 * A lemon giving up. Rind splits, pulp sprays, juice hits the grass.
 *
 * The wet character comes from the pulp layer's bandpass falling an octave and a
 * half inside 80 ms — a filter sweeping *down* fast is the whole trick behind
 * anything that sounds soft and full of liquid.
 */
function splat(voice: Voice) {
  noiseLayer(voice, {
    level: 0.3,
    attack: 0.001,
    decay: 0.014,
    filter: 'highpass',
    hz: 2400 * vary(0.12),
    q: 0.7,
  })
  noiseLayer(voice, {
    level: 0.34,
    decay: 0.085 * vary(0.15),
    filter: 'bandpass',
    hz: 1650 * vary(0.14),
    hzTo: 380,
    q: 1.2,
    reverb: 0.1,
  })
  // The squelch: a narrow resonance dragged down behind the burst.
  noiseLayer(voice, {
    at: 0.006,
    level: 0.13,
    decay: 0.1,
    filter: 'bandpass',
    hz: 720 * vary(0.12),
    hzTo: 250,
    q: 7,
  })
  toneLayer(voice, {
    type: 'triangle',
    from: 300 * vary(0.1),
    to: 88,
    glide: 0.06,
    level: 0.26,
    decay: 0.11,
    drive: 2.2,
    lowpass: 900,
  })
  toneLayer(voice, {
    from: 132 * vary(0.08),
    to: 52,
    level: 0.3,
    decay: 0.15,
    pitchAmount: 0.35,
  })
  // Droplets landing.
  grainBurst(voice, {
    at: 0.012,
    count: 5,
    spread: 0.13,
    hz: 3600,
    hzSpread: 1.8,
    q: 4,
    level: 0.055,
    decay: 0.02,
    reverb: 0.12,
  })
}

/**
 * Hammer into a trunk. Bark scuffs, the wood knocks, the canopy shivers.
 *
 * The body is modal — sines at 1 : 2.57 : 4.32 : 6.1, ratios that don't line up
 * into a chord. That inharmonicity is the difference between "wood" and "note".
 */
function thunk(voice: Voice) {
  noiseLayer(voice, {
    level: 0.32,
    attack: 0.001,
    decay: 0.009,
    filter: 'highpass',
    hz: 3200 * vary(0.15),
    q: 0.7,
  })
  modalLayer(voice, {
    base: 168 * vary(0.09),
    partials: [
      [1, 1, 0.16],
      [2.57, 0.55, 0.085],
      [4.32, 0.3, 0.045],
      [6.1, 0.16, 0.03],
    ],
    level: 0.2,
    reverb: 0.12,
  })
  // The hollow of the trunk.
  noiseLayer(voice, {
    level: 0.16,
    decay: 0.11,
    filter: 'bandpass',
    hz: 380 * vary(0.12),
    q: 5.5,
  })
  toneLayer(voice, {
    from: 96 * vary(0.07),
    to: 46,
    level: 0.28,
    decay: 0.17,
    drive: 1.6,
    pitchAmount: 0.3,
  })
  // Bark coming off.
  grainBurst(voice, {
    count: 3,
    spread: 0.05,
    hz: 1500,
    hzSpread: 1.6,
    level: 0.07,
    decay: 0.02,
  })
  // Leaves, a beat later — the shock has to travel up the trunk.
  noiseLayer(voice, {
    at: 0.045,
    level: 0.055,
    attack: 0.02,
    decay: 0.3,
    filter: 'highpass',
    hz: 3800,
    rate: vary(0.2),
    reverb: 0.16,
    echo: 0.04,
  })
}

/**
 * A tree coming down — the biggest sound in the game, and the only one written
 * as a sequence rather than a stack.
 *
 * 0.00  the break: transient, splinters, a groan of tearing fibre, sub drop
 * 0.30  the fall: the canopy dragging through the air
 * 0.62  the landing: earth thud, debris scattering, leaves settling
 *
 * It's the only effect with a real echo send, so it reads as happening *in the
 * valley* rather than next to your ear.
 */
function crack(voice: Voice) {
  // — the break —
  noiseLayer(voice, {
    level: 0.4,
    attack: 0.001,
    decay: 0.02,
    filter: 'highpass',
    hz: 2600,
    q: 0.7,
  })
  modalLayer(voice, {
    base: 150 * vary(0.08),
    partials: [
      [1, 1, 0.22],
      [2.41, 0.6, 0.12],
      [4.06, 0.34, 0.06],
    ],
    level: 0.22,
    reverb: 0.24,
    echo: 0.12,
  })
  // Fibres tearing: sharp splinters over a third of a second.
  grainBurst(voice, {
    count: 9,
    spread: 0.34,
    hz: 2200,
    hzSpread: 2.1,
    hzDrift: 0.45,
    q: 9,
    level: 0.15,
    decay: 0.035,
    fade: 0.45,
    reverb: 0.2,
    echo: 0.1,
  })
  creak(voice, {
    at: 0.01,
    from: 330 * vary(0.1),
    to: 105,
    duration: 0.46,
    level: 0.11,
    formant: 620,
    q: 11,
    wobble: 7,
    wobbleHz: 8,
    reverb: 0.22,
  })
  toneLayer(voice, {
    at: 0.015,
    from: 112,
    to: 33,
    glide: 0.3,
    level: 0.46,
    decay: 0.7,
    drive: 1.8,
    pitchAmount: 0.2,
    reverb: 0.1,
  })

  // — the fall —
  swoosh(voice, {
    at: 0.3,
    level: 0.16,
    duration: 0.42,
    from: 420,
    peak: 1500,
    to: 320,
    q: 1.1,
    reverb: 0.2,
  })

  // — the landing —
  noiseLayer(voice, {
    at: 0.62,
    level: 0.3,
    attack: 0.003,
    decay: 0.34,
    filter: 'lowpass',
    hz: 170,
    q: 1.1,
    pitchAmount: 0.2,
    reverb: 0.26,
    echo: 0.16,
  })
  toneLayer(voice, {
    at: 0.62,
    from: 74,
    to: 34,
    level: 0.34,
    decay: 0.4,
    drive: 1.5,
    pitchAmount: 0.2,
  })
  grainBurst(voice, {
    at: 0.64,
    count: 11,
    spread: 0.5,
    hz: 1700,
    hzSpread: 2.4,
    hzDrift: 0.7,
    q: 6,
    level: 0.075,
    decay: 0.03,
    fade: 0.25,
    reverb: 0.24,
  })
  // Leaves taking their time to settle.
  noiseLayer(voice, {
    at: 0.64,
    level: 0.1,
    attack: 0.05,
    decay: 0.85,
    filter: 'highpass',
    hz: 3200,
    rate: vary(0.15),
    reverb: 0.3,
    echo: 0.08,
  })
}

/** A miss: hammer through empty air. Quiet — whiffing shouldn't be rewarded. */
function whoosh(voice: Voice) {
  // Bandpassed noise reads much quieter than its peak suggests, so these levels
  // sit higher than an impact's would for the same loudness.
  swoosh(voice, {
    level: 0.34,
    duration: 0.24,
    from: 700,
    peak: 2400 * vary(0.12),
    to: 600,
    q: 1.5,
  })
  noiseLayer(voice, {
    level: 0.11,
    attack: 0.05,
    decay: 0.13,
    filter: 'lowpass',
    hz: 320,
    q: 0.8,
  })
  toneLayer(voice, {
    type: 'triangle',
    from: 210,
    to: 148,
    level: 0.07,
    decay: 0.13,
  })
}

/** Picking a lemon out of the grass: round, small, satisfying. */
function pickLemon(voice: Voice) {
  noiseLayer(voice, {
    level: 0.07,
    attack: 0.001,
    decay: 0.018,
    filter: 'highpass',
    hz: 2200,
  })
  toneLayer(voice, {
    from: 380 * vary(0.08),
    to: 880,
    glide: 0.05,
    level: 0.14,
    decay: 0.09,
  })
  fmBell(voice, {
    at: 0.02,
    carrier: 1100 * vary(0.06),
    ratio: 2,
    index: 0.6,
    level: 0.055,
    decay: 0.11,
    reverb: 0.14,
  })
}

/** A leaf: barely a sound at all, mostly rustle. */
function pickLeaf(voice: Voice) {
  noiseLayer(voice, {
    level: 0.085,
    attack: 0.004,
    decay: 0.13,
    filter: 'highpass',
    hz: 3200,
    rate: vary(0.25),
    reverb: 0.12,
  })
  toneLayer(voice, {
    from: 620 * vary(0.1),
    to: 1150,
    glide: 0.04,
    level: 0.075,
    decay: 0.06,
  })
}

/** Cork-pop, for the tycoon counter. */
function pop(voice: Voice) {
  noiseLayer(voice, {
    level: 0.12,
    attack: 0.001,
    decay: 0.02,
    filter: 'bandpass',
    hz: 1800 * vary(0.1),
    hzTo: 600,
    q: 2,
  })
  toneLayer(voice, {
    from: 460 * vary(0.08),
    to: 980,
    glide: 0.045,
    level: 0.17,
    decay: 0.075,
  })
}

/** Someone got their lemonade. A clean two-note chime. */
function ding(voice: Voice) {
  fmBell(voice, {
    carrier: 1319,
    ratio: 2.01,
    index: 0.9,
    level: 0.14,
    decay: 0.5,
    reverb: 0.3,
  })
  fmBell(voice, {
    at: 0.02,
    carrier: 1976,
    ratio: 3.02,
    index: 0.6,
    level: 0.07,
    decay: 0.42,
    reverb: 0.3,
  })
}

/** The sparkle cup: same moment, four times the shine. */
function sparkle(voice: Voice) {
  ;[1319, 1568, 2093, 2637].forEach((hz, index) => {
    fmBell(voice, {
      at: index * 0.06,
      carrier: hz,
      ratio: 2.4,
      index: 1.1 - index * 0.15,
      level: 0.11 - index * 0.014,
      decay: 0.4 + index * 0.1,
      reverb: 0.38,
    })
  })
  grainBurst(voice, {
    count: 7,
    spread: 0.3,
    hz: 6200,
    hzSpread: 1.5,
    q: 8,
    level: 0.035,
    decay: 0.05,
    fade: 0.5,
    reverb: 0.4,
  })
}

function coin(voice: Voice) {
  noiseLayer(voice, {
    level: 0.06,
    attack: 0.001,
    decay: 0.012,
    filter: 'highpass',
    hz: 4200,
  })
  fmBell(voice, { carrier: 988, ratio: 3.4, index: 1.2, level: 0.1, decay: 0.1, reverb: 0.16 })
  fmBell(voice, {
    at: 0.075,
    carrier: 1319,
    ratio: 3.4,
    index: 0.9,
    level: 0.1,
    decay: 0.24,
    reverb: 0.22,
  })
}

function cheer(voice: Voice) {
  // A crowd, roughly: a swell of bright noise with no attack of its own.
  noiseLayer(voice, {
    level: 0.11,
    attack: 0.14,
    decay: 0.5,
    filter: 'bandpass',
    hz: 1100,
    hzTo: 2200,
    q: 0.8,
    reverb: 0.34,
  })
  ;[523, 659, 784, 1047].forEach((hz, index) => {
    fmBell(voice, {
      at: index * 0.085,
      carrier: hz,
      ratio: 2.02,
      index: 0.7,
      level: 0.14,
      decay: 0.35,
      reverb: 0.3,
    })
  })
}

function uhOh(voice: Voice) {
  fmBell(voice, { carrier: 392, ratio: 1.41, index: 0.5, level: 0.14, decay: 0.2, reverb: 0.2 })
  fmBell(voice, {
    at: 0.2,
    carrier: 311,
    ratio: 1.41,
    index: 0.6,
    level: 0.14,
    decay: 0.34,
    reverb: 0.24,
  })
}

function tick(voice: Voice) {
  noiseLayer(voice, {
    level: 0.05,
    attack: 0.001,
    decay: 0.01,
    filter: 'bandpass',
    hz: 3200,
    q: 3,
  })
  toneLayer(voice, { type: 'square', from: 880, level: 0.07, decay: 0.045 })
}

function tap(voice: Voice) {
  noiseLayer(voice, {
    level: 0.045,
    attack: 0.001,
    decay: 0.012,
    filter: 'highpass',
    hz: 2600,
  })
  toneLayer(voice, { from: 620, to: 680, level: 0.1, decay: 0.06 })
}

function fanfare(voice: Voice) {
  const notes = [523, 659, 784, 659, 1047]
  notes.forEach((hz, index) => {
    const last = index === notes.length - 1
    fmBell(voice, {
      at: index * 0.13,
      carrier: hz,
      ratio: 2.01,
      index: 0.8,
      level: 0.15,
      decay: last ? 0.7 : 0.2,
      reverb: 0.3,
    })
    // A soft saw underneath gives the line a bit of brass.
    toneLayer(voice, {
      at: index * 0.13,
      type: 'sawtooth',
      from: hz / 2,
      level: 0.05,
      attack: 0.02,
      decay: last ? 0.5 : 0.16,
      lowpass: 1600,
      reverb: 0.2,
    })
  })
}

/** A tree coming back: rising air, a bell, and new leaves. */
function regrow(voice: Voice) {
  toneLayer(voice, {
    from: 320,
    to: 720,
    level: 0.12,
    attack: 0.03,
    decay: 0.24,
    reverb: 0.2,
  })
  noiseLayer(voice, {
    level: 0.09,
    attack: 0.09,
    decay: 0.4,
    filter: 'bandpass',
    hz: 900,
    hzTo: 3600,
    q: 1,
    reverb: 0.24,
  })
  fmBell(voice, {
    at: 0.16,
    carrier: 1046,
    ratio: 2.5,
    index: 0.5,
    level: 0.06,
    decay: 0.5,
    reverb: 0.3,
  })
}

/** Colour rushing back into the grass. */
function zest(voice: Voice) {
  toneLayer(voice, { from: 420, to: 1650, level: 0.13, decay: 0.3, reverb: 0.24 })
  toneLayer(voice, {
    at: 0.02,
    type: 'triangle',
    from: 840,
    to: 2400,
    level: 0.065,
    decay: 0.26,
    reverb: 0.24,
  })
  grainBurst(voice, {
    count: 6,
    spread: 0.24,
    hz: 5200,
    hzSpread: 1.6,
    hzDrift: 1.5,
    q: 5,
    level: 0.03,
    decay: 0.04,
    reverb: 0.3,
  })
}

/**
 * A small animal, pleased.
 *
 * Two bandpasses sitting where a lamb's vowel formants would be, fed a buzzy
 * saw with a fast wobble on it. The wobble is what makes it read as a bleat
 * rather than a beep.
 */
function bleat(voice: Voice) {
  const { ctx } = voice
  const now = voice.now
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const vibrato = ctx.createOscillator()
  const vibratoDepth = ctx.createGain()

  oscillator.type = 'sawtooth'
  const base = 430 + voice.rand * 90
  oscillator.frequency.setValueAtTime(base * voice.pitch, now)
  oscillator.frequency.exponentialRampToValueAtTime(330 * voice.pitch, now + 0.3)

  vibrato.frequency.value = 20 + voice.rand * 6
  vibratoDepth.gain.value = 38
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(oscillator.frequency)

  const formantA = ctx.createBiquadFilter()
  formantA.type = 'bandpass'
  formantA.frequency.value = 700 + voice.rand * 180
  formantA.Q.value = 5
  const formantB = ctx.createBiquadFilter()
  formantB.type = 'bandpass'
  formantB.frequency.value = 1320 + voice.rand * 260
  formantB.Q.value = 7

  const level = 0.2 * voice.gain
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(level, now + 0.03)
  gain.gain.setValueAtTime(level, now + 0.2)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)

  oscillator.connect(formantA)
  oscillator.connect(formantB)
  formantA.connect(gain)
  formantB.connect(gain)
  gain.connect(voice.out)

  const send = ctx.createGain()
  send.gain.value = 0.18
  gain.connect(send)
  send.connect(voice.reverb)

  oscillator.start(now)
  vibrato.start(now)
  oscillator.stop(now + 0.4)
  vibrato.stop(now + 0.4)
}

/** A scuff of grass, not a boot on gravel. */
function step(voice: Voice) {
  noiseLayer(voice, {
    level: 0.045,
    attack: 0.002,
    decay: 0.055,
    filter: 'bandpass',
    hz: 1500 * vary(0.3),
    q: 1.1,
    rate: vary(0.3),
  })
  toneLayer(voice, { from: 110, to: 70, level: 0.05, decay: 0.05, pitchAmount: 0 })
}

/** Lemonade going into a cup: bubbles over a pour. */
function brew(voice: Voice) {
  noiseLayer(voice, {
    level: 0.05,
    attack: 0.03,
    decay: 0.2,
    filter: 'bandpass',
    hz: 2400,
    hzTo: 1400,
    q: 1.4,
  })
  for (let index = 0; index < 4; index += 1) {
    toneLayer(voice, {
      at: index * 0.045 + Math.random() * 0.02,
      from: (180 + index * 45) * vary(0.1),
      to: (330 + index * 70) * vary(0.1),
      glide: 0.05,
      level: 0.075,
      decay: 0.08,
      lowpass: 1800,
    })
  }
}

/**
 * The combo ping. Its pitch is set by the caller walking up a pentatonic scale,
 * so a long streak plays a rising phrase that stays in key with the score —
 * the single cheapest way to make a run of hits feel like it's building.
 */
function combo(voice: Voice) {
  fmBell(voice, { carrier: 587, ratio: 3.5, index: 1.3, level: 0.12, decay: 0.26, reverb: 0.28 })
  fmBell(voice, {
    at: 0.015,
    carrier: 1174,
    ratio: 2.5,
    index: 0.7,
    level: 0.05,
    decay: 0.3,
    reverb: 0.3,
  })
  noiseLayer(voice, {
    level: 0.035,
    attack: 0.002,
    decay: 0.11,
    filter: 'bandpass',
    hz: 5400,
    q: 2,
    reverb: 0.3,
  })
}

export const SFX: Record<SfxName, (voice: Voice) => void> = {
  whoosh,
  splat,
  thunk,
  crack,
  pop,
  pickLemon,
  pickLeaf,
  ding,
  sparkle,
  coin,
  cheer,
  uhOh,
  tick,
  tap,
  fanfare,
  regrow,
  zest,
  bleat,
  step,
  brew,
  combo,
}
