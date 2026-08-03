/**
 * The valley's score — synthesized live, no audio files.
 *
 * The music is built in layers that fade in as the valley recovers, so the
 * soundtrack tells the same story as the picture: a lone cold drone when
 * everything is grey, then a heartbeat, then a marimba, then a melody, then
 * strings, until by the end the whole band is playing. Nothing is a loop of a
 * loop — every note is scheduled against the audio clock, so the layers can
 * arrive and leave mid-phrase without any seams.
 *
 * A short lookahead scheduler (the standard Web Audio pattern) does the timing:
 * `update()` is called from the game loop and queues anything due in the next
 * fraction of a second, which keeps the music rock-steady even when the frame
 * rate isn't.
 */

const LOOKAHEAD = 0.35

/** D major pentatonic — no semitone clashes, so any two layers agree. */
const SCALE = [0, 2, 4, 7, 9]
const ROOT = 146.83 // D3

/** i-VI-IV-V in D, one chord every two bars. Warm, unhurried, resolves home. */
const PROGRESSION = [
  { root: 0, thirds: [0, 4, 7, 11] },
  { root: -3, thirds: [0, 3, 7, 10] },
  { root: -7, thirds: [0, 4, 7, 11] },
  { root: -5, thirds: [0, 4, 7, 9] },
]

const MELODY = [
  [0, 2, 4, 2],
  [4, 3, 2, 0],
  [2, 4, 6, 4],
  [4, 2, 1, 0],
]

function semitone(steps: number) {
  return ROOT * Math.pow(2, steps / 12)
}

/**
 * Scale degree → frequency, wrapping into higher octaves as the index grows.
 *
 * `index` is floored: a fractional degree indexes the scale array with a
 * non-integer, which yields `undefined` and propagates a NaN all the way to
 * `AudioParam.setValueAtTime`. `transpose` shifts the result in semitones, which
 * is the right unit for following a chord root.
 */
function degree(index: number, octave = 0, transpose = 0) {
  const step = Math.floor(index)
  const wrapped = ((step % SCALE.length) + SCALE.length) % SCALE.length
  const octaves = Math.floor(step / SCALE.length) + octave
  return semitone(SCALE[wrapped] + octaves * 12 + transpose)
}

interface Layer {
  gain: GainNode
  /** Recovery level at which this layer starts to come in. */
  from: number
  /** ...and where it reaches full volume. */
  to: number
  ceiling: number
}

export class MusicDirector {
  private readonly ctx: AudioContext
  private readonly bus: GainNode
  private readonly layers: Record<string, Layer> = {}
  private readonly padVoices: { osc: OscillatorNode; gain: GainNode }[] = []
  private padFilter: BiquadFilterNode | null = null

  private step = 0
  private nextNoteTime = 0
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null
  private intensity = 0
  private urgency = 0

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.bus = ctx.createGain()
    this.bus.gain.value = 0.34
    this.bus.connect(destination)

