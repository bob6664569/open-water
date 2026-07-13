import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SEA_PRESETS, WaveField } from '../site/js/simulation/waves.js';

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
  assert.equal(first.totalSteepness, first.steepnessSum());
});

test('sea presets transition smoothly and invalid presets are ignored', () => {
  const field = new WaveField();
  field.setSeaPreset(4);

  assert.equal(field.preset, 4);
  assert.equal(field.targetHs, SEA_PRESETS[4].hs);
  assert.equal(field.targetTp, SEA_PRESETS[4].tp);
  assert.equal(field.targetWindSpeed, SEA_PRESETS[4].windSpeed);
  assert.equal(field.targetCurrentSpeed, SEA_PRESETS[4].currentSpeed);
  field.update(1, 120, -45);
  assert.ok(field.significantWaveHeight > SEA_PRESETS[2].hs);
  assert.ok(field.significantWaveHeight < SEA_PRESETS[4].hs);
  assert.ok(field.peakPeriod > SEA_PRESETS[2].tp);
  assert.ok(field.peakPeriod < SEA_PRESETS[4].tp);
  assert.ok(field.windSpeed > SEA_PRESETS[2].windSpeed);
  assert.ok(field.windSpeed < SEA_PRESETS[4].windSpeed);
  assert.ok(field.currentSpeed > SEA_PRESETS[2].currentSpeed);
  assert.ok(field.currentSpeed < SEA_PRESETS[4].currentSpeed);
  assert.equal(field.totalSteepness, field.steepnessSum());

  field.setSeaPreset(99);
  assert.equal(field.preset, 4);
  assert.equal(field.targetHs, SEA_PRESETS[4].hs);
});

test('wind gusts and surface current are deterministic physical fields', () => {
  const first = new WaveField();
  const second = new WaveField();
  first.setSeaPreset(4);
  second.setSeaPreset(4);
  first.update(3.25, 180, -72);
  second.update(3.25, 180, -72);

  const wind = first.windAt(180, -72, new THREE.Vector3());
  const current = first.currentAt(180, -72, new THREE.Vector3());
  assert.deepEqual(wind.toArray(), second.windAt(180, -72, new THREE.Vector3()).toArray());
  assert.deepEqual(
    current.toArray(), second.currentAt(180, -72, new THREE.Vector3()).toArray(),
  );
  assert.ok(isFiniteVector(wind));
  assert.ok(isFiniteVector(current));
  assert.ok(wind.length() > SEA_PRESETS[2].windSpeed);
  assert.ok(current.length() > SEA_PRESETS[2].currentSpeed);
  assert.ok(first.gustFactor >= 0.52);
});

test('surface current is included in water velocity queries', () => {
  const field = new WaveField();
  field.update(0.7, 25, -40);
  const x = 31;
  const z = -17;
  const current = field.currentAt(x, z, new THREE.Vector3());
  const combined = field.velocityAt(x, z, new THREE.Vector3());
  const currentSpeed = field.currentSpeed;
  field.currentSpeed = 0;
  const orbital = field.velocityAt(x, z, new THREE.Vector3());
  field.currentSpeed = currentSpeed;

  assert.ok(combined.clone().sub(orbital).distanceTo(current) < 1e-12);
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

test('period changes preserve every component phase at the boat anchor', () => {
  const field = new WaveField();
  const anchor = { x: 137.25, z: -82.75 };
  const phasesBefore = field.waves.map(wave => (
    wave.k * (wave.dx * anchor.x + wave.dz * anchor.z) + wave.phase
  ));
  field.peakPeriod *= 1.35;

  field._syncSpectrum(0, anchor.x, anchor.z);

  field.waves.forEach((wave, index) => {
    const phaseAfter = wave.k * (wave.dx * anchor.x + wave.dz * anchor.z) + wave.phase;
    const delta = Math.atan2(
      Math.sin(phaseAfter - phasesBefore[index]),
      Math.cos(phaseAfter - phasesBefore[index]),
    );
    assert.ok(Math.abs(delta) < 1e-12, `wave ${index} phase jumped at the anchor`);
  });
});

test('uniform containers stay stable while their values update in place', () => {
  const field = new WaveField();
  const before = field.uniformData();
  const directions = before.dirs;
  const amplitudes = before.amps;
  const firstDirection = directions[0];
  const firstAmplitude = amplitudes[0];

  field.setSeaPreset(4);
  field.update(0.5, 25, -10);
  const after = field.uniformData();

  assert.equal(after.dirs, directions);
  assert.equal(after.amps, amplitudes);
  assert.equal(after.dirs[0], firstDirection);
  assert.equal(after.amps[0], firstAmplitude);
  assert.ok(after.amps.every(value => [value.x, value.y, value.z].every(Number.isFinite)));
});

test('combined surface samples match the independent physics queries', () => {
  const field = new WaveField();
  field.setSeaPreset(4);
  field.update(0.73, 140, -95);
  const positions = [
    [0, 0], [12.5, -7.25], [140, -95], [-800.2, 1200.75],
  ];

  for (const [x, z] of positions) {
    const expectedHeight = field.heightAt(x, z);
    const expectedVelocity = field.velocityAt(x, z, new THREE.Vector3());
    const expectedNormal = field.normalAt(x, z, new THREE.Vector3());
    const velocity = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const height = field.sampleSurface(x, z, velocity, normal);

    assert.ok(Math.abs(height - expectedHeight) < 1e-12, `height mismatch at ${x},${z}`);
    assert.ok(velocity.distanceTo(expectedVelocity) < 1e-12, `velocity mismatch at ${x},${z}`);
    assert.ok(normal.distanceTo(expectedNormal) < 1e-12, `normal mismatch at ${x},${z}`);
  }
});
