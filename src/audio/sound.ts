import { AmbienceBed } from './ambience'
import { MusicDirector } from './music'
import { SFX, type SfxName } from './sfx'
import { valleyImpulse, type Voice } from './dsp'

export type { SfxName }

interface Listener {
  x: number
  z: number
  forwardX: number
  forwardZ: number
}

export interface PlayOptions {
  /** Extra level, 0-1 upward. Defaults to 1. */
  gain?: number
  /** Extra pitch multiplier on top of whatever the mix decides. */
  pitch?: number
  /** Combo level, for effects that walk up a scale. */
  level?: number
}

/** Beyond this the world goes quiet; inside it, closer is louder. */
const HEARING_RANGE = 26

/**
 * Effects big enough to push the score out of the way for a moment.
 *
 * Deliberately not `fanfare`: the valley waking plays a fanfare and a flourish
 * from the score at the same instant, and ducking there would only mute half of
 * its own celebration.
 */
const DUCKERS: Partial<Record<SfxName, [depth: number, hold: number]>> = {
  crack: [0.5, 0.5],
  cheer: [0.45, 0.7],
}

/** Impacts that feed the combo pitch ladder. */
const LADDER_IMPACTS: Partial<Record<SfxName, true>> = { splat: true, thunk: true, crack: true }

/** How long a streak of hits stays hot before the ladder resets. */
const STREAK_WINDOW = 1.2

/** D major pentatonic, matching the score, so combos never clash with it. */
const PENTATONIC = [0, 2, 4, 7, 9]

/**
 * Where the ladder stops climbing. A combo has no upper bound, and left to run
 * it would walk the chime straight past the top of hearing and into aliasing —
 * so the last couple of octaves are worth having, and everything above them is
 * not.
 */
const LADDER_TOP = 11

function pentatonicSemitones(index: number) {
  const step = Math.min(LADDER_TOP, Math.max(0, Math.floor(index)))
  return PENTATONIC[step % PENTATONIC.length] + Math.floor(step / PENTATONIC.length) * 12
}

/**
 * All sound is synthesized with the Web Audio API — no audio files, no
 * dependencies. The context is created lazily on the first user gesture
 * (required on iOS) and resumed whenever the tab regains focus.
 *
 * The mix is built like a small studio desk. Effects run through their own bus
 * into a glue compressor, and everything lands on a master limiter so a dozen
 * simultaneous smashes get louder without ever clipping. Two sends hang off the
 * side: a convolution reverb built from a synthesized impulse (the valley), and
 * a filtered slap-back delay that only the biggest events are allowed to use.
 *
 * Effects can be placed in the world — `playAt` pans them, attenuates them,
 * rolls their highs off with distance and pushes them further into the reverb,
 * so a tree cracking across the meadow sounds like it's over there rather than
 * like a quieter version of one at your feet.
 */
