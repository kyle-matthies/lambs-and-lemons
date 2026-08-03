/**
 * Synthesis primitives every effect is built from.
 *
 * The rule the whole sound library follows: a satisfying impact is never one
 * sound, it's five arriving within 40 ms of each other — a transient (the
 * contact), a body (what was hit), a sub (how heavy it was), a texture (what it
 * was made of) and a tail (where you were standing). Each helper here makes one
 * of those layers; `sfx.ts` stacks them into instruments.
 *
 * Everything is generated at runtime, so there are no files to load and no
 * decode hitch on the first smash.
 */

/** One noise buffer per context. Allocating a fresh one per hit is wasteful. */
const noiseCache = new WeakMap<AudioContext, AudioBuffer>()
const impulseCache = new WeakMap<AudioContext, AudioBuffer>()
// Explicitly backed by an ArrayBuffer: `WaveShaperNode.curve` won't accept the
// `ArrayBufferLike` that a bare `Float32Array` annotation widens to.
let softClipCurve: Float32Array<ArrayBuffer> | null = null

const NOISE_SECONDS = 2.5

/**
 * Stereo white noise, read from a random offset each time it's used. Two
 * independent channels is what makes sprays and rustles feel wide instead of
 * pinned to the centre.
 */
export function noiseBuffer(ctx: AudioContext) {
  const cached = noiseCache.get(ctx)
  if (cached) return cached

  const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS)
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < frames; index += 1) {
      data[index] = Math.random() * 2 - 1
    }
  }
  noiseCache.set(ctx, buffer)
  return buffer
}

/**
 * The valley's reverb, as an impulse response.
 *
 * Outdoors doesn't ring like a cathedral, so this is short and gets darker as it
 * decays — a one-pole lowpass whose coefficient closes over the tail, which is
 * what air does to a reflection travelling a few hundred metres. The 18 ms of
 * silence at the front is pre-delay: it keeps the dry transient in front of the
 * wash so hits stay punchy instead of turning to soup.
 */
export function valleyImpulse(ctx: AudioContext) {
  const cached = impulseCache.get(ctx)
  if (cached) return cached

  const seconds = 1.7
  const frames = Math.floor(ctx.sampleRate * seconds)
  const preDelay = Math.floor(ctx.sampleRate * 0.018)
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate)

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    let last = 0
    for (let index = preDelay; index < frames; index += 1) {
      const t = (index - preDelay) / (frames - preDelay)
      const white = Math.random() * 2 - 1
      // Coefficient shrinks with time, so the tail loses its highs on the way out.
      last += (white - last) * (0.34 - t * 0.27)
      data[index] = last * Math.pow(1 - t, 2.6) * 2.2
    }
  }

  impulseCache.set(ctx, buffer)
  return buffer
}

/** Soft clipper. Rounds peaks off instead of squaring them into a fizz. */
export function saturationCurve() {
  if (softClipCurve) return softClipCurve
  const size = 1024
  const curve = new Float32Array(size)
  const shape = 2.4
  for (let index = 0; index < size; index += 1) {
    const x = (index / (size - 1)) * 2 - 1
    curve[index] = Math.tanh(x * shape) / Math.tanh(shape)
  }
  softClipCurve = curve
  return curve
}

/**
 * Everything one effect needs to make noise: where to send its dry signal, taps
 * into the two send buses, and the variation it should play with.
 */
export interface Voice {
  ctx: AudioContext
  /** Dry destination — already panned and attenuated for this event. */
  out: AudioNode
  /** Send into the valley reverb, pre-scaled by distance. */
  reverb: AudioNode
  /** Send into the slap-back echo, for events big enough to carry. */
  echo: AudioNode
  now: number
  /** Stable 0-1 roll for this event, so layers can agree on one variation. */
  rand: number
  /** Scales every layer's level — repeat thinning and distance live here. */
  gain: number
  /** Scales every layer's pitch — the combo ladder lives here. */
  pitch: number
}

/** Apply the voice's pitch offset, optionally only partly (subs want less). */
function shift(voice: Voice, hz: number, amount = 1) {
  return amount === 0 ? hz : hz * Math.pow(voice.pitch, amount)
}

