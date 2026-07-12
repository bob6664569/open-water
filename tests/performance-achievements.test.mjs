import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACHIEVEMENT_ENTRIES,
  ACHIEVEMENTS,
  AchievementManager,
} from '../site/js/achievements.js';

function installBrowserStubs(search = '') {
  const storage = new Map();
  Object.defineProperties(globalThis, {
    location: { configurable: true, value: { search } },
    screen: { configurable: true, value: { width: 1920, height: 1080 } },
    devicePixelRatio: { configurable: true, value: 1 },
    localStorage: {
      configurable: true,
      value: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
    },
  });
  return storage;
}

function rendererStub() {
  const gl = { getExtension: () => null };
  return {
    capabilities: { isWebGL2: false },
    getContext: () => gl,
    info: { render: { calls: 12, triangles: 3456 } },
  };
}

test('achievement definitions and grouped journal entries stay coherent', () => {
  const ids = ACHIEVEMENTS.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'achievement ids must be unique');
  for (const achievement of ACHIEVEMENTS) {
    assert.match(achievement.id, /^[a-z0-9-]+$/);
    assert.ok(achievement.title.length > 0);
    assert.ok(achievement.description.length > 0);
    assert.ok(achievement.metric.length > 0);
    assert.ok(Number.isFinite(achievement.target) && achievement.target > 0);
  }

  const groupedIds = ACHIEVEMENT_ENTRIES.flatMap(entry =>
    entry.definitions.map(definition => definition.id));
  assert.deepEqual(groupedIds.sort(), ids.sort());
  for (const entry of ACHIEVEMENT_ENTRIES.filter(item => item.series)) {
    const tiers = entry.definitions.map(definition => definition.tier);
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
    assert.equal(new Set(tiers).size, tiers.length, `${entry.series} tiers must be unique`);
  }
});

test('air-time progress accumulates while airborne without waiting for landing', () => {
  const manager = Object.create(AchievementManager.prototype);
  manager.state = {
    bestAirTime: 0,
    totalAirTime: 0,
    bestJumpHeight: 0,
    jumpCount: 0,
  };
  manager.dirty = false;
  manager.render = () => {};
  manager.resetFlight();

  const boat = {
    wet: 0,
    speedKn: 20,
    pos: { x: 0, y: 1, z: 0 },
    spec: { rideHeight: 0.1 },
  };
  const waveField = { heightAt: () => 0 };

  manager._updateFlight(0.1, boat, waveField);
  for (let i = 0; i < 8; i++) manager._updateFlight(0.1, boat, waveField);

  assert.equal(manager.flight.airborne, true);
  assert.ok(manager.state.bestAirTime >= 0.75);
  assert.ok(manager.state.totalAirTime >= 0.75);
  assert.equal(manager.state.jumpCount, 0, 'landing still validates completed jumps');
});

test('short dry contacts do not inflate cumulative air time', () => {
  const manager = Object.create(AchievementManager.prototype);
  manager.state = {
    bestAirTime: 0,
    totalAirTime: 0,
    bestJumpHeight: 0,
    jumpCount: 0,
  };
  manager.dirty = false;
  manager.render = () => {};
  manager.resetFlight();

  const boat = {
    wet: 0,
    speedKn: 20,
    pos: { x: 0, y: 0.2, z: 0 },
    spec: { rideHeight: 0.1 },
  };
  const waveField = { heightAt: () => 0 };

  manager._updateFlight(0.1, boat, waveField);
  manager._updateFlight(0.1, boat, waveField);
  manager._updateFlight(0.1, boat, waveField);
  boat.wet = 0.2;
  manager._updateFlight(0.1, boat, waveField);

  assert.equal(manager.state.totalAirTime, 0);
});

test('air-time achievements use the sum of separate qualifying flights', () => {
  const manager = Object.create(AchievementManager.prototype);
  manager.state = {
    bestAirTime: 0,
    totalAirTime: 0,
    bestJumpHeight: 0,
    jumpCount: 0,
  };
  manager.dirty = false;
  manager.render = () => {};
  const boat = {
    wet: 0,
    speedKn: 20,
    pos: { x: 0, y: 1, z: 0 },
    spec: { rideHeight: 0.1 },
  };
  const waveField = { heightAt: () => 0 };

  for (let flight = 0; flight < 2; flight++) {
    manager.resetFlight();
    manager._updateFlight(0.1, boat, waveField);
    for (let i = 0; i < 4; i++) manager._updateFlight(0.1, boat, waveField);
    boat.wet = 0.2;
    manager._updateFlight(0.1, boat, waveField);
    boat.wet = 0;
  }

  assert.ok(manager.state.totalAirTime > manager.state.bestAirTime);
  assert.ok(manager.state.totalAirTime >= 0.8);
});

test('manual quality mode is selected, persisted and reported', async () => {
  const storage = installBrowserStubs('?quality=medium');
  const { PerformanceManager } = await import('../site/js/performance.js');
  const changes = [];
  const manager = new PerformanceManager(rendererStub(), { onChange: quality => changes.push(quality) });

  assert.equal(manager.auto, false);
  assert.equal(manager.profile.id, 'medium');
  manager.setMode('ultra');
  assert.equal(manager.profile.id, 'ultra');
  assert.equal(storage.get('ocean-boat:quality-mode'), 'ultra');
  assert.equal(changes.at(-1).id, 'ultra');
  assert.deepEqual(manager.stats, {
    profile: 'ultra', mode: 'manual', scale: 1,
    frameP95: 0, cpuP95: 0, gpuP90: 0,
    targetFps: 60, calls: 12, triangles: 3456,
  });
});

test('adaptive quality lowers render scale under sustained overload', async () => {
  installBrowserStubs();
  const { PerformanceManager } = await import('../site/js/performance.js');
  const changes = [];
  const manager = new PerformanceManager(rendererStub(), { onChange: quality => changes.push(quality) });
  manager.auto = true;
  manager.active = true;
  manager.tier = 2;
  manager.scale = 1;
  manager.lastAdjust = 0;
  manager.lastChange = 0;
  manager.frameTimes = Array(45).fill(30);
  manager.cpuTimes = Array(45).fill(20);

  manager._adjust(2000);

  assert.equal(manager.tier, 2);
  assert.equal(manager.scale, 0.9);
  assert.equal(changes.length, 1);
  assert.equal(manager.frameTimes.length, 0, 'samples must reset after a quality change');
});

test('frame sampling rejects long pauses and caps its rolling window', async () => {
  installBrowserStubs('?quality=low');
  const { PerformanceManager } = await import('../site/js/performance.js');
  const manager = new PerformanceManager(rendererStub());
  manager.beginFrame(0);
  manager.beginFrame(300);
  assert.deepEqual(manager.frameTimes, []);
  for (let i = 1; i <= 200; i++) manager.beginFrame(300 + i * 16);
  assert.equal(manager.frameTimes.length, 180);
  assert.ok(manager.frameTimes.every(value => value === 16));
});
