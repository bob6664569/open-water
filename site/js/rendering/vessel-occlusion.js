import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

export const VESSEL_OCCLUSION_LAYER = 3;

const FULLSCREEN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const OCCLUSION_FRAGMENT = /* glsl */`
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform mat4 uProjection;
  uniform mat4 uProjectionInverse;
  uniform vec2 uResolution;
  uniform float uRadius;
  uniform float uStrength;
  uniform int uSamples;
  varying vec2 vUv;

  vec3 viewPosition(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uProjectionInverse * clip;
    return view.xyz / max(view.w, 0.00001);
  }

  float randomAngle(vec2 pixel) {
    return fract(sin(dot(pixel, vec2(12.9898, 78.233))) * 43758.5453)
      * 6.28318530718;
  }

  void main() {
    float depth = texture2D(tDepth, vUv).x;
    if (depth >= 0.99999) {
      gl_FragColor = vec4(1.0);
      return;
    }

    vec3 origin = viewPosition(vUv, depth);
    vec3 normal = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
    float projectedRadius = uRadius * uProjection[1][1]
      / max(-origin.z, 0.25) * 0.5;
    projectedRadius = clamp(projectedRadius, 2.0 / uResolution.y, 0.08);
    float rotation = randomAngle(gl_FragCoord.xy);
    float occlusion = 0.0;
    float weight = 0.0;

    for (int i = 0; i < 12; i++) {
      if (i >= uSamples) break;
      float fi = float(i);
      float distanceScale = mix(0.28, 1.0, (fi + 0.5) / float(uSamples));
      float angle = rotation + fi * 2.39996323;
      vec2 direction = vec2(cos(angle), sin(angle));
      vec2 sampleUv = clamp(
        vUv + direction * projectedRadius * distanceScale,
        vec2(0.001), vec2(0.999)
      );
      float sampleDepth = texture2D(tDepth, sampleUv).x;
      if (sampleDepth >= 0.99999) continue;
      vec3 delta = viewPosition(sampleUv, sampleDepth) - origin;
      float distanceToSample = length(delta);
      float rangeWeight = 1.0 - smoothstep(uRadius * 0.12, uRadius,
                                           distanceToSample);
      float horizon = max(dot(normal, delta / max(distanceToSample, 0.0001))
                          - 0.08, 0.0);
      occlusion += horizon * rangeWeight;
      weight += rangeWeight;
    }

    float ao = 1.0 - uStrength * occlusion / max(weight, 1.0);
    gl_FragColor = vec4(vec3(clamp(ao, 0.48, 1.0)), 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tOcclusion;
  uniform sampler2D tDepth;
  uniform vec2 uAoTexel;
  uniform float uIntensity;
  varying vec2 vUv;

  void main() {
    vec4 source = texture2D(tDiffuse, vUv);
    float centerDepth = texture2D(tDepth, vUv).x;
    if (centerDepth >= 0.99999) {
      gl_FragColor = source;
      return;
    }

    float ao = texture2D(tOcclusion, vUv).r * 0.4;
    float total = 0.4;
    vec2 offsets[4];
    offsets[0] = vec2(1.0, 0.0);
    offsets[1] = vec2(-1.0, 0.0);
    offsets[2] = vec2(0.0, 1.0);
    offsets[3] = vec2(0.0, -1.0);
    for (int i = 0; i < 4; i++) {
      vec2 sampleUv = clamp(vUv + offsets[i] * uAoTexel,
                            vec2(0.001), vec2(0.999));
      float sampleDepth = texture2D(tDepth, sampleUv).x;
      float depthWeight = 1.0 - smoothstep(0.0004, 0.003,
                                            abs(sampleDepth - centerDepth));
      ao += texture2D(tOcclusion, sampleUv).r * depthWeight * 0.15;
      total += depthWeight * 0.15;
    }
    ao /= max(total, 0.001);
    source.rgb *= mix(1.0, ao, uIntensity);
    gl_FragColor = source;
  }
`;

export function enableVesselOcclusion(object) {
  object.layers.enable(VESSEL_OCCLUSION_LAYER);
}