/** Exponential AD envelope. Web Audio can't ramp to or from a true zero. */
function envelope(param: AudioParam, at: number, peak: number, attack: number, decay: number) {
  const level = Math.max(0.0002, peak)
  param.setValueAtTime(0.0001, at)
  param.exponentialRampToValueAtTime(level, at + attack)
  param.exponentialRampToValueAtTime(0.0001, at + attack + decay)
}

/** Wire a layer to the dry output and, at whatever depth it asks for, the sends. */
function route(voice: Voice, node: AudioNode, reverb = 0, echo = 0) {
  node.connect(voice.out)
  if (reverb > 0) {
    const send = voice.ctx.createGain()
    send.gain.value = reverb
    node.connect(send)
    send.connect(voice.reverb)
  }
  if (echo > 0) {
    const send = voice.ctx.createGain()
    send.gain.value = echo
    node.connect(send)
    send.connect(voice.echo)
  }
}

function startNoise(voice: Voice, at: number, duration: number, rate = 1) {
  const source = voice.ctx.createBufferSource()
  source.buffer = noiseBuffer(voice.ctx)
  source.loop = true
  source.playbackRate.value = rate
  // A random read offset means two hits never share the same noise, which is
  // what stops rapid fire from sounding like one long buzz.
  source.start(at, Math.random() * (NOISE_SECONDS - 0.6))
  source.stop(at + duration + 0.02)
  return source
}

export interface NoiseOptions {
  /** Offset from the voice's start time. */
  at?: number
  level: number
  attack?: number
  decay: number
  filter?: BiquadFilterType
  hz: number
  /** Sweep the filter here across the layer's life. */
  hzTo?: number
  q?: number
  /** Extra highpass, to keep a bright layer from muddying the low end. */
  highpass?: number
  /** How much of the voice's pitch offset this layer takes, 0-1. */
  pitchAmount?: number
  rate?: number
  reverb?: number
  echo?: number
}

/** Filtered noise: sprays, rustles, scrapes, air, and every impact transient. */
export function noiseLayer(voice: Voice, options: NoiseOptions) {
  const { ctx } = voice
  const at = voice.now + (options.at ?? 0)
  const attack = options.attack ?? 0.002
  const life = attack + options.decay
  const pitchAmount = options.pitchAmount ?? 0.6

  const source = startNoise(voice, at, life, options.rate ?? 1)

  const filter = ctx.createBiquadFilter()
  filter.type = options.filter ?? 'bandpass'
  filter.Q.value = options.q ?? 1
  const from = shift(voice, options.hz, pitchAmount)
  filter.frequency.setValueAtTime(from, at)
  if (options.hzTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(20, shift(voice, options.hzTo, pitchAmount)),
      at + life,
    )
  }

  const gain = ctx.createGain()
  envelope(gain.gain, at, options.level * voice.gain, attack, options.decay)

  let head: AudioNode = filter
  source.connect(filter)
  if (options.highpass !== undefined) {
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = options.highpass
    filter.connect(highpass)
    head = highpass
  }
  head.connect(gain)
  route(voice, gain, options.reverb, options.echo)
}

export interface ToneOptions {
  at?: number
  type?: OscillatorType
  from: number
  /** Pitch falls (or rises) to here. Omit to hold. */
  to?: number
  /** Seconds the pitch takes to travel. Defaults to the whole envelope. */
  glide?: number
  level: number
  attack?: number
  decay: number
  /** Pre-gain into the soft clipper. 0 leaves the layer clean. */
  drive?: number
  lowpass?: number
  q?: number
  detune?: number
  pitchAmount?: number
  reverb?: number
  echo?: number
}

