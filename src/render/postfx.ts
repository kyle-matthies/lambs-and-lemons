import { Vector2, type Scene, type Camera, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { QualitySettings } from './quality'

/**
 * The grade pass — the last thing between the render and the screen.
 *
 * It does the work that makes stylised 3D read as *illustration* rather than as
 * "some shapes in a game engine": a gentle S-curve for contrast, a lift of
 * saturation, warm highlights against cool shadows, a soft vignette, and a
 * whole-frame desaturation hooked to how sour the valley still is.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uHeal: { value: 1 },
    uVignette: { value: 0.42 },
    uSaturation: { value: 1.16 },
    uContrast: { value: 1.06 },
    uWarmth: { value: 0.05 },
    uFlash: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uHeal;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uFlash;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec3 color = texel.rgb;

      // Split tone: push highlights warm and shadows a touch cool and blue.
      float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color += vec3( uWarmth, uWarmth * 0.55, -uWarmth * 0.35 ) * luma;
      color += vec3( -uWarmth * 0.3, -uWarmth * 0.08, uWarmth * 0.5 ) * ( 1.0 - luma );

      // Contrast around mid grey, then saturation.
      color = ( color - 0.5 ) * uContrast + 0.5;
      luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = mix( vec3( luma ), color, uSaturation );

      // Global sourness — the whole frame is drained until the valley recovers.
      color = mix( vec3( luma ) * 0.94, color, mix( 0.25, 1.0, uHeal ) );

      // Vignette, aspect-corrected so it stays circular on wide screens.
      vec2 centred = ( vUv - 0.5 ) * vec2( max( uAspect, 1.0 ), max( 1.0 / uAspect, 1.0 ) );
      float vignette = 1.0 - uVignette * dot( centred, centred );
      color *= clamp( vignette, 0.0, 1.0 );

      // One-shot white flash for big moments (a grove blooming, a sparkle cup).
      color += uFlash;

      gl_FragColor = vec4( max( color, vec3( 0.0 ) ), texel.a );
    }
  `,
}

export class PostPipeline {
  readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass
  private readonly gradePass: ShaderPass
  private flash = 0

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    settings: QualitySettings,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer)
    this.composer.setSize(width, height)
    this.composer.addPass(new RenderPass(scene, camera))

    this.bloomPass = new UnrealBloomPass(
      new Vector2(width, height),
      settings.bloomStrength,
      // Wide, soft radius — this is atmosphere, not a lens artifact.
      0.85,
      0.72,
    )
    this.composer.addPass(this.bloomPass)

    this.gradePass = new ShaderPass(GradeShader)
    this.gradePass.uniforms.uAspect.value = width / Math.max(1, height)
    this.composer.addPass(this.gradePass)

    this.composer.addPass(new OutputPass())
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
    this.bloomPass.setSize(width * pixelRatio, height * pixelRatio)
    this.gradePass.uniforms.uAspect.value = width / Math.max(1, height)
  }

  setQuality(settings: QualitySettings) {
    this.bloomPass.strength = settings.bloomStrength
    this.bloomPass.enabled = settings.bloomStrength > 0
  }

  setHeal(heal: number) {
    this.gradePass.uniforms.uHeal.value = heal
  }

  /** Trigger a quick white bloom-out. Magnitude is in linear light units. */
  addFlash(magnitude: number) {
    this.flash = Math.min(0.85, this.flash + magnitude)
  }

  update(dt: number) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.6)
    }
    this.gradePass.uniforms.uFlash.value = this.flash
  }

  render(delta: number) {
    this.composer.render(delta)
  }

  dispose() {
    this.composer.dispose()
  }
}
