import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleBoatThreat } from '../site/js/fauna-math.js';

test('boat threat sampling leaves its output untouched outside the radius', () => {
  const output = { ax: 7, az: 8, u: 9 };
  const boat = { pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 } };

  assert.equal(sampleBoatThreat(null, 1, 1, 8, output), false);
  assert.equal(sampleBoatThreat(boat, 8, 0, 8, output), false);
  assert.deepEqual(output, { ax: 7, az: 8, u: 9 });
});

test('stationary boat threats preserve direction and normalized urgency', () => {
  const output = {};
  const boat = { pos: { x: 2, z: -3 }, vel: { x: 0, z: 0 } };

  assert.equal(sampleBoatThreat(boat, 5, 1, 10, output), true);
  assert.ok(Math.abs(output.ax - 0.6) < 1e-12);
  assert.ok(Math.abs(output.az - 0.8) < 1e-12);
  assert.equal(output.u, 0.5);
});

test('moving boat threats use the closest point along the configured lead', () => {
  const output = {};
  const boat = { pos: { x: 0, z: 0 }, vel: { x: 10, z: 0 } };

  assert.equal(sampleBoatThreat(boat, 5, 3, 8, output, 1), true);
  assert.equal(output.ax, 0);
  assert.equal(output.az, 1);
  assert.equal(output.u, 0.625);
});

test('overlapping moving threats choose a stable perpendicular escape direction', () => {
  const output = {};
  const boat = { pos: { x: 0, z: 0 }, vel: { x: 3, z: 4 } };

  assert.equal(sampleBoatThreat(boat, 0, 0, 10, output), true);
  assert.equal(output.ax, -0.8);
  assert.equal(output.az, 0.6);
  assert.equal(output.u, 0.9);
});
