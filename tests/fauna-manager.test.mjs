import assert from 'node:assert/strict';
import test from 'node:test';
import { FaunaManager } from '../site/js/fauna/fauna-manager.js';

function fakeType(name, events) {
  return class {
    constructor(...args) {
      this.name = name;
      this.args = args;
      events.push(`construct:${name}`);
    }

    setPerformanceBudget(quality) {
      events.push(`budget:${name}:${quality.id}`);
    }

    update(dt) {
      events.push(`update:${name}:${dt}`);
    }
  };
}

function fakeTypes(events) {
  return Object.fromEntries([
    'Wildlife', 'FishLife', 'Dolphins', 'Whales',
    'Seabed', 'Turtles', 'Mantas', 'Birds',
  ].map(name => [name, fakeType(name, events)]));
}

test('fauna manager preserves construction dependencies and achievement sources', () => {
  const events = [];
  const dependencies = {
    scene: {}, camera: {}, waveField: {}, boat: {}, audio: {},
  };
  const fauna = new FaunaManager(dependencies, fakeTypes(events));

  assert.deepEqual(events, [
    'construct:Wildlife', 'construct:FishLife', 'construct:Dolphins', 'construct:Whales',
    'construct:Seabed', 'construct:Turtles', 'construct:Mantas', 'construct:Birds',
  ]);
  assert.deepEqual(fauna.wildlife.args, [
    dependencies.scene, dependencies.camera, dependencies.waveField, dependencies.audio,
  ]);
  assert.deepEqual(fauna.birds.args, fauna.wildlife.args);
  assert.deepEqual(fauna.whales.args, [
    dependencies.scene, dependencies.camera, dependencies.waveField,
  ]);
  assert.deepEqual(fauna.fish.args, [
    dependencies.scene, dependencies.camera, dependencies.waveField, dependencies.boat,
  ]);
  for (const system of [fauna.dolphins, fauna.seabed, fauna.turtles, fauna.mantas]) {
    assert.deepEqual(system.args, fauna.fish.args);
  }
  assert.deepEqual(fauna.achievementSources, {
    dolphins: fauna.dolphins,
    whales: fauna.whales,
    turtles: fauna.turtles,
    mantas: fauna.mantas,
    fish: fauna.fish,
  });
});

test('fauna manager preserves frame order and forwards the seabed quality budget', () => {
  const events = [];
  const fauna = new FaunaManager({
    scene: {}, camera: {}, waveField: {}, boat: {}, audio: {},
  }, fakeTypes(events));
  events.length = 0;

  fauna.setPerformanceBudget({ id: 'ultra' });
  fauna.update(0.25);

  assert.deepEqual(events, [
    'budget:Seabed:ultra',
    'update:Wildlife:0.25',
    'update:FishLife:0.25',
    'update:Dolphins:0.25',
    'update:Whales:0.25',
    'update:Seabed:0.25',
    'update:Turtles:0.25',
    'update:Mantas:0.25',
    'update:Birds:0.25',
  ]);
});
