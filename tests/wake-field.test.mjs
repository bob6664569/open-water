import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WakeField, WAKE_RENDER_SOURCES } from '../site/js/simulation/wake-field.js';
import { WaveField } from '../site/js/simulation/waves.js';

function makeBoat() {
  return {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    speedKn: 12 * 1.94384,
    wet: 1,
    spec: {
      length: 6.5,
      beam: 2.1,
      effects: { wakeOrigin: new THREE.Vector3(0, 0, -3) },
    },
    worldPoint(local, out) {
      return out.copy(local).applyQuaternion(this.quat).add(this.pos);
    },
  };
}

const stillWater = {
  currentAt: (_x, _z, out) => out.set(0, 0, 0),
};

function buildTrail(wake, boat, frames = 80) {
  for (let frame = 0; frame < frames; frame++) {
    boat.pos.z += 0.2;
    wake.update(1 / 60, boat, stillWater);
  }
  boat.speedKn = 0;
  wake.update(1.3, boat, stillWater);
}

test('moving wet hulls leave a bounded, developing physical wake', () => {
  const wake = new WakeField(24);
  const boat = makeBoat();
  buildTrail(wake, boat);

  assert.ok(wake.activeCount > 0);
  assert.ok(wake.activeCount <= wake.sources.length);
  const source = wake.sources.find(candidate => candidate.active);
  assert.ok(source.z > -3, `wake source did not originate at the bow: ${source.z}`);
  const waveSpeed = source.spreadSpeed;
  const crestOffset = source.beam * 0.44 + waveSpeed * (source.age - 0.08);
  const sideX = -source.fz;
  const sideZ = source.fx;
  const sample = wake.sample(
    source.x + sideX * crestOffset,
    source.z + sideZ * crestOffset,
    new THREE.Vector4(),
  );

  assert.ok(sample.x > 0, `wake crest height was ${sample.x}`);
  assert.ok([sample.x, sample.y, sample.z, sample.w].every(Number.isFinite));
  assert.notEqual(sample.w, 0);
});

test('the wake apex contracts from ahead of the bow during turns', () => {
  const wake = new WakeField(4);
  const boat = makeBoat();
  boat.angVelB = new THREE.Vector3();
  wake.update(1 / 60, boat, stillWater);
  const straightOffset = wake._emitter.z - boat.pos.z;

  boat.angVelB.y = 0.6;
  wake.update(1 / 60, boat, stillWater);
  const turningOffset = wake._emitter.z - boat.pos.z;

  assert.ok(Math.abs(straightOffset - boat.spec.length * 0.54) < 1e-12);
  assert.ok(Math.abs(turningOffset - boat.spec.length * 0.5) < 1e-12);
});

test('wake sources drift with current, expire and clear after a teleport', () => {
  const wake = new WakeField(12);
  const boat = makeBoat();
  buildTrail(wake, boat, 30);
  const source = wake.sources.find(candidate => candidate.active);
  const xBefore = source.x;
  const current = {
    currentAt: (_x, _z, out) => out.set(0.4, 0, -0.1),
  };

  wake.update(1, boat, current);
  assert.ok(source.x > xBefore + 0.39);

  boat.pos.set(500, 0, 500);
  wake.update(1 / 60, boat, current);
  assert.equal(wake.activeCount, 0);
});

test('individual crests rise near the bow then decay while spreading outward', () => {
  const wake = new WakeField(1);
  const boat = makeBoat();
  buildTrail(wake, boat, 30);
  const source = wake.sources.find(candidate => candidate.active);
  const out = new THREE.Vector4();
  const crestHeightAt = age => {
    source.age = age;
    const offset = source.beam * 0.44
      + source.spreadSpeed * (age - 0.08);
    return wake.sample(
      source.x - source.fz * offset,
      source.z + source.fx * offset,
      out,
    ).x;
  };

  const birthHeight = crestHeightAt(0.12);
  const developedHeight = crestHeightAt(0.72);
  const distantHeight = crestHeightAt(12);

  assert.ok(developedHeight > birthHeight * 3);
  assert.ok(distantHeight < developedHeight * 0.35);
});

test('diagonal crests stay higher at their forward end and scale with speed', () => {
  const wake = new WakeField(1);
  const boat = makeBoat();
  wake._emit(0, 0, 0, 1, boat, 12, 2.1);
  const source = wake.sources[0];
  source.age = 0.72;
  const crestOffset = source.beam * 0.44
    + source.spreadSpeed * (source.age - 0.08);
  const heightAtAlong = along => {
    const lateral = crestOffset - along * 0.38;
    return wake.sample(
      source.x - source.fz * lateral + source.fx * along,
      source.z + source.fx * lateral + source.fz * along,
      new THREE.Vector4(),
    ).x;
  };

  const rearHeight = heightAtAlong(-source.alongScale * 0.6);
  const frontHeight = heightAtAlong(source.alongScale * 0.6);
  assert.ok(frontHeight > rearHeight * 2);

  const slowWake = new WakeField(1);
  slowWake._emit(0, 0, 0, 1, boat, 4, 1);
  assert.ok(source.amplitude > slowWake.sources[0].amplitude * 2);
});

test('nearest active wake sources populate stable render uniforms', () => {
  const wake = new WakeField(32);
  const boat = makeBoat();
  buildTrail(wake, boat, 120);
  const wakeUniforms = Array.from(
    { length: WAKE_RENDER_SOURCES }, () => new THREE.Vector4(),
  );
  const metaUniforms = Array.from(
    { length: WAKE_RENDER_SOURCES }, () => new THREE.Vector4(),
  );
  const extraUniforms = Array.from(
    { length: WAKE_RENDER_SOURCES }, () => new THREE.Vector2(),
  );

  const count = wake.fillUniforms(
    boat.pos.x, boat.pos.z, wakeUniforms, metaUniforms, extraUniforms,
  );

  assert.ok(count > 0 && count <= WAKE_RENDER_SOURCES);
  assert.ok(wakeUniforms.slice(0, count).every(value => value.w > 0.08));
  assert.ok(metaUniforms.slice(0, count).every(value => value.z > 0));
  assert.ok(metaUniforms.slice(0, count).every(value => value.w >= 0.9));
  assert.ok(extraUniforms.slice(0, count).every(value => value.x > 0));
  assert.ok(extraUniforms.slice(0, count).every(value => value.y >= 1.2));
});

test('wave queries include wake height, slope and vertical water velocity', () => {
  const field = new WaveField();
  field.update(0.8, 20, -12);
  const x = 8.5;
  const z = -4.25;
  const baseHeight = field.heightAt(x, z);
  const baseVelocity = field.velocityAt(x, z, new THREE.Vector3());
  const baseNormal = field.normalAt(x, z, new THREE.Vector3());
  field.setWakeField({
    sample: (_x, _z, out) => out.set(0.2, 0.1, -0.08, 0.3),
  });

  assert.ok(Math.abs(field.heightAt(x, z) - baseHeight - 0.2) < 1e-12);
  const velocity = field.velocityAt(x, z, new THREE.Vector3());
  assert.ok(Math.abs(velocity.y - baseVelocity.y - 0.3) < 1e-12);
  const wakeNormal = field.normalAt(x, z, new THREE.Vector3());
  assert.ok(wakeNormal.distanceTo(baseNormal) > 0.01);
  assert.ok(Math.abs(wakeNormal.length() - 1) < 1e-12);
});
