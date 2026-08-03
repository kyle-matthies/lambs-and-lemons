import { Color, Vector2, Vector3, type IUniform, type Material, type Texture } from 'three'
import { SOUR_TINT } from './palette'

/**
 * The shared shading language of the valley, injected into stock three materials
 * via `onBeforeCompile` so we keep real PBR lighting and shadows while adding:
 *
 *  - **Bloom** — every surface samples a world-space splat map and lerps between a
 *    drained, sour grey and its full colour. This is the game's signature: smashing
 *    lemons literally paints colour back into the world.
 *  - **Wind** — world-space sway driven by an `aSway` weight (0 at the root, 1 at
 *    the tips), so grass, leaves and reeds all breathe on the same gust.
 *  - **Player bend** — grass pushes away from Lammy as she runs through it.
 *  - **Rim light** — a cheap wrap term that keeps silhouettes readable against the
 *    sky and gives the whole scene its storybook softness.
 *
 * Every material shares the *same* uniform objects by reference, so updating
 * `uniforms.uTime.value` once per frame updates all of them.
 */

export interface ValleyUniforms {
  uTime: IUniform<number>
  uBloomMap: IUniform<Texture | null>
  uBloomOrigin: IUniform<Vector2>
  uBloomInvSize: IUniform<number>
  uBloomGain: IUniform<number>
  uBloomFloor: IUniform<number>
  uSourTint: IUniform<Color>
  uWindDir: IUniform<Vector2>
  uWindStrength: IUniform<number>
  uPlayerPos: IUniform<Vector3>
  uRimColor: IUniform<Color>
  uRimStrength: IUniform<number>
  /** Direction *to* the sun, in view space. Drives the translucency term. */
  uSunViewDirection: IUniform<Vector3>
}

export function createValleyUniforms(): ValleyUniforms {
  return {
    uTime: { value: 0 },
    uBloomMap: { value: null },
    uBloomOrigin: { value: new Vector2(-48, -48) },
    uBloomInvSize: { value: 1 / 96 },
    uBloomGain: { value: 1 },
    uBloomFloor: { value: 0 },
    uSourTint: { value: SOUR_TINT.clone() },
    uWindDir: { value: new Vector2(0.82, 0.57) },
    uWindStrength: { value: 1 },
    uPlayerPos: { value: new Vector3() },
    uRimColor: { value: new Color('#ffe9bd') },
    uRimStrength: { value: 0.22 },
    uSunViewDirection: { value: new Vector3(0, 1, 0) },
  }
}

export interface ValleyShadingOptions {
  /**
   * Per-material override that forces a surface to count as healed regardless of
   * what the world bloom map says at its position. Creatures need this: once
   * you've given one a cup it stays in colour even while standing in grey grass.
   */
  localHeal?: IUniform<number>
  /**
   * Per-material 0-1 visibility. Below 1 the surface dissolves through an ordered
   * dither rather than turning transparent — screen-door fade keeps it in the
   * opaque pass, so it still sorts and still casts shadows correctly. Used to
   * dissolve trees that get between the camera and Lammy.
   */
  fade?: IUniform<number>
  /** Sway amplitude in metres at full gust. 0 disables the wind path entirely. */
  wind?: number
  /** Read per-vertex `aSway` instead of falling back to local Y. */
  swayAttribute?: boolean
  /** Radius in metres over which Lammy flattens the grass. 0 disables. */
  playerBend?: number
  /** Participate in the grey→colour bloom. Sky and UI props opt out. */
  bloom?: boolean
  /** Extra bloom the material always has, e.g. lemons are never fully drained. */
  bloomFloor?: number
  rim?: number
  /** Sway phase jitter so neighbouring props don't move in lockstep. */
  phaseAttribute?: boolean
}