export class SoundManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private reverbSend: GainNode | null = null
  private echoSend: GainNode | null = null
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

  /** When each effect last fired, for thinning rapid repeats. */
  private readonly lastFired = new Map<SfxName, number>()
  private streak = 0
  private lastImpact = -99

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
      this.buildMix(this.ctx)

      this.music = new MusicDirector(this.ctx, this.master!)
      this.ambience = new AmbienceBed(this.ctx, this.master!)
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

  private buildMix(ctx: AudioContext) {
    // Master limiter. Nothing downstream of this can clip the output, which is
    // what lets every effect be mixed for punch rather than for headroom.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 6
    limiter.ratio.value = 14
    limiter.attack.value = 0.003
    limiter.release.value = 0.22
    limiter.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = this._muted ? 0 : 0.5
    master.connect(limiter)
    this.master = master

    // Glue for the effects. Slow enough on the attack to let transients through
    // — a fast compressor here would flatten the very crack we're building.
    const glue = ctx.createDynamicsCompressor()
    glue.threshold.value = -12
    glue.knee.value = 12
    glue.ratio.value = 3.5
    glue.attack.value = 0.005
    glue.release.value = 0.18
    glue.connect(master)

    const sfxBus = ctx.createGain()
    sfxBus.gain.value = 0.9
    sfxBus.connect(glue)
    this.sfxBus = sfxBus

    const convolver = ctx.createConvolver()
    convolver.buffer = valleyImpulse(ctx)
    const reverbReturn = ctx.createGain()
    reverbReturn.gain.value = 0.85
    convolver.connect(reverbReturn)
    reverbReturn.connect(master)

    const reverbSend = ctx.createGain()
    reverbSend.gain.value = 1
    reverbSend.connect(convolver)
    this.reverbSend = reverbSend

    // Slap-back off the far side of the valley: dark, and it decays away fast.
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.27
    const damping = ctx.createBiquadFilter()
    damping.type = 'lowpass'
    damping.frequency.value = 1300
    const feedback = ctx.createGain()
    feedback.gain.value = 0.3
    delay.connect(damping)
    damping.connect(feedback)
    feedback.connect(delay)

    const echoReturn = ctx.createGain()
    echoReturn.gain.value = 0.5
    damping.connect(echoReturn)
    echoReturn.connect(master)
    // The repeats also wash into the reverb, which blurs them into the distance.
    echoReturn.connect(reverbSend)

    const echoSend = ctx.createGain()
    echoSend.gain.value = 1
    echoSend.connect(delay)
    this.echoSend = echoSend
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

  play(name: SfxName, options?: PlayOptions) {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || this._muted || ctx.state !== 'running') return
    this.emit(name, this.sfxBus, 1, options)
  }

  /** Play an effect positioned in the world, panned and attenuated. */
  playAt(name: SfxName, x: number, z: number, options?: PlayOptions) {
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

    // Air swallows the highs long before it swallows the lows. Rolling them off
    // with distance is most of what makes a far-off crack read as far off.
    const air = ctx.createBiquadFilter()
    air.type = 'lowpass'
    air.frequency.value = Math.max(1400, 19000 * Math.pow(0.5, distance / 7))
    air.Q.value = 0.5

    const panner = ctx.createStereoPanner()
    panner.pan.value = pan

    gain.connect(air)
    air.connect(panner)
    panner.connect(bus)

    // The further away it is, the more of it you hear as reflection rather than
    // as the thing itself — the other half of the distance cue.
    this.emit(name, gain, Math.min(3.2, 1 + distance * 0.09), options)
  }

  /**
   * Build a voice for one event and hand it to the instrument.
   *
   * `space` scales the send levels the instrument asks for; everything else here
   * is about keeping a burst of simultaneous events from turning to mud.
   */
  private emit(name: SfxName, dry: AudioNode, space: number, options?: PlayOptions) {
    const ctx = this.ctx
    const build = SFX[name]
    if (!ctx || !this.reverbSend || !this.echoSend || !build) return

    const now = ctx.currentTime
    let gain = options?.gain ?? 1
    let start = now
    let pitch = options?.pitch ?? 1

    // Repeat thinning. Five lemons bursting on one swing should sound like a
    // handful of fruit, not like the same sample played five times — so stacked
    // repeats come in quieter and a few milliseconds apart, which also keeps
    // their transients from lining up into one harsh spike.
    const previous = this.lastFired.get(name)
    if (previous !== undefined && now - previous < 0.06) {
      gain *= now - previous < 0.02 ? 0.45 : 0.62
      start += Math.random() * 0.012
    }
    this.lastFired.set(name, now)

    // The combo ladder: keep landing hits and the impacts climb a scale.
    if (LADDER_IMPACTS[name]) {
      this.streak = now - this.lastImpact < STREAK_WINDOW ? Math.min(this.streak + 1, 12) : 0
      this.lastImpact = now
      pitch *= Math.pow(2, Math.min(this.streak, 10) * 0.42 / 12)
    }

    if (options?.level !== undefined) {
      pitch *= Math.pow(2, pentatonicSemitones(options.level - 1) / 12)
    }

    const reverbTap = ctx.createGain()
    reverbTap.gain.value = space
    reverbTap.connect(this.reverbSend)

    const echoTap = ctx.createGain()
    echoTap.gain.value = space
    echoTap.connect(this.echoSend)

    const voice: Voice = {
      ctx,
      out: dry,
      reverb: reverbTap,
      echo: echoTap,
      now: start,
      rand: Math.random(),
      gain,
      pitch,
    }
    build(voice)

    const duck = DUCKERS[name]
    if (duck) this.music?.duck(duck[0], duck[1])
  }
}