/** A pitched layer: impact bodies, subs, chimes, glides. */
export function toneLayer(voice: Voice, options: ToneOptions) {
  const { ctx } = voice
  const at = voice.now + (options.at ?? 0)
  const attack = options.attack ?? 0.004
  const life = attack + options.decay
  const pitchAmount = options.pitchAmount ?? 1

  const oscillator = ctx.createOscillator()
  oscillator.type = options.type ?? 'sine'
  if (options.detune) oscillator.detune.value = options.detune
  const from = shift(voice, options.from, pitchAmount)
  oscillator.frequency.setValueAtTime(from, at)
  if (options.to !== undefined && options.to !== options.from) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(8, shift(voice, options.to, pitchAmount)),
      at + (options.glide ?? life),
    )
  }

  const gain = ctx.createGain()
  envelope(gain.gain, at, options.level * voice.gain, attack, options.decay)

  let head: AudioNode = oscillator
  if (options.drive) {
    const pre = ctx.createGain()
    pre.gain.value = options.drive
    const shaper = ctx.createWaveShaper()
    shaper.curve = saturationCurve()
    head.connect(pre)
    pre.connect(shaper)
    head = shaper
  }
  if (options.lowpass !== undefined) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = shift(voice, options.lowpass, pitchAmount * 0.5)
    filter.Q.value = options.q ?? 0.7
    head.connect(filter)
    head = filter
  }
  head.connect(gain)
  route(voice, gain, options.reverb, options.echo)

  oscillator.start(at)
  oscillator.stop(at + life + 0.03)
}

export interface ModalOptions {
  at?: number
  base: number
  /** [frequency ratio, level, decay] per partial. */
  partials: [number, number, number][]
  level: number
  attack?: number
  reverb?: number
  echo?: number
}

/**
 * Modal synthesis: a handful of decaying sines at deliberately inharmonic
 * ratios. This is what makes something read as *struck wood* rather than a beep
 * — a hit tuned to 1 : 2.57 : 4.32 is a woodblock, the same hit at 1 : 2 : 3 is
 * a musical note.
 */
export function modalLayer(voice: Voice, options: ModalOptions) {
  for (const [ratio, amp, decay] of options.partials) {
    toneLayer(voice, {
      at: options.at,
      type: 'sine',
      from: options.base * ratio,
      level: options.level * amp,
      attack: options.attack ?? 0.002,
      decay,
      reverb: options.reverb,
      echo: options.echo,
    })
  }
}

export interface GrainOptions {
  at?: number
  count: number
  /** Seconds across which the grains land. */
  spread: number
  hz: number
  /** Multiplicative spread around `hz`, e.g. 2 means one octave either way. */
  hzSpread: number
  /** Where the centre frequency has drifted to by the end of the burst. */
  hzDrift?: number
  q?: number
  level: number
  decay: number
  /** Level multiplier reached at the end of the burst. */
  fade?: number
  reverb?: number
  echo?: number
}

/**
 * A scatter of very short filtered clicks. Splintering wood, pulp hitting the
 * grass, debris settling — anything made of many small events. Randomised per
 * call, so no two tree breaks splinter the same way.
 */
export function grainBurst(voice: Voice, options: GrainOptions) {
  const fade = options.fade ?? 0.2
  for (let index = 0; index < options.count; index += 1) {
    const t = options.count === 1 ? 0 : index / (options.count - 1)
    // Front-loaded: real debris is densest right after the break.
    const when = (options.at ?? 0) + Math.pow(Math.random(), 1.6) * options.spread
    const drift = 1 + ((options.hzDrift ?? 1) - 1) * t
    const spread = Math.pow(options.hzSpread, Math.random() * 2 - 1)
    noiseLayer(voice, {
      at: when,
      level: options.level * (1 + (fade - 1) * t) * (0.6 + Math.random() * 0.7),
      attack: 0.0012,
      decay: options.decay * (0.6 + Math.random() * 0.8),
      filter: 'bandpass',
      hz: options.hz * drift * spread,
      q: options.q ?? 6,
      pitchAmount: 0.4,
      reverb: options.reverb,
      echo: options.echo,
    })
  }
}

export interface BellOptions {
  at?: number
  carrier: number
  /** Modulator frequency as a multiple of the carrier. */
  ratio: number
  /** Modulation depth in Hz at the attack; it decays with the note. */
  index: number
  level: number
  attack?: number
  decay: number
  reverb?: number
}

/**
 * Two-operator FM. A pure sine chime sounds cheap; adding an inharmonic
 * modulator that decays faster than the carrier gives the metallic "ting" at the
 * front and a clean tone underneath — the classic bell recipe.
 */