const VERTEX_DECLARATIONS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uPlayerPos;
varying vec3 vWorldPosition;
#ifdef VLY_SWAY_ATTRIBUTE
attribute float aSway;
#endif
#ifdef VLY_PHASE_ATTRIBUTE
attribute float aPhase;
#endif
`

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform sampler2D uBloomMap;
uniform vec2 uBloomOrigin;
uniform float uBloomInvSize;
uniform float uBloomGain;
uniform float uBloomFloor;
uniform vec3 uSourTint;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform vec3 uSunViewDirection;
varying vec3 vWorldPosition;
`

const LOCAL_HEAL_DECLARATION = /* glsl */ `
uniform float uLocalHeal;
`

const FADE_DECLARATION = /* glsl */ `
uniform float uFade;

// 4x4 ordered Bayer threshold, built by the standard recursive construction as
// pure arithmetic. The obvious version — a 16-entry array indexed in a loop —
// costs a dynamic-indexed lookup on *every foliage fragment* and tanked the
// frame rate; this is a dozen ALU ops with no branches and no array.
float vlyBayer2( vec2 a ) {
  vec2 p = floor( mod( a, 2.0 ) );
  return 2.0 * p.x + 3.0 * p.y - 4.0 * p.x * p.y;
}

float vlyDither( vec2 coord ) {
  return ( vlyBayer2( coord ) * 4.0 + vlyBayer2( coord * 0.5 ) ) / 16.0;
}
`

const FADE_CHUNK = /* glsl */ `
  if ( uFade < 0.999 ) {
    if ( uFade < vlyDither( gl_FragCoord.xy ) ) discard;
  }
`

function projectChunk(options: ValleyShadingOptions) {
  const wind = options.wind ?? 0
  const bend = options.playerBend ?? 0

  return /* glsl */ `
  vec4 vlyLocal = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    vlyLocal = batchingMatrix * vlyLocal;
  #endif
  #ifdef USE_INSTANCING
    vlyLocal = instanceMatrix * vlyLocal;
  #endif
  vec4 vlyWorld = modelMatrix * vlyLocal;

  #ifdef VLY_SWAY_ATTRIBUTE
    float vlySway = aSway;
  #else
    float vlySway = clamp( position.y, 0.0, 1.0 );
  #endif
  #ifdef VLY_PHASE_ATTRIBUTE
    float vlyPhase = aPhase;
  #else
    float vlyPhase = 0.0;
  #endif

  ${
    wind > 0
      ? /* glsl */ `
  {
    float t = uTime * 1.35 + vlyPhase;
    // Two detuned waves plus a slow gust envelope reads as air, not a metronome.
    float travel = vlyWorld.x * 0.21 + vlyWorld.z * 0.17;
    float gust = 0.55 + 0.45 * sin( uTime * 0.31 + travel * 0.35 );
    float wave = sin( t + travel ) * 0.62 + sin( t * 1.71 + travel * 1.9 ) * 0.38;
    float amount = wave * gust * uWindStrength * ${wind.toFixed(3)} * vlySway * vlySway;
    vlyWorld.x += uWindDir.x * amount;
    vlyWorld.z += uWindDir.y * amount;
    vlyWorld.y -= abs( amount ) * 0.28;
  }`
      : ''
  }
  ${
    bend > 0
      ? /* glsl */ `
  {
    vec2 away = vlyWorld.xz - uPlayerPos.xz;
    float dist = length( away );
    float push = smoothstep( ${bend.toFixed(2)}, 0.0, dist ) * vlySway;
    vlyWorld.xz += normalize( away + vec2( 1e-4 ) ) * push * 0.62;
    vlyWorld.y -= push * 0.34;
  }`
      : ''
  }

  vWorldPosition = vlyWorld.xyz;
  vec4 mvPosition = viewMatrix * vlyWorld;
  gl_Position = projectionMatrix * mvPosition;
`
}

