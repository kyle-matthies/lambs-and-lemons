/**
 * The sound of the place itself: wind through grass, birds, crickets, water.
 *
 * Like the score, it's all synthesized and it all responds to how far the valley
 * has recovered. A sour valley is crickets and cold wind; a healed one is
 * birdsong and a warm breeze. Nothing here loops a sample — the wind is filtered
 * noise driven by the same gust envelope the grass shader uses, and the birds are
 * scheduled one call at a time.
 */

function makeNoiseBuffer(ctx: AudioContext, seconds: number) {
  const frames = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  // Brown-ish noise: integrating white noise gives the low, breathy character of
  // wind rather than the hiss of a broken radio.
  let last = 0
  for (let index = 0; index < frames; index += 1) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[index] = last * 3.2
  }
  return buffer
}

export class AmbienceBed {
  private readonly ctx: AudioContext
  private readonly bus: GainNode

  private readonly windGain: GainNode
  private readonly windFilter: BiquadFilterNode
  private windSource: AudioBufferSourceNode | null = null

  private readonly birdGain: GainNode
  private readonly cricketGain: GainNode

  private running = false
  private recovery = 0
  private windStrength = 0.5
  private nextBird = 0
  private nextCricket = 0

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.bus = ctx.createGain()
    this.bus.gain.value = 0.5
    this.bus.connect(destination)

    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'lowpass'
    this.windFilter.frequency.value = 520
    this.windFilter.Q.value = 0.5

    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    this.windFilter.connect(this.windGain)
    this.windGain.connect(this.bus)

    this.birdGain = ctx.createGain()
    this.birdGain.gain.value = 0
    this.birdGain.connect(this.bus)

    this.cricketGain = ctx.createGain()
    this.cricketGain.gain.value = 0
    this.cricketGain.connect(this.bus)
  }

  start() {
    if (this.running) return
    this.running = true

    const source = this.ctx.createBufferSource()
    source.buffer = makeNoiseBuffer(this.ctx, 4)
    source.loop = true
    source.connect(this.windFilter)
    source.start()
    this.windSource = source

    this.nextBird = this.ctx.currentTime + 2
    this.nextCricket = this.ctx.currentTime + 0.5
  }

  setVolume(volume: number) {
    this.bus.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.2)
  }

  /**
   * @param recovery 0-1 valley recovery.
   * @param windStrength matches the gust value driving the grass, so what you
   *        hear and what you see are the same weather.
   */
  update(recovery: number, windStrength: number) {
    if (!this.running || this.ctx.state !== 'running') return

    this.recovery = recovery
    this.windStrength = windStrength
    const now = this.ctx.currentTime

    // Wind: louder and brighter in gusts, and a touch softer once the valley is
    // healed — a sour valley has a colder, more exposed sound.
    const gust = 0.5 + windStrength * 0.5
    this.windGain.gain.setTargetAtTime(0.12 + gust * 0.13, now, 0.4)
    this.windFilter.frequency.setTargetAtTime(360 + gust * 620 + recovery * 260, now, 0.6)

    this.birdGain.gain.setTargetAtTime(Math.max(0, recovery - 0.15) * 0.5, now, 1.5)
    this.cricketGain.gain.setTargetAtTime(Math.max(0, 0.55 - recovery) * 0.34, now, 1.5)

    // Birds get chattier the more colour there is.
    if (recovery > 0.18 && now >= this.nextBird) {
      this.chirp(now)
      this.nextBird = now + 1.2 + Math.random() * (7 - recovery * 4)
    }

    if (recovery < 0.6 && now >= this.nextCricket) {
      this.cricket(now)
      this.nextCricket = now + 0.35 + Math.random() * 0.6
    }
  }

  /** A two- or three-note birdcall built from a fast frequency sweep. */
  private chirp(now: number) {
    const notes = 2 + Math.floor(Math.random() * 2)
    const base = 1800 + Math.random() * 1400
    for (let index = 0; index < notes; index += 1) {
      const start = now + index * (0.07 + Math.random() * 0.05)
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      const from = base * (0.9 + Math.random() * 0.3)
      osc.frequency.setValueAtTime(from, start)
      osc.frequency.exponentialRampToValueAtTime(from * (1.2 + Math.random() * 0.5), start + 0.05)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.32, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09)
      osc.connect(gain)
      gain.connect(this.birdGain)
      osc.start(start)
      osc.stop(start + 0.14)
    }
  }

  /** Cricket: a short buzz of amplitude-modulated tone. */
  private cricket(now: number) {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    const chirps = 3
    osc.type = 'square'
    osc.frequency.value = 4200 + Math.random() * 700

    gain.gain.setValueAtTime(0.0001, now)
    for (let index = 0; index < chirps; index += 1) {
      const at = now + index * 0.055
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035)
    }

    osc.connect(gain)
    gain.connect(this.cricketGain)
    osc.start(now)
    osc.stop(now + chirps * 0.06 + 0.05)
  }

  stop() {
    this.running = false
    const now = this.ctx.currentTime
    this.windGain.gain.setTargetAtTime(0, now, 0.3)
    this.birdGain.gain.setTargetAtTime(0, now, 0.3)
    this.cricketGain.gain.setTargetAtTime(0, now, 0.3)
    this.windSource?.stop(now + 1.2)
    this.windSource = null
  }

  get currentRecovery() {
    return this.recovery
  }

  get currentWind() {
    return this.windStrength
  }
}
