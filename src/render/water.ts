import {
  BufferAttribute,
  CircleGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { World } from '../game/world'
import { PALETTE } from './palette'

/**
 * The pond.
 *
 * Depth is baked into a vertex attribute at build time (we already know the terrain
 * height analytically), which buys the two things that make water read as water —
 * colour that deepens away from the bank, and foam that hugs the shoreline — without
 * a depth pre-pass or a single extra texture fetch.
 */

const VERTEX = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec2 vWorldXZ;
varying vec3 vWorldPosition;

uniform float uTime;

void main() {
  vDepth = aDepth;
  vec4 world = modelMatrix * vec4( position, 1.0 );

  // Two crossing swells, damped in the shallows so the bank stays put.
  float shallow = smoothstep( 0.0, 0.7, aDepth );
  float swell =
    sin( world.x * 1.35 + uTime * 1.15 ) * 0.028 +
    sin( world.z * 1.72 - uTime * 0.87 ) * 0.022;
  world.y += swell * shallow;

  vWorldXZ = world.xz;
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSkyTint;
uniform vec3 uSunDirection;
uniform float uTime;
uniform float uHeal;

varying float vDepth;
varying vec2 vWorldXZ;
varying vec3 vWorldPosition;

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

/** Ripple height field. Sampled three times to build a normal by difference. */
float ripples( vec2 p, float t ) {
  return
    sin( p.x * 2.3 + t * 1.35 ) * 0.5 +
    sin( p.y * 2.9 - t * 1.05 ) * 0.4 +
    vnoise( p * 1.7 + vec2( t * 0.13, -t * 0.09 ) ) * 0.9;
}

void main() {
  float depth = clamp( vDepth, 0.0, 1.0 );

  // Base colour: clear at the bank, saturated in the middle.
  vec3 color = mix( uShallow, uDeep, smoothstep( 0.04, 0.8, depth ) );

  // Surface normal from the ripple field. Without this the pond is a flat disc
  // of one colour and nothing on it catches the light.
  float e = 0.16;
  float h = ripples( vWorldXZ, uTime );
  float hx = ripples( vWorldXZ + vec2( e, 0.0 ), uTime );
  float hz = ripples( vWorldXZ + vec2( 0.0, e ), uTime );
  // Ripples flatten out in the shallows where the bed damps them.
  float amplitude = 0.09 * smoothstep( 0.0, 0.45, depth );
  vec3 normal = normalize( vec3( -( hx - h ) * amplitude / e, 1.0, -( hz - h ) * amplitude / e ) );

  vec3 viewDir = normalize( cameraPosition - vWorldPosition );

  // Fresnel against the *perturbed* normal, so the sky reflection breaks up
  // across the ripples instead of washing the whole surface evenly.
  float fresnel = pow( 1.0 - clamp( dot( viewDir, normal ), 0.0, 1.0 ), 3.2 );
  color = mix( color, uSkyTint, fresnel * 0.42 );

  // Sun on the water: a broad sheen plus a tight glitter.
  vec3 halfway = normalize( uSunDirection + viewDir );
  float sheen = pow( clamp( dot( normal, halfway ), 0.0, 1.0 ), 24.0 );
  float glitter = pow( clamp( dot( normal, halfway ), 0.0, 1.0 ), 220.0 );
  color += vec3( 1.0, 0.97, 0.88 ) * ( sheen * 0.22 + glitter * 0.9 );

  // Light bouncing off the bed, brightest where the water is thin.
  float caustic = vnoise( vWorldXZ * 3.1 + vec2( uTime * 0.19, -uTime * 0.14 ) );
  color += vec3( 0.16, 0.26, 0.22 ) * pow( caustic, 4.0 ) * ( 1.0 - depth * 0.7 );

  // Shoreline foam: a wavering band where the water gets thin.
  float wobble = vnoise( vWorldXZ * 4.6 + uTime * 0.4 ) * 0.05;
  float foam = smoothstep( 0.13 + wobble, 0.02, depth );
  color = mix( color, uFoam, foam * 0.75 );

  // Fade out completely at the waterline — anything else leaves a hard rim of
  // half-opaque blue sitting on the grass.
  float alpha = smoothstep( 0.0, 0.07, depth ) * mix( 0.62, 0.96, smoothstep( 0.0, 0.4, depth ) );
  alpha = max( alpha, foam * smoothstep( 0.0, 0.03, depth ) );

  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = mix( mix( vec3( luma ), vec3( 0.55, 0.6, 0.63 ) * ( 0.5 + luma * 0.7 ), 0.5 ), color, uHeal );

  gl_FragColor = vec4( color, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class Water {
  readonly mesh: Mesh
  private readonly material: ShaderMaterial

  constructor(world: World) {
    const radius = world.pond.radius * 1.24
    const geometry = new CircleGeometry(radius, 72, 0, Math.PI * 2)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(world.pond.x, world.waterLevel, world.pond.z)

    // Bake how deep the water is at every vertex.
    const position = geometry.attributes.position as BufferAttribute
    const depths = new Float32Array(position.count)
    for (let index = 0; index < position.count; index += 1) {
      const bed = world.heightAt(position.getX(index), position.getZ(index))
      depths[index] = Math.max(0, world.waterLevel - bed) / world.pond.depth
    }
    geometry.setAttribute('aDepth', new BufferAttribute(depths, 1))

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uShallow: { value: PALETTE.water.clone() },
        uDeep: { value: PALETTE.waterDeep.clone() },
        uFoam: { value: PALETTE.waterFoam.clone() },
        uSkyTint: { value: PALETTE.skyHorizon.clone() },
        uSunDirection: { value: new Vector3(0.52, 0.62, 0.58).normalize() },
        uTime: { value: 0 },
        uHeal: { value: 0 },
      },
    })

    this.mesh = new Mesh(geometry, this.material)
    this.mesh.name = 'water'
    this.mesh.renderOrder = 2
    this.mesh.receiveShadow = false
  }

  setSunDirection(direction: Vector3) {
    ;(this.material.uniforms.uSunDirection.value as Vector3).copy(direction).normalize()
  }


  update(time: number, heal: number) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uHeal.value = heal
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
