import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

Object.defineProperties(globalThis, {
  window: { configurable: true, value: {} },
  navigator: { configurable: true, value: { deviceMemory: 8 } },
  matchMedia: { configurable: true, value: () => ({ matches: false }) },
});
const { Wildlife } = await import('../site/js/fauna/wildlife.js');

function makeWildlife() {
  const wildlife = new Wildlife(
    new THREE.Scene(),
    { position: new THREE.Vector3() },
    { preset: 1 },
  );
  wildlife.loaded = true;
  wildlife.loadStarted = true;
  wildlife.foragingTimer = 0;
  return wildlife;
}

function makeSchool() {
  return {
    center: new THREE.Vector3(30, -1, 20),
    guided: false,
    scattered: false,
    members: [{}, {}, {}, {}, {}],
  };
}

test('ambient gulls occasionally form a small flock that follows a fish school', () => {
  const wildlife = makeWildlife();
  const school = makeSchool();

  wildlife.update(0.1, [school]);

  assert.ok(wildlife.gulls.length >= 2 && wildlife.gulls.length <= 4);
  assert.ok(wildlife.gulls.every(bird => bird.foragingSchool === school && !bird.guided));

  school.center.set(42, -1, 35);
  wildlife.update(0.1, [school]);
  assert.ok(wildlife.gulls.every(bird => bird.guidedCenter.equals(school.center)));
});

test('foraging gulls leave when their fish school scatters', () => {
  const wildlife = makeWildlife();
  const school = makeSchool();
  wildlife.update(0.1, [school]);

  school.scattered = true;
  wildlife.update(0.1, [school]);

  assert.equal(wildlife.foragingSchool, null);
  assert.ok(wildlife.gulls.every(bird => !bird.foragingSchool && !bird.guidedCenter));
  assert.ok(wildlife.foragingTimer >= 40 && wildlife.foragingTimer <= 85);
});
