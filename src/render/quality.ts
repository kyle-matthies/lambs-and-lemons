export type QualityTier = 'low' | 'medium' | 'high'

export interface QualitySettings {
  tier: QualityTier
  /** Hard cap on devicePixelRatio — the single biggest mobile perf lever. */
  maxPixelRatio: number
  shadows: boolean
  shadowMapSize: number
  /** Grass tufts; each renders three blades. */
  grassTufts: number
  grassRadius: number
  furShells: number
  postProcessing: boolean
  bloomStrength: number
  depthOfField: boolean
  waterReflections: boolean
  maxParticles: number
  /** Anisotropy request for the few tiled textures we generate. */
  anisotropy: number
}

const PRESETS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  low: {
    maxPixelRatio: 1.25,
    shadows: false,
    shadowMapSize: 1024,
    grassTufts: 6500,
    grassRadius: 20,
    furShells: 0,
    postProcessing: false,
    bloomStrength: 0,
    depthOfField: false,
    waterReflections: false,
    maxParticles: 220,
    anisotropy: 1,
  },
  medium: {
    maxPixelRatio: 1.75,
    shadows: true,
    shadowMapSize: 1536,
    grassTufts: 16000,
    grassRadius: 26,
    furShells: 3,
    postProcessing: true,
    bloomStrength: 0.42,
    depthOfField: false,
    waterReflections: false,
    maxParticles: 520,
    anisotropy: 4,
  },
  high: {
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    grassTufts: 27000,
    grassRadius: 32,
    furShells: 6,
    postProcessing: true,
    bloomStrength: 0.55,
    depthOfField: true,
    waterReflections: true,
    maxParticles: 900,
    anisotropy: 8,
  },
}

export function settingsFor(tier: QualityTier): QualitySettings {
  return { tier, ...PRESETS[tier] }
}

/**
 * First guess at what this device can handle. Deliberately conservative — the
 * renderer watches frame time and steps the tier down if the guess was wrong,
 * which is far kinder than shipping a slideshow to a mid-range phone.
 */
export function detectQualityTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'medium'

  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4
  const coarsePointer =
    typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) return 'medium'
  if (cores <= 4 || memory <= 3) return 'low'
  if (coarsePointer) return cores >= 8 && memory >= 6 ? 'high' : 'medium'
  return cores >= 8 ? 'high' : 'medium'
}

/** True when the player has asked the OS to keep animation calm. */
export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high']

export function stepTier(tier: QualityTier, direction: -1 | 1): QualityTier {
  const index = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, index + direction))]
}