export function fmBell(voice: Voice, options: BellOptions) {
  const { ctx } = voice
  const at = voice.now + (options.at ?? 0)
  const attack = options.attack ?? 0.004
  const life = attack + options.decay
  const carrierHz = shift(voice, options.carrier)

  const carrier = ctx.createOscillator()
  carrier.type = 'sine'
  carrier.frequency.value = carrierHz

  const modulator = ctx.createOscillator()
  modulator.type = 'sine'
  modulator.frequency.value = carrierHz * options.ratio

  const depth = ctx.createGain()
  depth.gain.setValueAtTime(options.index * carrierHz, at)
  depth.gain.exponentialRampToValueAtTime(options.index * carrierHz * 0.02, at + life * 0.5)
  modulator.connect(depth)
  depth.connect(carrier.frequency)

  const gain = ctx.createGain()
  envelope(gain.gain, at, options.level * voice.gain, attack, options.decay)
  carrier.connect(gain)
  route(voice, gain, options.reverb)

  carrier.start(at)
  modulator.start(at)
  carrier.stop(at + life + 0.03)
  modulator.stop(at + life + 0.03)
}

export interface SwooshOptions {
  at?: number
  level: number
  duration: number
  /** Filter travels from → peak → to, and the level swells with it. */
  from: number
  peak: number
  to: number
  q?: number
  reverb?: number
}

/** Air moving: a bandpass sweep that swells and falls. Misses, falling trees. */
export function swoosh(voice: Voice, options: SwooshOptions) {
  const { ctx } = voice
  const at = voice.now + (options.at ?? 0)
  const half = options.duration * 0.45

  const source = startNoise(voice, at, options.duration)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = options.q ?? 1.4
  filter.frequency.setValueAtTime(shift(voice, options.from, 0.5), at)
  filter.frequency.exponentialRampToValueAtTime(shift(voice, options.peak, 0.5), at + half)
  filter.frequency.exponentialRampToValueAtTime(
    shift(voice, options.to, 0.5),
    at + options.duration,
  )

  const gain = ctx.createGain()
  const level = options.level * voice.gain
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + half)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration)

  source.connect(filter)
  filter.connect(gain)
  route(voice, gain, options.reverb)
}

export interface GlideOptions {
  at?: number
  from: number
  to: number
  duration: number
  level: number
  /** Bandpass the source is dragged through — this is what makes it groan. */
  formant: number
  q?: number
  /** Depth of the pitch wobble in Hz. */
  wobble?: number
  wobbleHz?: number
  type?: OscillatorType
  reverb?: number
  echo?: number
}

/**
 * A sawtooth dragged downward through a resonant bandpass, with a wobble on the
 * pitch. Wood fibres tearing, a trunk leaning before it goes.
 */
export function creak(voice: Voice, options: GlideOptions) {
  const { ctx } = voice
  const at = voice.now + (options.at ?? 0)

  const oscillator = ctx.createOscillator()
  oscillator.type = options.type ?? 'sawtooth'
  oscillator.frequency.setValueAtTime(shift(voice, options.from, 0.6), at)
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(20, shift(voice, options.to, 0.6)),
    at + options.duration,
  )

  let wobble: OscillatorNode | null = null
  if (options.wobble) {
    wobble = ctx.createOscillator()
    wobble.frequency.value = options.wobbleHz ?? 9
    const depth = ctx.createGain()
    depth.gain.setValueAtTime(options.wobble, at)
    depth.gain.linearRampToValueAtTime(options.wobble * 3, at + options.duration)
    wobble.connect(depth)
    depth.connect(oscillator.frequency)
    wobble.start(at)
    wobble.stop(at + options.duration + 0.05)
  }

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = shift(voice, options.formant, 0.5)
  filter.Q.value = options.q ?? 9

  const gain = ctx.createGain()
  const level = options.level * voice.gain
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + options.duration * 0.25)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration)

  oscillator.connect(filter)
  filter.connect(gain)
  route(voice, gain, options.reverb, options.echo)

  oscillator.start(at)
  oscillator.stop(at + options.duration + 0.05)
}