    const makeLayer = (from: number, to: number, ceiling: number): Layer => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(this.bus)
      return { gain, from, to, ceiling }
    }

    // The drone is always there; everything else is earned.
    this.layers.pad = makeLayer(0, 0.25, 0.62)
    this.layers.bass = makeLayer(0.05, 0.3, 0.5)
    this.layers.marimba = makeLayer(0.22, 0.5, 0.44)
    this.layers.melody = makeLayer(0.45, 0.75, 0.38)
    this.layers.shimmer = makeLayer(0.68, 1, 0.3)

    this.buildPad()
  }

  /**
   * A sustained chord of detuned triangles behind a filter we sweep open as the
   * valley recovers — the single most effective "the sun is coming out" trick
   * available to a synth.
   */
  private buildPad() {
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 320
    filter.Q.value = 0.6
    filter.connect(this.layers.pad.gain)
    this.padFilter = filter

    for (const detune of [-7, 0, 7, 12]) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      osc.detune.value = detune
      gain.gain.value = 0.24
      osc.connect(gain)
      gain.connect(filter)
      this.padVoices.push({ osc, gain })
    }
  }

  start() {
    if (this.running) return
    this.running = true
    this.nextNoteTime = this.ctx.currentTime + 0.08
    this.step = 0

    // Deliberately not driven by the render loop. Tying note scheduling to
    // requestAnimationFrame means the music stutters whenever the frame rate
    // does — exactly when a weak device is already struggling — and stops dead
    // if a frame takes longer than the lookahead. A timer of its own keeps the
    // score steady no matter what the renderer is doing.
    this.timer = setInterval(() => this.update(), 25)
    for (const voice of this.padVoices) {
      try {
        voice.osc.start()
      } catch {
        // Already started — an oscillator can only be started once, and we keep
        // the pad voices alive for the lifetime of the context.
      }
    }
  }

  /**
   * @param recovery 0-1, how much colour the valley has back.
   * @param urgency  0-1, how close the sun is to setting.
   */
  setIntensity(recovery: number, urgency: number) {
    this.intensity = Math.min(1, Math.max(0, recovery))
    this.urgency = Math.min(1, Math.max(0, urgency))
  }

  /**
   * Schedule whatever falls inside the lookahead window. Driven by the timer
   * started in `start()`; safe to call again from anywhere.
   */
  update() {
    if (!this.running || this.ctx.state !== 'running') return

    const now = this.ctx.currentTime

    // Layer volumes follow recovery, smoothed so they swell rather than pop.
    for (const layer of Object.values(this.layers)) {
      const span = Math.max(0.001, layer.to - layer.from)
      const amount = Math.min(1, Math.max(0, (this.intensity - layer.from) / span))
      layer.gain.gain.setTargetAtTime(amount * layer.ceiling, now, 0.9)
    }

    if (this.padFilter) {
      // 300 Hz of muffle at the start, wide open by the end.
      const cutoff = 320 + this.intensity * 2100 + this.urgency * 260
      this.padFilter.frequency.setTargetAtTime(cutoff, now, 1.2)
    }

    // Tempo creeps up as the valley wakes, and again as the light runs out.
    const bpm = 82 + this.intensity * 14 + this.urgency * 10
    const stepDuration = 60 / bpm / 2 // eighth notes

    // A backgrounded tab freezes the frame loop but not the audio clock. Without
    // this the scheduler would come back to a huge backlog and fire every missed
    // note at once.
    if (this.nextNoteTime < now) this.nextNoteTime = now + 0.02

    while (this.nextNoteTime < now + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextNoteTime, stepDuration)
      this.nextNoteTime += stepDuration
      this.step += 1
    }
  }

  private scheduleStep(step: number, time: number, stepDuration: number) {
    const bar = Math.floor(step / 8)
    const beat = step % 8
    const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length]

    // Pad: retune the sustained chord at the top of each two-bar phrase.
    if (beat === 0 && bar % 2 === 0) {
      this.padVoices.forEach((voice, index) => {
        const interval = chord.thirds[index % chord.thirds.length]
        voice.osc.frequency.setTargetAtTime(semitone(chord.root + interval), time, 0.35)
      })
    }

    if (beat === 0 || beat === 5) {
      this.pluck({
        frequency: semitone(chord.root - 12),
        time,
        length: stepDuration * 2.4,
        type: 'sine',
        peak: 0.5,
        target: this.layers.bass.gain,
      })
    }

    // Marimba: a rolling eighth-note figure over the chord.
    if (beat % 2 === 0 || (beat === 3 && this.intensity > 0.55)) {
      const shape = [0, 2, 4, 2, 5, 4, 2, 1]
      this.pluck({
        // Follow the chord by transposing in semitones — adding the root as a
        // scale *degree* would land between notes.
        frequency: degree(shape[beat], 1, chord.root),
        time,
        length: stepDuration * 1.6,
        type: 'triangle',
        peak: 0.34,
        target: this.layers.marimba.gain,
      })
    }

    // Melody: a music-box phrase on the half-bar.
    if (beat === 0 || beat === 4) {
      const phrase = MELODY[bar % MELODY.length]
      const note = phrase[(beat === 0 ? 0 : 2) + (bar % 2)]
      this.pluck({
        frequency: degree(note, 2),
        time: time + 0.01,
        length: stepDuration * 3.2,
        type: 'sine',
        peak: 0.3,
        target: this.layers.melody.gain,
      })
    }

    // Shimmer: a high, slow bloom of light at the top of each phrase.
    if (beat === 0 && bar % 2 === 1) {
      for (const offset of [4, 6, 8]) {
        this.pluck({
          frequency: degree(offset, 3),
          time: time + offset * 0.03,
          length: stepDuration * 8,
          type: 'sine',
          peak: 0.16,
          target: this.layers.shimmer.gain,
        })
      }
    }
  }

  private pluck(options: {
    frequency: number
    time: number
    length: number
    type: OscillatorType
    peak: number
    target: AudioNode
  }) {
    // A bad frequency should cost a silent note, not a flood of Web Audio
    // exceptions from inside the scheduler.
    if (!Number.isFinite(options.frequency) || options.frequency <= 0) return

    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = options.type
    osc.frequency.setValueAtTime(options.frequency, options.time)

    // Percussive attack, long exponential tail — the shape of a struck bar.
    gain.gain.setValueAtTime(0.0001, options.time)
    gain.gain.exponentialRampToValueAtTime(options.peak, options.time + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, options.time + options.length)

    osc.connect(gain)
    gain.connect(options.target)
    osc.start(options.time)
    osc.stop(options.time + options.length + 0.05)
  }

  /** One-shot flourish for the moment the valley wakes. */
  celebrate() {
    if (!this.running || this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    ;[0, 2, 4, 5, 7].forEach((note, index) => {
      this.pluck({
        frequency: degree(note, 2),
        time: now + index * 0.11,
        length: index === 4 ? 2.2 : 0.5,
        type: 'sine',
        peak: 0.34,
        target: this.bus,
      })
    })
  }

  stop() {
    this.running = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    const now = this.ctx.currentTime
    for (const layer of Object.values(this.layers)) {
      layer.gain.gain.cancelScheduledValues(now)
      layer.gain.gain.setTargetAtTime(0, now, 0.3)
    }
  }
}
