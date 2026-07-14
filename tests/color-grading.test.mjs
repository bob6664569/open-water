import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ColorGrading,
  colorGradeProfile,
} from '../site/js/rendering/color-grading.js';

test('sea-state grades progress from warm and vivid to cool and restrained', () => {
  const profiles = [1, 2, 3, 4].map(colorGradeProfile);

  assert.deepEqual(
    profiles.map(profile => profile.saturation),
    [...profiles.map(profile => profile.saturation)].sort((a, b) => b - a),
  );
  assert.deepEqual(
    profiles.map(profile => profile.contrast),
    [...profiles.map(profile => profile.contrast)].sort((a, b) => a - b),
  );
  assert.ok(profiles[0].highlights[0] > profiles[0].highlights[2]);
  assert.ok(profiles[3].shadows[0] < profiles[3].shadows[2]);
  assert.ok(profiles[3].exposure < profiles[0].exposure);
});

test('invalid presets clamp to the authored color-grade range', () => {
  assert.equal(colorGradeProfile(-10), colorGradeProfile(1));
  assert.equal(colorGradeProfile(99), colorGradeProfile(4));
});

test('color grading transitions gradually without clipping HDR highlights', () => {
  const waveField = { preset: 1 };
  const grading = new ColorGrading(waveField);
  const fragmentShader = grading.pass.material.fragmentShader;
  const initialSaturation = grading.pass.uniforms.uSaturation.value;

  assert.match(fragmentShader, /source\.rgb \* exp2\(uExposure\)/);
  assert.match(fragmentShader, /float gradeLuma\(vec3 color\)/);
  assert.doesNotMatch(fragmentShader, /float luminance\(vec3 color\)/);
  assert.match(fragmentShader, /smoothstep\(0\.045, 0\.52, light\)/);
  assert.doesNotMatch(fragmentShader, /clamp\(graded/);

  waveField.preset = 4;
  const shadowUniform = grading.pass.uniforms.uShadows.value;
  const highlightUniform = grading.pass.uniforms.uHighlights.value;
  grading.update(0.5);
  const transitional = grading.pass.uniforms.uSaturation.value;
  assert.ok(transitional < initialSaturation);
  assert.ok(transitional > colorGradeProfile(4).saturation);
  assert.equal(grading.pass.uniforms.uShadows.value, shadowUniform);
  assert.equal(grading.pass.uniforms.uHighlights.value, highlightUniform);

  for (let i = 0; i < 240; i++) grading.update(1 / 60);
  assert.ok(Math.abs(
    grading.pass.uniforms.uSaturation.value - colorGradeProfile(4).saturation,
  ) < 0.001);
  assert.ok(Math.abs(
    grading.pass.uniforms.uContrast.value - colorGradeProfile(4).contrast,
  ) < 0.001);
});
