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

void main() {
  float depth = clamp( vDepth, 0.0, 1.0 );

  // Base colour: clear at the bank, saturated in the middle.
  vec3 color = mix( uShallow, uDeep, smoothstep( 0.05, 0.85, depth ) );

  // Caustic-ish shimmer, two layers drifting against each other.
  float shimmer =
    vnoise( vWorldXZ * 1.8 + vec2( uTime * 0.22, uTime * 0.16 ) ) * 0.6 +
    vnoise( vWorldXZ * 3.7 - vec2( uTime * 0.31, uTime * 0.19 ) ) * 0.4;
  color += vec3( 0.16, 0.22, 0.2 ) * pow( shimmer, 3.0 ) * ( 0.35 + depth );

  // Fresnel: glancing angles pick up the sky, straight-down goes to the bed.
  vec3 viewDir = normalize( cameraPosition - vWorldPosition );
  float fresnel = pow( 1.0 - clamp( viewDir.y, 0.0, 1.0 ), 3.4 );
  color = mix( color, uSkyTint, fresnel * 0.34 );

  // Specular glint off the sun.
  vec3 halfway = normalize( uSunDirection + viewDir );
  float glint = pow( clamp( halfway.y, 0.0, 1.0 ), 90.0 );
  color += vec3( 1.0, 0.96, 0.85 ) * glint * 0.55;

  // Shoreline foam: a wavering band where the water gets thin.
  float wobble = vnoise( vWorldXZ * 4.2 + uTime * 0.35 ) * 0.06;
  float foam = smoothstep( 0.1 + wobble, 0.01, depth );
  color = mix( color, uFoam, foam * 0.55 );

  float alpha = mix( 0.72, 0.97, smoothstep( 0.0, 0.35, depth ) );
  alpha = max( alpha, foam * 0.9 );

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
