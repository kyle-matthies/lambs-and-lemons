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

/**
 * All sound is synthesized with the Web Audio API — no audio files, no
 * dependencies. The context is created lazily on the first user gesture
 * (required on iOS) and resumed whenever the tab regains focus.
 */
export class SoundManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private _muted = false

  get muted() {
    return this._muted
  }

  setMuted(muted: boolean) {
    this._muted = muted
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
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
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

  play(name: SfxName) {
    const ctx = this.ctx
    if (!ctx || !this.master || this._muted || ctx.state !== 'running') return
    const now = ctx.currentTime

    switch (name) {
      case 'boing':
        this.tone({ type: 'triangle', from: 300, to: 90, start: now, length: 0.16, peak: 0.22 })
        break
      case 'splat':
        this.noise({ start: now, length: 0.12, filterHz: 900, peak: 0.3 })
        this.tone({ type: 'sine', from: 130, to: 60, start: now, length: 0.12, peak: 0.25 })
        break
      case 'thunk':
        this.noise({ start: now, length: 0.09, filterHz: 420, peak: 0.3 })
        this.tone({ type: 'sine', from: 85, to: 55, start: now, length: 0.14, peak: 0.3 })
        break
      case 'crack':
        this.noise({ start: now, length: 0.2, filterHz: 700, peak: 0.34 })
        this.tone({ type: 'triangle', from: 340, to: 240, start: now, length: 0.12, peak: 0.2 })
        this.tone({ type: 'triangle', from: 240, to: 150, start: now + 0.12, length: 0.14, peak: 0.2 })
        this.tone({ type: 'triangle', from: 150, to: 80, start: now + 0.26, length: 0.2, peak: 0.2 })
        break
      case 'pop':
        this.tone({ type: 'sine', from: 500, to: 900, start: now, length: 0.07, peak: 0.2 })
        break
      case 'ding':
        this.tone({ type: 'sine', from: 1319, to: 1319, start: now, length: 0.28, peak: 0.16 })
        this.tone({ type: 'sine', from: 1976, to: 1976, start: now + 0.02, length: 0.3, peak: 0.1 })
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
          })
        })
        break
      case 'coin':
        this.tone({ type: 'square', from: 988, to: 988, start: now, length: 0.08, peak: 0.11 })
        this.tone({ type: 'square', from: 1319, to: 1319, start: now + 0.08, length: 0.16, peak: 0.11 })
        break
      case 'cheer':
        this.noise({ start: now, length: 0.55, filterHz: 1800, peak: 0.1 })
        ;[523, 659, 784, 1047].forEach((freq, index) => {
          this.tone({
            type: 'triangle',
            from: freq,
            to: freq,
            start: now + index * 0.09,
            length: 0.24,
            peak: 0.15,
          })
        })
        break
      case 'uhOh':
        this.tone({ type: 'sine', from: 392, to: 392, start: now, length: 0.18, peak: 0.14 })
        this.tone({ type: 'sine', from: 330, to: 330, start: now + 0.2, length: 0.26, peak: 0.14 })
        break
      case 'tick':
        this.tone({ type: 'square', from: 880, to: 880, start: now, length: 0.05, peak: 0.09 })
        break
      case 'tap':
        this.tone({ type: 'sine', from: 620, to: 660, start: now, length: 0.06, peak: 0.12 })
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
          })
        })
        break
      case 'regrow':
        this.tone({ type: 'sine', from: 320, to: 720, start: now, length: 0.24, peak: 0.13 })
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
  }) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
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
    gain.connect(master)
    oscillator.start(options.start)
    oscillator.stop(options.start + options.length + 0.05)
  }

  private noise(options: { start: number; length: number; filterHz: number; peak: number }) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
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
    gain.connect(master)
    source.start(options.start)
  }
}
