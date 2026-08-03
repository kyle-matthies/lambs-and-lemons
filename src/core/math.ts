/**
 * Small, dependency-free math helpers shared by the simulation and the renderer.
 * Nothing here touches the DOM or three.js — the game logic stays portable.
 */

export const TAU = Math.PI * 2

export function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}

export function clamp01(value: number) {
  return clamp(value, 0, 1)
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function inverseLerp(a: number, b: number, value: number) {
  return a === b ? 0 : (value - a) / (b - a)
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01(inverseLerp(edge0, edge1, x))
  return t * t * (3 - 2 * t)
}

/**
 * Frame-rate independent exponential approach. `lambda` is roughly "how many
 * e-folds per second" — bigger is snappier. Use this instead of `lerp(a, b, 0.1)`
 * in update loops, which silently changes feel with the frame rate.
 */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt))
}

/** Shortest signed distance from `a` to `b` on the unit circle, in radians. */
export function angleDelta(a: number, b: number) {
  let delta = (b - a) % TAU
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  return delta
}

export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt))
}

export function distance2D(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz)
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutBack(t: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** Bell curve peaking at t = 0.5. Handy for one-shot squash/stretch. */
export function pulse(t: number) {
  return Math.sin(clamp01(t) * Math.PI)
}
