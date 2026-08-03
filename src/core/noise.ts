import type { Rng } from './rng'

/**
 * 2D gradient noise (Perlin-style) with a seeded permutation table, plus fbm.
 *
 * The terrain height field is evaluated on the CPU for both the collision/gameplay
 * queries and the mesh build, so there is exactly one source of truth for "where
 * is the ground" — no vertex-shader displacement that the simulation can't see.
 */

const GRADIENTS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, 0.7071],
  [0.7071, -0.7071],
  [-0.7071, -0.7071],
]

export type Noise2D = (x: number, y: number) => number

export function createNoise2D(rng: Rng): Noise2D {
  const permutation = new Uint8Array(512)
  const source = new Uint8Array(256)
  for (let index = 0; index < 256; index += 1) source[index] = index
  // Fisher-Yates with the seeded rng keeps the field reproducible.
  for (let index = 255; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const temp = source[index]
    source[index] = source[swap]
    source[swap] = temp
  }
  for (let index = 0; index < 512; index += 1) permutation[index] = source[index & 255]

  const gradientAt = (hash: number, x: number, y: number) => {
    const gradient = GRADIENTS[hash & 7]
    return gradient[0] * x + gradient[1] * y
  }

  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const cellX = xi & 255
    const cellY = yi & 255

    // Quintic fade — C2 continuous, so lighting normals stay smooth.
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)

    const aa = permutation[permutation[cellX] + cellY]
    const ab = permutation[permutation[cellX] + cellY + 1]
    const ba = permutation[permutation[cellX + 1] + cellY]
    const bb = permutation[permutation[cellX + 1] + cellY + 1]

    const x1 = gradientAt(aa, xf, yf) + u * (gradientAt(ba, xf - 1, yf) - gradientAt(aa, xf, yf))
    const x2 =
      gradientAt(ab, xf, yf - 1) +
      u * (gradientAt(bb, xf - 1, yf - 1) - gradientAt(ab, xf, yf - 1))

    // Roughly [-1, 1].
    return (x1 + v * (x2 - x1)) * 1.4
  }
}

export interface FbmOptions {
  octaves?: number
  lacunarity?: number
  gain?: number
  frequency?: number
  amplitude?: number
}

/** Fractal Brownian motion — layered noise for natural-looking rolling terrain. */
export function fbm(noise: Noise2D, x: number, y: number, options: FbmOptions = {}) {
  const { octaves = 4, lacunarity = 2.03, gain = 0.5, frequency = 1, amplitude = 1 } = options
  let sum = 0
  let normalization = 0
  let currentFrequency = frequency
  let currentAmplitude = amplitude

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise(x * currentFrequency, y * currentFrequency) * currentAmplitude
    normalization += currentAmplitude
    currentFrequency *= lacunarity
    currentAmplitude *= gain
  }

  return normalization === 0 ? 0 : sum / normalization
}

/**
 * Ridged variant — sharp creases instead of smooth blobs. Used sparingly for the
 * rocky valley rim so it doesn't read as the same soft dough as the meadow.
 */
export function ridged(noise: Noise2D, x: number, y: number, options: FbmOptions = {}) {
  const { octaves = 3, lacunarity = 2.1, gain = 0.5, frequency = 1 } = options
  let sum = 0
  let normalization = 0
  let currentFrequency = frequency
  let currentAmplitude = 1

  for (let octave = 0; octave < octaves; octave += 1) {
    const value = 1 - Math.abs(noise(x * currentFrequency, y * currentFrequency))
    sum += value * value * currentAmplitude
    normalization += currentAmplitude
    currentFrequency *= lacunarity
    currentAmplitude *= gain
  }

  return normalization === 0 ? 0 : sum / normalization
}
