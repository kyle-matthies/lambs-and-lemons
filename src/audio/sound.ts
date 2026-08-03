import { AmbienceBed } from './ambience'
import { MusicDirector } from './music'

export type SfxName =
  | 'boing'
  | 'splat'
  | 'thunk'
  | 'crack'
  | 'pop'
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

interface Listener {
  x: number
  z: number
  forwardX: number
  forwardZ: number
}

/** Beyond this the world goes quiet; inside it, closer is louder. */
const HEARING_RANGE = 26

/**
 * All sound is synthesized with the Web Audio API — no audio files, no
 * dependencies. The context is created lazily on the first user gesture
 * (required on iOS) and resumed whenever the tab regains focus.
 *
 * Three buses hang off the master so the mix can be shaped as a whole: effects,
 * the adaptive score, and the ambience bed. Effects can be placed in the world —
 * `playAt` pans and attenuates them relative to the camera, so a tree cracking
 * across the meadow sounds like it's over there.
 */
export class SoundManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private _muted = false
  /**
   * The scene is usually asked for before the browser will let us have an audio
   * context — a round can be underway well before the first tap. Remember the
   * request so `unlock` can honour it once the context exists.
   */
  private sceneWanted = false

  music: MusicDirector | null = null
  ambience: AmbienceBed | null = null

  private readonly listener: Listener = { x: 0, z: 0, forwardX: 0, forwardZ: -1 }

  get muted() {
    return this._muted
  }

  setMuted(muted: boolean) {
    this._muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05)
    }
  }

  /** Call from a one-time pointerdown/keydown listener. Safe to call again. */
  unlock() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return

      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this._muted ? 0 : 0.5
      this.master.connect(this.ctx.destination)

      this.sfxBus = this.ctx.createGain()
      this.sfxBus.gain.value = 1
      this.sfxBus.connect(this.master)

      this.music = new MusicDirector(this.ctx, this.master)
      this.ambience = new AmbienceBed(this.ctx, this.master)
      if (this.sceneWanted) this.startScene()

      // iOS unmutes only after a buffer actually plays inside the gesture.
      const buffer = this.ctx.createBuffer(1, 1, 22050)
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(this.ctx.destination)
      source.start(0)
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
  }

  /** Start the score and the ambience bed. Idempotent, and safe before unlock. */
  startScene() {
    this.sceneWanted = true
    this.music?.start()
    this.ambience?.start()
  }

  stopScene() {
    this.sceneWanted = false
    this.music?.stop()
    this.ambience?.stop()
  }

  /** Where the camera is and which way it faces, for panning world sounds. */
  setListener(x: number, z: number, forwardX: number, forwardZ: number) {
    this.listener.x = x
    this.listener.z = z
    this.listener.forwardX = forwardX
    this.listener.forwardZ = forwardZ
  }

  /**
   * Drive the adaptive mix. Call once a frame while a round is running.
   *
   * @param recovery 0-1 valley recovery
   * @param urgency  0-1 how close the sun is to setting
   * @param wind     0-1 current gust strength
   */
  updateMix(recovery: number, urgency: number, wind: number) {
    // The score schedules itself on its own timer; this only tells it how the
    // round is going.
    this.music?.setIntensity(recovery, urgency)
    this.ambience?.update(recovery, wind)
  }

  play(name: SfxName) {
    this.emit(name, this.sfxBus)
  }

  /** Play an effect positioned in the world, panned and attenuated. */
  playAt(name: SfxName, x: number, z: number) {
    const ctx = this.ctx
    const bus = this.sfxBus
    if (!ctx || !bus || this._muted || ctx.state !== 'running') return

    const dx = x - this.listener.x
    const dz = z - this.listener.z
    const distance = Math.hypot(dx, dz)
    // Inverse-square-ish rolloff, floored so distant events stay audible.
    const attenuation = 1 / (1 + Math.pow(distance / (HEARING_RANGE * 0.4), 2))
    if (attenuation < 0.02) return

    // Right vector for a camera facing (forwardX, forwardZ) on the XZ plane.
    const rightX = -this.listener.forwardZ
    const rightZ = this.listener.forwardX
    const length = distance || 1
    const pan = Math.max(-1, Math.min(1, ((dx / length) * rightX + (dz / length) * rightZ) * 0.85))

    const gain = ctx.createGain()
    gain.gain.value = attenuation
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    gain.connect(panner)
    panner.connect(bus)

    this.emit(name, gain)
  }

  private emit(name: SfxName, destination: AudioNode | null) {
    const ctx = this.ctx
    if (!ctx || !destination || this._muted || ctx.state !== 'running') return
    const now = ctx.currentTime
    const out = destination

    switch (name) {
      case 'boing':
        this.tone({ type: 'triangle', from: 300, to: 90, start: now, length: 0.16, peak: 0.22, out })
        break
      case 'splat':
        this.noise({ start: now, length: 0.12, filterHz: 900, peak: 0.3, out })
        this.tone({ type: 'sine', from: 130, to: 60, start: now, length: 0.12, peak: 0.25, out })
        break
      case 'thunk':
        this.noise({ start: now, length: 0.09, filterHz: 420, peak: 0.3, out })
        this.tone({ type: 'sine', from: 85, to: 55, start: now, length: 0.14, peak: 0.3, out })
        break
      case 'crack':
        this.noise({ start: now, length: 0.2, filterHz: 700, peak: 0.34, out })
        this.tone({ type: 'triangle', from: 340, to: 240, start: now, length: 0.12, peak: 0.2, out })
        this.tone({
          type: 'triangle',
          from: 240,
          to: 150,
          start: now + 0.12,
          length: 0.14,
          peak: 0.2,
          out,
        })
        this.tone({
          type: 'triangle',
          from: 150,
          to: 80,
          start: now + 0.26,
          length: 0.2,
          peak: 0.2,
          out,
        })
        break
      case 'pop':
        this.tone({ type: 'sine', from: 500, to: 900, start: now, length: 0.07, peak: 0.2, out })
        break
      case 'ding':
        this.tone({ type: 'sine', from: 1319, to: 1319, start: now, length: 0.28, peak: 0.16, out })
        this.tone({
          type: 'sine',
          from: 1976,
          to: 1976,
          start: now + 0.02,
          length: 0.3,
          peak: 0.1,
          out,
        })
        break
      case 'sparkle':
        [1319, 1568, 2093].forEach((freq, index) => {
          this.tone({
            type: 'sine',
            from: freq,
            to: freq,
            start: now + index * 0.07,
            length: 0.22,
            peak: 0.13,
            out,
          })
        })
        break
      case 'coin':
        this.tone({ type: 'square', from: 988, to: 988, start: now, length: 0.08, peak: 0.11, out })
        this.tone({
          type: 'square',
          from: 1319,
          to: 1319,
          start: now + 0.08,
          length: 0.16,
          peak: 0.11,
          out,
        })
        break
      case 'cheer':
        this.noise({ start: now, length: 0.55, filterHz: 1800, peak: 0.1, out })
        ;[523, 659, 784, 1047].forEach((freq, index) => {
          this.tone({
            type: 'triangle',
            from: freq,
            to: freq,
            start: now + index * 0.09,
            length: 0.24,
            peak: 0.15,
            out,
          })
        })
        break
      case 'uhOh':
        this.tone({ type: 'sine', from: 392, to: 392, start: now, length: 0.18, peak: 0.14, out })
        this.tone({
          type: 'sine',
          from: 330,
          to: 330,
          start: now + 0.2,
          length: 0.26,
          peak: 0.14,
          out,
        })
        break
      case 'tick':
        this.tone({ type: 'square', from: 880, to: 880, start: now, length: 0.05, peak: 0.09, out })
        break
      case 'tap':
        this.tone({ type: 'sine', from: 620, to: 660, start: now, length: 0.06, peak: 0.12, out })
        break
      case 'fanfare':
        [523, 659, 784, 659, 1047].forEach((freq, index) => {
          this.tone({
            type: 'triangle',
            from: freq,
            to: freq,
            start: now + index * 0.13,
            length: index === 4 ? 0.5 : 0.16,
            peak: 0.16,
            out,
          })
        })
        break
      case 'regrow':
        this.tone({ type: 'sine', from: 320, to: 720, start: now, length: 0.24, peak: 0.13, out })
        break

      case 'zest':
        // Colour rushing back out: a bright rising sweep with a shimmer on top.
        this.tone({ type: 'sine', from: 420, to: 1650, start: now, length: 0.3, peak: 0.14, out })
        this.tone({
          type: 'triangle',
          from: 840,
          to: 2400,
          start: now + 0.02,
          length: 0.26,
          peak: 0.07,
          out,
        })
        this.noise({ start: now, length: 0.22, filterHz: 5200, peak: 0.05, out })
        break

      case 'bleat': {
        // A little formant trick: a buzzy source through two bandpass filters
        // sitting where a small animal's vowel formants would be.
        const ctxRef = this.ctx
        if (!ctxRef) break
        const osc = ctxRef.createOscillator()
        const gain = ctxRef.createGain()
        const vibrato = ctxRef.createOscillator()
        const vibratoGain = ctxRef.createGain()

        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(430 + Math.random() * 90, now)
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.3)

        // The wobble is what makes it read as a bleat rather than a beep.
        vibrato.frequency.value = 22
        vibratoGain.gain.value = 38
        vibrato.connect(vibratoGain)
        vibratoGain.connect(osc.frequency)

        const formantA = ctxRef.createBiquadFilter()
        formantA.type = 'bandpass'
        formantA.frequency.value = 780
        formantA.Q.value = 5
        const formantB = ctxRef.createBiquadFilter()
        formantB.type = 'bandpass'
        formantB.frequency.value = 1420
        formantB.Q.value = 7

        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03)
        gain.gain.setValueAtTime(0.2, now + 0.2)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)

        osc.connect(formantA)
        osc.connect(formantB)
        formantA.connect(gain)
        formantB.connect(gain)
        gain.connect(out)

        osc.start(now)
        vibrato.start(now)
        osc.stop(now + 0.4)
        vibrato.stop(now + 0.4)
        break
      }

      case 'step':
        // Barely there — a scuff of grass, not a boot on gravel.
        this.noise({ start: now, length: 0.05, filterHz: 1600, peak: 0.035, out })
        break

      case 'brew':
        for (let index = 0; index < 3; index += 1) {
          this.tone({
            type: 'sine',
            from: 180 + index * 40,
            to: 320 + index * 60,
            start: now + index * 0.05,
            length: 0.09,
            peak: 0.08,
            out,
          })
        }
        break
    }
  }

  private tone(options: {
    type: OscillatorType
    from: number
    to: number
    start: number
    length: number
    peak: number
    out: AudioNode
  }) {
    const ctx = this.ctx
    if (!ctx) return
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = options.type
    oscillator.frequency.setValueAtTime(options.from, options.start)
    if (options.to !== options.from) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.to),
        options.start + options.length,
      )
    }
    gain.gain.setValueAtTime(0, options.start)
    gain.gain.linearRampToValueAtTime(options.peak, options.start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.001, options.start + options.length)
    oscillator.connect(gain)
    gain.connect(options.out)
    oscillator.start(options.start)
    oscillator.stop(options.start + options.length + 0.05)
  }

  private noise(options: {
    start: number
    length: number
    filterHz: number
    peak: number
    out: AudioNode
  }) {
    const ctx = this.ctx
    if (!ctx) return
    const frames = Math.max(1, Math.floor(ctx.sampleRate * options.length))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < frames; index += 1) {
      data[index] = Math.random() * 2 - 1
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = options.filterHz
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(options.peak, options.start)
    gain.gain.exponentialRampToValueAtTime(0.001, options.start + options.length)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(options.out)
    source.start(options.start)
  }
}