export class VesselOcclusionPass extends Pass {
  constructor(scene, camera, width, height) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.resolutionScale = 0.5;
    this.viewportWidth = width;
    this.viewportHeight = height;

    this.normalMaterial = new THREE.MeshNormalMaterial({
      blending: THREE.NoBlending,
    });
    this.normalMaterial.depthTest = true;
    this.normalMaterial.depthWrite = true;

    this.gBuffer = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });

    this.aoMaterial = new THREE.ShaderMaterial({
      name: 'VesselOcclusionShader',
      uniforms: {
        tNormal: { value: this.gBuffer.texture },
        tDepth: { value: this.gBuffer.depthTexture },
        uProjection: { value: camera.projectionMatrix },
        uProjectionInverse: { value: camera.projectionMatrixInverse },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 0.65 },
        uStrength: { value: 1.2 },
        uSamples: { value: 8 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: OCCLUSION_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      name: 'VesselOcclusionCompositeShader',
      uniforms: {
        tDiffuse: { value: null },
        tOcclusion: { value: this.aoTarget.texture },
        tDepth: { value: this.gBuffer.depthTexture },
        uAoTexel: { value: new THREE.Vector2(1, 1) },
        uIntensity: { value: 0.45 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.aoMaterial);
    this._clearColor = new THREE.Color();
    this.setSize(width, height);
  }

  setPerformanceBudget({
    vesselOcclusion = false,
    vesselOcclusionScale = 0.5,
    vesselOcclusionSamples = 8,
    vesselOcclusionRadius = 0.65,
    vesselOcclusionIntensity = 0.45,
  } = {}) {
    this.enabled = vesselOcclusion;
    this.aoMaterial.uniforms.uSamples.value = THREE.MathUtils.clamp(
      Math.round(vesselOcclusionSamples), 4, 12,
    );
    this.aoMaterial.uniforms.uRadius.value = vesselOcclusionRadius;
    this.compositeMaterial.uniforms.uIntensity.value = vesselOcclusionIntensity;
    const nextScale = THREE.MathUtils.clamp(vesselOcclusionScale, 0.35, 1);
    if (Math.abs(nextScale - this.resolutionScale) < 0.001) return;
    this.resolutionScale = nextScale;
    this.setSize(this.viewportWidth, this.viewportHeight);
  }

  setSize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    const aoWidth = Math.max(1, Math.round(width * this.resolutionScale));
    const aoHeight = Math.max(1, Math.round(height * this.resolutionScale));
    this.gBuffer.setSize(aoWidth, aoHeight);
    this.aoTarget.setSize(aoWidth, aoHeight);
    this.aoMaterial.uniforms.uResolution.value.set(aoWidth, aoHeight);
    this.compositeMaterial.uniforms.uAoTexel.value.set(1 / aoWidth, 1 / aoHeight);
  }

  render(renderer, writeBuffer, readBuffer) {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._clearColor);
    const previousOverride = this.scene.overrideMaterial;
    const previousLayers = this.camera.layers.mask;

    try {
      this.camera.layers.set(VESSEL_OCCLUSION_LAYER);
      this.scene.overrideMaterial = this.normalMaterial;
      renderer.setRenderTarget(this.gBuffer);
      renderer.setClearColor(0x8080ff, 1);
      renderer.clear(true, true, true);
      renderer.render(this.scene, this.camera);

      this.scene.overrideMaterial = previousOverride;
      this.camera.layers.mask = previousLayers;
      this.aoMaterial.uniforms.uProjection.value.copy(this.camera.projectionMatrix);
      this.aoMaterial.uniforms.uProjectionInverse.value
        .copy(this.camera.projectionMatrixInverse);
      this.quad.material = this.aoMaterial;
      renderer.setRenderTarget(this.aoTarget);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, false, false);
      this.quad.render(renderer);

      this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      this.quad.material = this.compositeMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      if (this.clear) renderer.clear(true, false, false);
      this.quad.render(renderer);
    } finally {
      this.scene.overrideMaterial = previousOverride;
      this.camera.layers.mask = previousLayers;
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(this._clearColor, previousAlpha);
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose() {
    this.gBuffer.dispose();
    this.aoTarget.dispose();
    this.normalMaterial.dispose();
    this.aoMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}
