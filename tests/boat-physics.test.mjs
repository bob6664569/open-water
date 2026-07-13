import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ISOLATED = process.env.OCEAN_BOAT_PHYSICS_CASES === '1';
const UNDER_COVERAGE = process.execArgv.includes('--experimental-test-coverage')
  || Boolean(process.env.NODE_V8_COVERAGE);

if (!ISOLATED) {
  test('boat physics integration cases pass in an isolated browser-like runtime', {
    skip: UNDER_COVERAGE ? 'integration suite is exercised by npm test before coverage' : false,
  }, () => {
    const childEnv = { ...process.env, OCEAN_BOAT_PHYSICS_CASES: '1' };
    delete childEnv.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '--import', './tests/register-three.mjs',
      fileURLToPath(import.meta.url),
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: childEnv,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
} else {
  const THREE = await import('three');
  const { VESSEL_SPECS } = await import('../site/js/vessels.js');

Object.defineProperties(globalThis, {
  window: {
    configurable: true,
    value: { location: { search: '' } },
  },
  matchMedia: {
    configurable: true,
    value: () => ({ matches: false }),
  },
});

const { Boat } = await import('../site/js/boat.js');

function flatWater() {
  return {
    heightAt: () => 0,
    velocityAt: (_x, _z, out) => out.set(0, 0, 0),
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
  };
}

function makeBoat() {
  return new Boat(flatWater(), new THREE.Scene(), 0.37);
}

function finiteVector(vector) {
  return [vector.x, vector.y, vector.z].every(Number.isFinite);
}

test('physics budgets cap fixed steps and discard an unbounded backlog', () => {
  const boat = makeBoat();
  boat.setPerformanceBudget({ physicsHz: 120, physicsMaxSteps: 4 });
  let steps = 0;
  boat._step = () => { steps++; };

  boat.update(0.05);

  assert.equal(steps, 4);
  assert.ok(boat._accum <= 1 / 120);
  assert.equal(boat.physicsHz, 120);
  assert.equal(boat.physicsMaxSteps, 4);
});

test('changing physics budget clamps the existing accumulator', () => {
  const boat = makeBoat();
  boat._accum = 0.5;

  boat.setPerformanceBudget({ physicsHz: 180, physicsMaxSteps: 7 });

  assert.equal(boat._accum, 7 / 180);
});

test('reset restores the configured ride height, heading and zero motion', () => {
  const boat = makeBoat();
  boat.setSpec(VESSEL_SPECS['assault-boat']);
  boat.pos.set(10, 8, -4);
  boat.vel.set(3, -2, 1);
  boat.angVelB.set(0.2, 0.3, -0.4);
  boat.reset();

  assert.deepEqual(boat.pos.toArray(), [0, boat.spec.rideHeight, 0]);
  assert.deepEqual(boat.vel.toArray(), [0, 0, 0]);
  assert.deepEqual(boat.angVelB.toArray(), [0, 0, 0]);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(boat.quat);
  assert.ok(Math.abs(Math.atan2(forward.x, forward.z) - 0.37) < 1e-12);
});

test('every vessel remains finite during deterministic fixed-step simulation', async t => {
  for (const spec of Object.values(VESSEL_SPECS)) {
    await t.test(spec.id, () => {
      const boat = makeBoat();
      boat.setSpec(spec);
      boat.reset();
      boat.setPerformanceBudget({ physicsHz: 120, physicsMaxSteps: 5 });
      boat.setControls(0.65, 0.25);

      for (let frame = 0; frame < 180; frame++) boat.update(1 / 60);

      assert.ok(finiteVector(boat.pos), `${spec.id} position diverged`);
      assert.ok(finiteVector(boat.vel), `${spec.id} velocity diverged`);
      assert.ok(finiteVector(boat.angVelB), `${spec.id} angular velocity diverged`);
      assert.ok([
        boat.quat.x, boat.quat.y, boat.quat.z, boat.quat.w,
        boat.wet, boat.propWet, boat.speedKn,
      ].every(Number.isFinite), `${spec.id} state diverged`);
      assert.ok(Math.abs(boat.quat.length() - 1) < 1e-9, `${spec.id} quaternion drifted`);
      assert.ok(boat.wet >= 0);
      assert.ok(boat.propWet >= 0 && boat.propWet <= 1);
    });
  }
});

test('Redline Phantom settles near 200 knots with its bow raised', () => {
  const boat = makeBoat();
  boat.setSpec(VESSEL_SPECS.boat);
  boat.reset();
  boat.setPerformanceBudget({ physicsHz: 120, physicsMaxSteps: 5 });
  boat.setControls(1, 0);

  for (let frame = 0; frame < 1200; frame++) boat.update(1 / 60);

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(boat.quat);
  const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(forward.y));
  assert.ok(boat.speedKn >= 197 && boat.speedKn <= 203, `${boat.speedKn.toFixed(1)} kn`);
  assert.ok(pitchDeg >= 1 && pitchDeg <= 6.5, `${pitchDeg.toFixed(2)}° bow pitch`);
});
}
