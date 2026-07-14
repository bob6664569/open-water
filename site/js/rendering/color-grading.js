import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const PROFILES = Object.freeze({
  1: Object.freeze({
    exposure: 0.02,
    saturation: 1.035,
    contrast: 1.006,
    shadows: Object.freeze([0.992, 1.002, 1.014]),
    highlights: Object.freeze([1.026, 1.01, 0.986]),
  }),
  2: Object.freeze({
    exposure: 0,
    saturation: 1.005,
    contrast: 1.012,
    shadows: Object.freeze([0.988, 1, 1.014]),
    highlights: Object.freeze([1.012, 1.006, 0.994]),
  }),
  3: Object.freeze({
    exposure: -0.01,
    saturation: 0.96,
    contrast: 1.028,
    shadows: Object.freeze([0.968, 0.994, 1.025]),
    highlights: Object.freeze([0.992, 1, 1.012]),
  }),
  4: Object.freeze({
    exposure: -0.025,
    saturation: 0.875,
    contrast: 1.045,
    shadows: Object.freeze([0.93, 0.982, 1.035]),
    highlights: Object.freeze([0.974, 0.995, 1.026]),
  }),
});

export function colorGradeProfile(preset = 1) {
  return PROFILES[THREE.MathUtils.clamp(Math.round(preset), 1, 4)];
}

function makeColorGradePass(profile) {
  return new ShaderPass({
    name: 'SeaStateColorGradeShader',
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: profile.exposure },
      uSaturation: { value: profile.saturation },
      uContrast: { value: profile.contrast },
      uShadows: { value: new THREE.Vector3().fromArray(profile.shadows) },
      uHighlights: { value: new THREE.Vector3().fromArray(profile.highlights) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uExposure;
      uniform float uSaturation;
      uniform float uContrast;
      uniform vec3 uShadows;
      uniform vec3 uHighlights;
      varying vec2 vUv;

      float gradeLuma(vec3 color) {
        return dot(color, vec3(0.2126, 0.7152, 0.0722));
      }

      void main() {
        vec4 source = texture2D(tDiffuse, vUv);
        vec3 graded = max(source.rgb * exp2(uExposure), vec3(0.0));
        float light = gradeLuma(graded);
        float shadowWeight = 1.0 - smoothstep(0.045, 0.52, light);
        float highlightWeight = smoothstep(0.32, 1.15, light);
        graded *= mix(vec3(1.0), uShadows, shadowWeight);
        graded *= mix(vec3(1.0), uHighlights, highlightWeight);
        light = gradeLuma(graded);
        graded = mix(vec3(light), graded, uSaturation);
        graded = max((graded - vec3(0.18)) * uContrast + vec3(0.18), vec3(0.0));
        gl_FragColor = vec4(graded, source.a);
      }
    `,
  });
}

export class ColorGrading {
  constructor(waveField, { transitionSpeed = 1.15 } = {}) {
    this.waveField = waveField;
    this.transitionSpeed = transitionSpeed;
    const profile = colorGradeProfile(waveField.preset);
    this.pass = makeColorGradePass(profile);
    this._targetShadows = new THREE.Vector3();
    this._targetHighlights = new THREE.Vector3();
  }

  update(dt) {
    if (dt <= 0) return;
    const target = colorGradeProfile(this.waveField.preset);
    const uniforms = this.pass.uniforms;
    const blend = 1 - Math.exp(-this.transitionSpeed * dt);
    uniforms.uExposure.value = THREE.MathUtils.lerp(
      uniforms.uExposure.value, target.exposure, blend,
    );
    uniforms.uSaturation.value = THREE.MathUtils.lerp(
      uniforms.uSaturation.value, target.saturation, blend,
    );
    uniforms.uContrast.value = THREE.MathUtils.lerp(
      uniforms.uContrast.value, target.contrast, blend,
    );
    uniforms.uShadows.value.lerp(
      this._targetShadows.fromArray(target.shadows), blend,
    );
    uniforms.uHighlights.value.lerp(
      this._targetHighlights.fromArray(target.highlights), blend,
    );
  }
}
