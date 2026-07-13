import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getVesselSpec, VESSEL_SPECS } from '../site/js/simulation/vessels.js';

test('every indexed boat resolves to its own vessel specification', () => {
  const entries = JSON.parse(readFileSync(
    new URL('../site/assets/boats/index.json', import.meta.url),
    'utf8',
  ));

  assert.equal(entries.length, Object.keys(VESSEL_SPECS).length);
  for (const { name } of entries) {
    const spec = getVesselSpec(name);
    const expectedId = name.toLowerCase().replace(/_(\d+(?:\.\d+)?)(r)?\.glb$/i, '')
      .replace(/\.glb$/i, '');
    assert.equal(spec.id, expectedId, `${name} resolved to the wrong specification`);
    assert.equal(getVesselSpec(name.toUpperCase()), spec);
  }
});

test('unknown model names use the documented Zefiro fallback', () => {
  assert.equal(getVesselSpec('missing.glb'), VESSEL_SPECS.zefiro);
  assert.equal(getVesselSpec(), VESSEL_SPECS.zefiro);
});

test('Redline Phantom keeps its drag-racing identity and twin propeller rig', () => {
  const spec = VESSEL_SPECS.boat;
  const topSpeedKn = spec.maxPropSpeed * 1.94384;
  assert.ok(topSpeedKn >= 199 && topSpeedKn <= 201);
  assert.equal(spec.audio.bank, 'racer');
  assert.equal(spec.effects.exhausts.length, 2);
  assert.ok(spec.effects.roosterTail.rate >= 1);
  assert.equal(spec.rig.existingPropellers.length, 2);
  assert.deepEqual(
    spec.rig.telescopingSteering.nodes,
    ['polySurface71', 'polySurface72'],
  );
  assert.equal(spec.rig.telescopingSteering.actuators.length, 2);
  assert.ok(spec.rig.telescopingSteering.pivot[2] < 86);
  assert.ok(spec.pitchStiff > 0);
  assert.ok(spec.pitchTargetRad > 0);
});

test('vessel physics sheets satisfy core numeric invariants', async t => {
  for (const [key, spec] of Object.entries(VESSEL_SPECS)) {
    await t.test(key, () => {
      assert.equal(spec.id, key);
      for (const property of [
        'length', 'beam', 'height', 'mass', 'restDraft', 'visualDraft',
        'maxThrustFwd', 'maxThrustRev', 'maxPropSpeed', 'maxSteerRad',
        'rudderLift', 'planingLift', 'rollStiff',
      ]) {
        assert.ok(Number.isFinite(spec[property]) && spec[property] > 0, `${property} must be positive`);
      }

      assert.ok(spec.beam < spec.length, 'beam must remain smaller than length');
      assert.equal(spec.buoyPoints.length, 8);
      const buoyancyWeight = spec.buoyPoints.reduce((sum, point) => sum + point.w, 0);
      assert.ok(Math.abs(buoyancyWeight - 1) < 1e-12, 'buoyancy weights must sum to one');
      assert.ok(spec.buoyPoints.every(point => point.p.isVector3 && point.w > 0));
      assert.ok(spec.inertia.isVector3);
      assert.ok(spec.inertia.x > 0 && spec.inertia.y > 0 && spec.inertia.z > 0);
      assert.equal(spec.dragLong.length, 2);
      assert.equal(spec.dragLat.length, 2);
      assert.equal(spec.yawDamp.length, 3);
      assert.equal(spec.pitchRollDamp.length, 2);
      assert.ok(spec.camera.helm.isVector3);
      assert.ok(spec.camera.chaseDistance > 0 && spec.camera.chaseHeight > 0);
      assert.ok(spec.camera.helmFov > 0 && spec.camera.helmFov < 180);
      assert.equal(typeof spec.audio.bank, 'string');
    });
  }
});
