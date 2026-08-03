import { Color, Vector3 } from 'three'
import { clamp01, lerp, smoothstep } from '../core/math'
import { PALETTE } from './palette'

/**
 * The valley's sky, on two independent axes.
 *
 * **Recovery** (0 → 1) is how much colour the player has brought back: it takes
 * the light from a cold, flat, pre-dawn key to a warm one and pushes the haze
 * out to the hills.
 *
 * **Dusk** (0 → 1) is how much of the round has elapsed. The HUD calls the timer
 * "Sunset", so the sun had better actually set: it sinks toward the horizon,
 * warms through gold to a deep orange, and drags long shadows across the meadow
 * behind it.
 *
 * Keeping them separate is what makes the endgame read — a valley you healed at
 * the last minute is warm *and* low, lit like a summer evening, while one you
 * never got to is cold and low, which looks like the light leaving.
 */

/** Where the sun sits at the start of a round and where it ends up. */
const NOON = new Vector3(0.52, 0.62, 0.58).normalize()
// Not *quite* on the horizon. A grazing sun stretches shadows past anything a
// single shadow map can hold, and they clip rather than lengthen. This is low
// enough to rake across the meadow and still be castable.
const HORIZON = new Vector3(0.72, 0.3, 0.68).normalize()

const SUN_DAY = new Color('#fff0cd')
const SUN_GOLD = new Color('#ffc978')
const SUN_EMBER = new Color('#ff9a4d')

const ZENITH_DAY = new Color('#2f8ede')
const ZENITH_DUSK = new Color('#20386b')
const HORIZON_DAY = new Color('#a9dcff')
const HORIZON_DUSK = new Color('#ff9f66')
const GLOW_DAY = new Color('#ffe4a8')
const GLOW_DUSK = new Color('#ff8a4a')
const FOG_DUSK = new Color('#c58f70')

export interface DaylightState {
  direction: Vector3
  sunColor: Color
  sunIntensity: number
  skyZenith: Color
  skyHorizon: Color
  skyGlow: Color
  hemisphereSky: Color
  hemisphereGround: Color
  hemisphereIntensity: number
  fogColor: Color
  fogNear: number
  fogFar: number
  exposure: number
  rimStrength: number
  /** 0 → 1 across the last stretch of the round; drives fireflies. */
  duskGlow: number
}

export function createDaylightState(): DaylightState {
  return {
    direction: NOON.clone(),
    sunColor: new Color(),
    sunIntensity: 1,
    skyZenith: new Color(),
    skyHorizon: new Color(),
    skyGlow: new Color(),
    hemisphereSky: new Color(),
    hemisphereGround: new Color(),
    hemisphereIntensity: 1,
    fogColor: new Color(),
    fogNear: 30,
    fogFar: 100,
    exposure: 1.1,
    rimStrength: 0.2,
    duskGlow: 0,
  }
}

/**
 * @param recovery 0-1 how much colour is back
 * @param dusk     0-1 how far through the round we are
 * @param out      mutated in place; nothing here allocates per frame
 */
export function evaluateDaylight(
  recovery: number,
  dusk: number,
  out: DaylightState,
): DaylightState {
  const heal = clamp01(recovery)
  // Hold the sun high for the first half and let it fall away after — a linear
  // descent reads as a sunset that started before anything happened.
  const fall = smoothstep(0.35, 1, clamp01(dusk))
  const ember = smoothstep(0.62, 1, clamp01(dusk))

  out.direction.copy(NOON).lerp(HORIZON, fall).normalize()
  out.duskGlow = ember

  // Sun: cold and weak when the valley is sour, warm and strong when it isn't,
  // then reddening and dimming as it drops.
  out.sunColor.copy(PALETTE.sourSun).lerp(SUN_DAY, heal).lerp(SUN_GOLD, fall).lerp(SUN_EMBER, ember)
  out.sunIntensity = lerp(1.6, 2.5, heal) * lerp(1, 0.4, fall)

  out.skyZenith.copy(ZENITH_DAY).lerp(ZENITH_DUSK, fall)
  out.skyHorizon.copy(HORIZON_DAY).lerp(HORIZON_DUSK, fall)
  out.skyGlow.copy(GLOW_DAY).lerp(GLOW_DUSK, fall)

  // Fill light cools and drops as the sun leaves; the sky is the only source left.
  out.hemisphereSky.copy(PALETTE.sourSky).lerp(PALETTE.skyHorizon, heal).lerp(HORIZON_DUSK, fall * 0.55)
  out.hemisphereGround
    .copy(PALETTE.sourBounce)
    .lerp(PALETTE.bounceLight, heal)
    .lerp(SUN_EMBER, ember * 0.3)
  out.hemisphereIntensity = lerp(1.05, 1.15, heal) * lerp(1, 0.5, ember)

  // Haze retreats as the valley recovers, then warms and closes back in at dusk.
  out.fogColor.copy(PALETTE.sourFog).lerp(PALETTE.fog, heal).lerp(FOG_DUSK, fall * 0.7)
  out.fogNear = lerp(24, 46, heal) * lerp(1, 0.78, fall)
  out.fogFar = lerp(78, 138, heal) * lerp(1, 0.82, fall)

  // It has to actually get dark, or the fireflies have nothing to shine
  // against and "sunset" is just a warm filter. Stops at early twilight — the
  // player still has to be able to find the last creature.
  out.exposure = lerp(1.16, 1.2, heal) * lerp(1, 0.82, ember)
  // Low sun means more of everything is rim-lit — lean into it.
  out.rimStrength = lerp(0.14, 0.26, heal) * lerp(1, 1.55, fall)

  return out
}
