import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  REFLECTION_LAYER,
  REFRACTION_LAYER,
  enableWaterPasses,
  showInRefraction,
} from '../site/js/render-layers.js';

test('water-pass layers keep vessels reflected and underwater content refracted', () => {
  assert.notEqual(REFLECTION_LAYER, REFRACTION_LAYER);

  const reflectionCamera = new THREE.Layers();
  reflectionCamera.set(REFLECTION_LAYER);
  const refractionCamera = new THREE.Layers();
  refractionCamera.set(REFRACTION_LAYER);

  const vessel = new THREE.Object3D();
  enableWaterPasses(vessel);
  assert.equal(reflectionCamera.test(vessel.layers), true);
  assert.equal(refractionCamera.test(vessel.layers), true);

  const underwater = new THREE.Object3D();
  showInRefraction(underwater);
  assert.equal(refractionCamera.test(underwater.layers), true);
  assert.equal(reflectionCamera.test(underwater.layers), false);
});
