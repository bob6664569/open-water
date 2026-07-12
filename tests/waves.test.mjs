import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SEA_PRESETS, WaveField } from '../site/js/waves.js';

const isFiniteVector = vector => [vector.x, vector.y, vector.z].every(Number.isFinite);

test('the generated spectrum is deterministic and normalized to Hs', () => {
  const first = new WaveField();
  const second = new WaveField();

  assert.equal(first.waves.length, 16);
  assert.deepEqual(first.waves, second.waves);
  const standardDeviation = Math.sqrt(
    first.waves.reduce((sum, wave) => sum + wave.A ** 2 * 0.5, 0),
  );
  assert.ok(Math.abs(4 * standardDeviation - first.significantWaveHeight) < 1e-12);
  assert.ok(first.steepnessSum() <= 0.6200001);
});

test('sea presets transition smoothly and invalid presets are ignored', () => {
  const field = new WaveField();
  field.setSeaPreset(4);

  assert.equal(field.preset, 4);
  assert.equal(field.targetHs, SEA_PRESETS[4].hs);
  assert.equal(field.targetTp, SEA_PRESETS[4].tp);
  field.update(1, 120, -45);
  assert.ok(field.significantWaveHeight > SEA_PRESETS[2].hs);
  assert.ok(field.significantWaveHeight < SEA_PRESETS[4].hs);
  assert.ok(field.peakPeriod > SEA_PRESETS[2].tp);
  assert.ok(field.peakPeriod < SEA_PRESETS[4].tp);

  field.setSeaPreset(99);
  assert.equal(field.preset, 4);
  assert.equal(field.targetHs, SEA_PRESETS[4].hs);
});

test('legacy sea-state inputs are clamped to the supported range', () => {
  const field = new WaveField();
  field.setSeaState(-10);
  assert.equal(field.targetHs, 0.15);
  field.setSeaState(100);
  assert.equal(field.targetHs, 3.4);
});

test('wave queries remain finite and normals stay normalized', () => {
  const field = new WaveField();
  field.update(0.5, 1_000_000, -1_000_000);
  const displacement = field.displacement(37.5, -91.2, new THREE.Vector3());
  const velocity = field.velocityAt(37.5, -91.2, new THREE.Vector3());
  const normal = field.normalAt(37.5, -91.2, new THREE.Vector3());

  assert.ok(isFiniteVector(displacement));
  assert.ok(isFiniteVector(velocity));
  assert.ok(Number.isFinite(field.heightAt(37.5, -91.2)));
  assert.ok(Number.isFinite(field.verticalVelocityAt(37.5, -91.2)));
  assert.ok(isFiniteVector(normal));
  assert.ok(Math.abs(normal.length() - 1) < 1e-12);
  assert.equal(field.uniformData().count, 16);
});
