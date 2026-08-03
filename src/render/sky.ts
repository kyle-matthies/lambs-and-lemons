import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { PALETTE } from './palette'

/**
 * A single-draw-call sky: vertical gradient, sun disc with a soft bloom halo, and
 * two layers of drifting procedural cloud. No cubemap, no textures, no downloads.
 *
 * `heal` (0 → 1) drains the whole sky toward an overcast grey when the valley is
 * still sour, so the very first thing the player sees is a world that needs them.
 */

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize( position );
  // Keep the dome centred on the camera and pinned to the far plane.
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uCloudLight;
uniform vec3 uCloudShadow;
uniform vec2 uWind;
uniform float uTime;
uniform float uHeal;
uniform float uCoverage;

varying vec3 vDirection;

float hash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 345.45 ) );
  p += dot( p, p + 34.345 );
  return fract( p.x * p.y );
}

float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash21( i );
  float b = hash21( i + vec2( 1.0, 0.0 ) );
  float c = hash21( i + vec2( 0.0, 1.0 ) );
  float d = hash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

float fbm2( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  for ( int i = 0; i < 5; i ++ ) {
    sum += vnoise( p ) * amp;
    p = p * 2.03 + 17.3;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec3 dir = normalize( vDirection );
  float up = clamp( dir.y, -0.2, 1.0 );

  // Base gradient, with a warm band hugging the horizon.
  float t = pow( clamp( up, 0.0, 1.0 ), 0.52 );
  vec3 sky = mix( uHorizon, uZenith, t );

  float sunDot = max( dot( dir, uSunDirection ), 0.0 );
  sky += uGlow * pow( sunDot, 5.0 ) * 0.55;
  sky += uGlow * pow( sunDot, 48.0 ) * 0.8;

  // Clouds: a slab projection so they flatten toward the horizon like real cover.
  float horizonFade = smoothstep( 0.06, 0.34, dir.y );
  vec2 slab = dir.xz / max( dir.y, 0.075 );
  vec2 drift = uWind * uTime * 0.0065;
  float low = fbm2( slab * 0.42 + drift );
  float high = fbm2( slab * 0.19 - drift * 0.6 + 41.0 );
  float density = low * 0.62 + high * 0.5;
  float cover = smoothstep( uCoverage, uCoverage + 0.32, density ) * horizonFade;

  // Fake self-shadowing: thicker cloud is darker, and the sun side stays bright.
  float thickness = smoothstep( uCoverage, uCoverage + 0.7, density );
  vec3 cloud = mix( uCloudLight, uCloudShadow, thickness * 0.85 );
  cloud += uSunColor * pow( sunDot, 6.0 ) * 0.5 * ( 1.0 - thickness );

  vec3 color = mix( sky, cloud, cover * 0.94 );

  // Sun disc, drawn over the cloud so it reads as light punching through.
  float disc = smoothstep( 0.9982, 0.9993, sunDot );
  color = mix( color, uSunColor, disc * ( 1.0 - cover * 0.55 ) );

  // Sour valley: drain the sky toward flat overcast until the player heals it.
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 drained = mix( vec3( luma ), vec3( 0.62, 0.65, 0.68 ) * ( 0.55 + luma * 0.6 ), 0.55 );
  color = mix( drained, color, uHeal );

  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class Sky {
  readonly mesh: Mesh
  readonly sunDirection = new Vector3()
  private readonly material: ShaderMaterial

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uZenith: { value: PALETTE.skyZenith.clone() },
        uHorizon: { value: PALETTE.skyHorizon.clone() },
        uGlow: { value: PALETTE.skyGlow.clone() },
        uSunColor: { value: PALETTE.sunDisc.clone() },
        uSunDirection: { value: new Vector3(0.52, 0.62, 0.58).normalize() },
        uCloudLight: { value: new Color('#fffdf6') },
        uCloudShadow: { value: new Color('#a9c2d8') },
        uWind: { value: new Vector2(0.82, 0.57) },
        uTime: { value: 0 },
        uHeal: { value: 0 },
        uCoverage: { value: 0.6 },
      },
    })

    this.mesh = new Mesh(new SphereGeometry(1, 32, 20), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1000
    this.mesh.scale.setScalar(400)
    this.sunDirection.copy(this.material.uniforms.uSunDirection.value as Vector3)
  }

  setSunDirection(direction: Vector3) {
    this.sunDirection.copy(direction).normalize()
    ;(this.material.uniforms.uSunDirection.value as Vector3).copy(this.sunDirection)
  }


  update(time: number, heal: number, cameraPosition: Vector3) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uHeal.value = heal
    this.mesh.position.copy(cameraPosition)
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
