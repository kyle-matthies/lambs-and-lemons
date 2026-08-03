import { Color } from 'three'

/**
 * One place for the valley's colour language. Everything here is authored in
 * sRGB hex and converted by three's colour management on assignment.
 *
 * The palette is deliberately warm and slightly over-saturated — the bloom shader
 * drains it toward `SOUR_TINT` wherever the valley hasn't been healed yet, so the
 * "full colour" end of the ramp has to be generous or the payoff reads as flat.
 */

export const PALETTE = {
  grassDeep: new Color('#3f7d24'),
  grassMid: new Color('#68b437'),
  grassLight: new Color('#9ed653'),
  grassDry: new Color('#c8cf5e'),
  soil: new Color('#8b6239'),
  path: new Color('#c4a878'),
  rock: new Color('#9aa3a8'),
  rockDark: new Color('#6d757a'),

  bark: new Color('#a5713f'),
  barkDark: new Color('#77492a'),
  leafDeep: new Color('#3f8f31'),
  leafMid: new Color('#63bd45'),
  leafLight: new Color('#95dc63'),

  lemon: new Color('#ffcf2e'),
  lemonLight: new Color('#ffe97d'),
  lemonLeaf: new Color('#4fa83d'),

  wool: new Color('#fdf6ea'),
  woolShade: new Color('#e5d8c4'),
  skin: new Color('#f6cdb8'),
  hoof: new Color('#5b4032'),
  malletHead: new Color('#f0e2c8'),
  malletHandle: new Color('#a9713f'),

  standWood: new Color('#c9803f'),
  standWoodDark: new Color('#8f5426'),
  standCloth: new Color('#ff6b5b'),
  standClothAlt: new Color('#fff4dd'),
  juice: new Color('#ffd94a'),

  water: new Color('#42b4c9'),
  waterDeep: new Color('#136683'),
  waterFoam: new Color('#d8f4ff'),

  flowerPink: new Color('#ff8bc4'),
  flowerWhite: new Color('#fffaf0'),
  flowerBlue: new Color('#8db4ff'),
  flowerOrange: new Color('#ffa63d'),

  skyZenith: new Color('#2f8ede'),
  skyHorizon: new Color('#a9dcff'),
  skyGlow: new Color('#ffe4a8'),
  sunDisc: new Color('#fff6d4'),
  sunLight: new Color('#fff0cd'),
  bounceLight: new Color('#a7d878'),
  fog: new Color('#d9eeff'),

  // The sour valley's own light: a cold, flat, pre-dawn key with slate haze.
  sourSun: new Color('#a8bcd8'),
  sourSky: new Color('#93a7bd'),
  sourBounce: new Color('#7d8f93'),
  sourFog: new Color('#95a9ba'),
} as const

/**
 * Multiplier applied to the drained parts of the valley. Cool and slightly blue —
 * the look of a meadow before sunrise, not a black-and-white photo.
 */
export const SOUR_TINT = new Color('#c3d2ee')

export const FLOWER_COLORS = [
  PALETTE.flowerPink,
  PALETTE.flowerWhite,
  PALETTE.flowerBlue,
  PALETTE.flowerOrange,
]
