import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  tuneVesselMaterial,
  tuneVesselMaterials,
  vesselMaterialFamily,
} from '../site/js/rendering/vessel-materials.js';
import {
  enableVesselOcclusion,
  VESSEL_OCCLUSION_LAYER,
  VesselOcclusionPass,
} from '../site/js/rendering/vessel-occlusion.js';
import { VESSEL_SPECS } from '../site/js/simulation/vessels.js';

test('vessel finishes correct implausible glass, metal and paint exports', () => {
  const glass = new THREE.MeshStandardMaterial({
    name: 'Glass', transparent: true, opacity: 0.35,
    metalness: 0.94, roughness: 0,
  });
  assert.equal(vesselMaterialFamily(glass), 'glass');
  assert.equal(tuneVesselMaterial(glass), glass);
  assert.equal(glass.metalness, 0);
  assert.equal(glass.roughness, 0.08);
  assert.equal(glass.depthWrite, false);

  const chrome = new THREE.MeshStandardMaterial({
    name: 'cj_chrome', metalness: 0, roughness: 0.9,
  });
  tuneVesselMaterial(chrome);
  assert.equal(chrome.metalness, 0.82);
  assert.equal(chrome.roughness, 0.38);

  const hull = new THREE.MeshStandardMaterial({
    name: 'BoatBody', metalness: 0.8, roughness: 0.05,
  });
  const tunedHull = tuneVesselMaterial(hull);
  assert.equal(tunedHull.isMeshPhysicalMaterial, true);
  assert.equal(tunedHull.metalness, 0.08);
  assert.equal(tunedHull.roughness, 0.24);
  assert.equal(tunedHull.clearcoat, 0.5);
});

test('shared vessel materials are upgraded once without changing mesh grouping', () => {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ name: 'CABIN', roughness: 0.1 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(), paint);
  const b = new THREE.Mesh(new THREE.BoxGeometry(), [paint, paint]);
  root.add(a, b);

  tuneVesselMaterials(root);

  assert.equal(a.material.isMeshPhysicalMaterial, true);
  assert.equal(b.material.length, 2);
  assert.equal(a.material, b.material[0]);
  assert.equal(b.material[0], b.material[1]);
});

test('vessel-specific finishes override ambiguous legacy material names', () => {
  const leather = new THREE.MeshPhysicalMaterial({
    name: 'phongE2', roughness: 0.2, metalness: 0.5,
    clearcoat: 0.8, specularIntensity: 1,
  });
  tuneVesselMaterial(leather, VESSEL_SPECS.motoryacht.materialFinishes.phongE2);
  assert.equal(leather.metalness, 0);
  assert.equal(leather.roughness, 0.74);
  assert.equal(leather.clearcoat, 0);
  assert.equal(leather.specularIntensity, 0.2);

  const deck = new THREE.MeshPhysicalMaterial({
    name: 'coperta1', roughness: 0.1, clearcoat: 0.9,
  });
  tuneVesselMaterial(deck, VESSEL_SPECS.motoryacht.materialFinishes.coperta1);
  assert.equal(deck.userData.vesselMaterialFamily, 'wood');
  assert.equal(deck.roughness, 0.58);
  assert.equal(deck.clearcoat, 0);
});

test('S.S. Minnow opts out of enhanced materials and vessel occlusion', () => {
  assert.equal(VESSEL_SPECS.ss_minnow_iii.enhancedRendering, false);
  assert.equal(VESSEL_SPECS.motoryacht.enhancedRendering, true);
});

test('vessel occlusion owns a dedicated layer and follows quality budgets', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  enableVesselOcclusion(mesh);
  assert.equal(mesh.layers.isEnabled(VESSEL_OCCLUSION_LAYER), true);

  const pass = new VesselOcclusionPass(
    new THREE.Scene(), new THREE.PerspectiveCamera(), 800, 600,
  );
  pass.setPerformanceBudget({
    vesselOcclusion: true,
    vesselOcclusionScale: 0.6,
    vesselOcclusionSamples: 12,
    vesselOcclusionRadius: 0.72,
    vesselOcclusionIntensity: 0.48,
  });
  assert.equal(pass.enabled, true);
  assert.equal(pass.gBuffer.width, 480);
  assert.equal(pass.gBuffer.height, 360);
  assert.equal(pass.aoMaterial.uniforms.uSamples.value, 12);
  assert.equal(pass.compositeMaterial.uniforms.uIntensity.value, 0.48);
  assert.match(pass.aoMaterial.fragmentShader, /depth >= 0\.99999/);
  assert.match(pass.compositeMaterial.fragmentShader, /gl_FragColor = source/);
  pass.dispose();
});