function bloomChunk(options: ValleyShadingOptions) {
  if (options.bloom === false) return ''
  const floor = options.bloomFloor ?? 0
  return /* glsl */ `
  {
    vec2 bloomUv = ( vWorldPosition.xz - uBloomOrigin ) * uBloomInvSize;
    float healed = texture2D( uBloomMap, bloomUv ).r;
    healed = clamp( healed * uBloomGain + uBloomFloor + ${floor.toFixed(3)}, 0.0, 1.0 );
${options.localHeal ? '    healed = max( healed, uLocalHeal );' : ''}
    // Ease the ramp so the leading edge of a splat reads as a soft wash of colour
    // returning rather than a hard circle.
    healed = healed * healed * ( 3.0 - 2.0 * healed );

    // The sour look is a *cool overcast*, not a grey mush: keep the luminance
    // structure (so foliage never crushes to black), pull most of the saturation,
    // shift blue, then lift the blacks and compress contrast like flat morning
    // light. Colour coming back should feel like the sun arriving.
    float luma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 sour = mix( diffuseColor.rgb, vec3( luma ), 0.78 ) * uSourTint;
    sour = sour * 0.7 + 0.075;

    // Just past the wavefront, colour overshoots a touch before settling — that
    // little bloom of over-saturation is what sells the healing.
    float surge = smoothstep( 0.25, 0.62, healed ) * ( 1.0 - smoothstep( 0.62, 1.0, healed ) );
    vec3 vivid = mix( vec3( luma ), diffuseColor.rgb, 1.0 + surge * 0.55 );

    diffuseColor.rgb = mix( sour, vivid, healed );
  }
`
}

function rimChunk(options: ValleyShadingOptions) {
  const rim = options.rim ?? 1
  if (rim <= 0) return ''
  return /* glsl */ `
  {
    vec3 viewDir = normalize( vViewPosition );
    float edge = pow( 1.0 - clamp( dot( viewDir, normal ), 0.0, 1.0 ), 2.5 );

    // Forward scatter: sunlight punching *through* a thin surface toward the
    // camera. This is what makes backlit grass and leaves glow, and it is why the
    // term is tinted by the surface's own colour instead of a flat cream — a rim
    // that ignores albedo just paints everything the same washed-out tan.
    float through = pow( clamp( dot( viewDir, -uSunViewDirection ), 0.0, 1.0 ), 3.0 );

    vec3 scatter = uRimColor * diffuseColor.rgb;
    reflectedLight.indirectDiffuse +=
      edge * ( 0.35 + through * 2.4 ) * uRimStrength * ${rim.toFixed(2)} * scatter;
  }
`
}

/**
 * Wire a stock three material into the valley shading system. Safe to call on
 * `MeshStandardMaterial`, `MeshPhysicalMaterial` and friends.
 */
export function applyValleyShading(
  material: Material,
  uniforms: ValleyUniforms,
  options: ValleyShadingOptions = {},
) {
  const { localHeal, fade, ...cacheableOptions } = options
  const key = [
    JSON.stringify(cacheableOptions),
    localHeal ? 'local' : 'world',
    fade ? 'fade' : 'solid',
  ].join(':')

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    if (options.localHeal) shader.uniforms.uLocalHeal = options.localHeal
    if (options.fade) shader.uniforms.uFade = options.fade

    let defines = ''
    if (options.swayAttribute) defines += '#define VLY_SWAY_ATTRIBUTE\n'
    if (options.phaseAttribute) defines += '#define VLY_PHASE_ATTRIBUTE\n'

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${defines}${VERTEX_DECLARATIONS}\n#include <common>`)
      .replace('#include <project_vertex>', projectChunk(options))

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `${FRAGMENT_DECLARATIONS}${options.localHeal ? LOCAL_HEAL_DECLARATION : ''}${
          options.fade ? FADE_DECLARATION : ''
        }\n#include <common>`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${options.fade ? FADE_CHUNK : ''}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${bloomChunk(options)}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${rimChunk(options)}`,
      )
  }

  // Without this three would reuse one compiled program across materials whose
  // injected source actually differs.
  material.customProgramCacheKey = () => `valley:${key}`
  material.needsUpdate = true
  return material
}
