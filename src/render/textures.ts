import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping } from 'three'
import { createNoise2D, fbm } from '../core/noise'
import { mulberry32 } from '../core/rng'

/**
 * Procedural, tileable textures generated once at boot. Keeps the download at zero
 * bytes while still giving surfaces the fine break-up that stops large flat areas
 * from reading as plastic.
 */

/** Seamless mottled value-noise — multiplied over ground and foliage albedo. */
export function makeDetailTexture(size = 256, seed = 7, contrast = 0.24) {
  const noise = createNoise2D(mulberry32(seed))
  const data = new Uint8Array(size * size * 4)
  const span = 8

  // Standard tileable-noise trick: cross-fade four shifted copies of the field so
  // opposite edges meet exactly.
  const sample = (x: number, y: number) => fbm(noise, x, y, { octaves: 4, frequency: 1 })
  const tileable = (u: number, v: number) => {
    const x = u * span
    const y = v * span
    const wx = x - span
    const wy = y - span
    return (
      (sample(x, y) * (span - x) * (span - y) +
        sample(wx, y) * x * (span - y) +
        sample(x, wy) * (span - x) * y +
        sample(wx, wy) * x * y) /
      (span * span)
    )
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = tileable(x / size, y / size)
      const shade = 1 + value * contrast
      const byte = Math.max(0, Math.min(255, Math.round(shade * 255 * 0.78)))
      const index = (y * size + x) * 4
      data[index] = byte
      data[index + 1] = byte
      data[index + 2] = byte
      data[index + 3] = 255
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/**
 * Soft radial alpha, used for blob shadows and the glow sprites. Cheaper and far
 * softer than a shadow map for the many small props that only need to feel grounded.
 */
export function makeRadialAlphaTexture(size = 128, power = 2.2) {
  const data = new Uint8Array(size * size * 4)
  const centre = (size - 1) / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre
      const dy = (y - centre) / centre
      const distance = Math.min(1, Math.hypot(dx, dy))
      const alpha = Math.round(Math.pow(1 - distance, power) * 255)
      const index = (y * size + x) * 4
      // three's `alphaMap` samples the GREEN channel, so the falloff has to live
      // in RGB as well as A for the texture to work as both alpha and mask.
      data[index] = alpha
      data[index + 1] = alpha
      data[index + 2] = alpha
      data[index + 3] = alpha
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
