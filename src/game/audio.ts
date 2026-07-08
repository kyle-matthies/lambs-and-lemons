import type { GameEvent } from './engine'

type Tone = {
  frequency: number
  endFrequency?: number
  duration: number
  type?: OscillatorType
  gain?: number
}

export class GameAudio {
  private context: AudioContext | null = null
  private muted = false

  constructor(muted: boolean) {
    this.muted = muted
  }

  setMuted(muted: boolean) {
    this.muted = muted
  }

  async unlock() {
    const context = this.getContext()
    if (context?.state === 'suspended') await context.resume()
  }

  play(event: GameEvent) {
    if (this.muted) return
    const context = this.getContext()
    if (!context) return

    switch (event) {
      case 'smash-lemon':
        this.playStack([
          { frequency: 150, endFrequency: 80, duration: 0.08, type: 'triangle', gain: 0.16 },
          { frequency: 520, endFrequency: 260, duration: 0.09, type: 'sawtooth', gain: 0.06 },
        ])
        break
      case 'pickup-lemon':
        this.playStack([{ frequency: 520, endFrequency: 760, duration: 0.08, gain: 0.1 }])
        break
      case 'pickup-leaf':
        this.playStack([{ frequency: 880, endFrequency: 1180, duration: 0.07, type: 'sine', gain: 0.08 }])
        break
      case 'tree-hit':
        this.playStack([
          { frequency: 220, endFrequency: 120, duration: 0.08, type: 'square', gain: 0.13 },
          { frequency: 110, duration: 0.05, type: 'triangle', gain: 0.08 },
        ])
        break
      case 'tree-break':
        this.playSequence([
          { frequency: 180, endFrequency: 90, duration: 0.09, type: 'square', gain: 0.12 },
          { frequency: 330, endFrequency: 560, duration: 0.1, type: 'triangle', gain: 0.1 },
          { frequency: 660, endFrequency: 880, duration: 0.12, type: 'sine', gain: 0.08 },
        ])
        break
      case 'cup-sold':
        this.playSequence([
          { frequency: 660, duration: 0.08, type: 'sine', gain: 0.1 },
          { frequency: 880, duration: 0.1, type: 'sine', gain: 0.09 },
        ])
        break
      case 'round-end':
        this.playSequence([
          { frequency: 520, duration: 0.08, type: 'sine', gain: 0.08 },
          { frequency: 660, duration: 0.08, type: 'sine', gain: 0.08 },
          { frequency: 880, duration: 0.18, type: 'triangle', gain: 0.1 },
        ])
        break
    }
  }

  private getContext() {
    if (this.context) return this.context
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null
    this.context = new AudioContextClass()
    return this.context
  }

  private playStack(tones: Tone[]) {
    tones.forEach((tone) => this.playTone(tone, 0))
  }

  private playSequence(tones: Tone[]) {
    let offset = 0
    tones.forEach((tone) => {
      this.playTone(tone, offset)
      offset += tone.duration * 0.8
    })
  }

  private playTone(tone: Tone, offset: number) {
    const context = this.context
    if (!context) return

    const start = context.currentTime + offset
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = tone.type ?? 'triangle'
    oscillator.frequency.setValueAtTime(tone.frequency, start)
    if (tone.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, tone.endFrequency),
        start + tone.duration,
      )
    }
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(tone.gain ?? 0.09, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + tone.duration + 0.02)
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
