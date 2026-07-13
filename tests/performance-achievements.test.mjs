import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACHIEVEMENT_ENTRIES,
  ACHIEVEMENTS,
  AchievementManager,
  KONAMI_CODE,
} from '../site/js/ui/achievements.js';

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

test('the 50-knot milestone unlocks the racing boat', () => {
  const milestone = ACHIEVEMENTS.find(item => item.id === 'speed-50');
  assert.equal(milestone.target, 50);
  assert.equal(milestone.metric, 'bestSpeedKn');
  assert.equal(milestone.reward, 'racer');
  assert.match(milestone.description, /Redline Phantom/);
});

test('the Konami Code unlocks every achievement in one persisted batch', () => {
  const manager = Object.create(AchievementManager.prototype);
  manager.state = { unlocked: {} };
  manager.konamiIndex = 0;
  manager.dirty = false;
  let saves = 0;
  let renders = 0;
  const notices = [];
  manager._save = () => { saves += 1; };
  manager.render = () => { renders += 1; };
  manager._enqueueNotice = notice => { notices.push(notice); };

  const rewardEvents = [];
  const originalDispatchEvent = globalThis.dispatchEvent;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = class {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
  globalThis.dispatchEvent = event => { rewardEvents.push(event); return true; };
  try {
    KONAMI_CODE.forEach(key => manager._recordKonamiKey({
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    }));
  } finally {
    if (originalDispatchEvent) globalThis.dispatchEvent = originalDispatchEvent;
    else delete globalThis.dispatchEvent;
    if (originalCustomEvent) globalThis.CustomEvent = originalCustomEvent;
    else delete globalThis.CustomEvent;
  }

  assert.equal(Object.keys(manager.state.unlocked).length, ACHIEVEMENTS.length);
  assert.equal(saves, 1);
  assert.equal(renders, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].variant, 'konami');
  assert.match(notices[0].title, /Captain Mode/);
  assert.deepEqual(
    rewardEvents.map(event => event.detail.reward).sort(),
    [...new Set(ACHIEVEMENTS.map(item => item.reward).filter(Boolean))].sort(),
  );
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
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
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
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
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
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
  const manager = new PerformanceManager(rendererStub());
  manager.beginFrame(0);
  manager.beginFrame(300);
  assert.deepEqual(manager.frameTimes, []);
  for (let i = 1; i <= 200; i++) manager.beginFrame(300 + i * 16);
  assert.equal(manager.frameTimes.length, 180);
  assert.ok(manager.frameTimes.every(value => value === 16));
});

test('quality profiles scale expensive budgets monotonically', async () => {
  installBrowserStubs();
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
  const manager = new PerformanceManager(rendererStub());
  const profiles = ['low', 'medium', 'high', 'ultra'].map(id => {
    manager.setMode(id);
    return manager.quality;
  });
  const monotonicKeys = [
    'dprMax', 'scaleMin', 'scaleStart', 'msaa', 'shadowSize', 'reflectionSize',
    'refractionScale', 'physicsHz', 'physicsMaxSteps', 'oceanFarSegments',
    'oceanPatchSegments', 'particleScale', 'rainScale',
  ];

  assert.deepEqual(profiles.map(profile => profile.id), ['low', 'medium', 'high', 'ultra']);
  for (const key of monotonicKeys) {
    const values = profiles.map(profile => profile[key]);
    assert.deepEqual(values, [...values].sort((a, b) => a - b), `${key} must be monotonic`);
  }
  for (const profile of profiles) {
    assert.ok(profile.scaleMin > 0 && profile.scaleMin <= profile.scaleStart);
    assert.ok(profile.scaleStart <= 1);
    assert.ok(profile.reflectionSize > 0);
    assert.ok(profile.refractionScale > 0 && profile.refractionScale <= 1);
  }
});

test('quality snapshots cannot mutate the manager profile', async () => {
  installBrowserStubs('?quality=high');
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
  const manager = new PerformanceManager(rendererStub());
  const snapshot = manager.quality;
  snapshot.shadowSize = 1;
  snapshot.id = 'changed';

  assert.equal(manager.profile.id, 'high');
  assert.equal(manager.quality.shadowSize, 1536);
});

test('adaptive quality drops a tier only after reaching the profile scale floor', async () => {
  installBrowserStubs();
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
  const changes = [];
  const manager = new PerformanceManager(rendererStub(), { onChange: quality => changes.push(quality) });
  manager.auto = true;
  manager.active = true;
  manager.tier = 2;
  manager.scale = manager.profile.scaleMin;
  manager.lastAdjust = 0;
  manager.lastChange = 0;
  manager.frameTimes = Array(45).fill(30);
  manager.cpuTimes = Array(45).fill(20);

  manager._adjust(2000);

  assert.equal(manager.tier, 1);
  assert.equal(manager.scale, manager.profile.scaleStart);
  assert.equal(changes.length, 1);
});

test('adaptive recovery respects cooldown before increasing render scale', async () => {
  installBrowserStubs();
  const { PerformanceManager } = await import('../site/js/runtime/performance.js');
  const changes = [];
  const manager = new PerformanceManager(rendererStub(), { onChange: quality => changes.push(quality) });
  manager.auto = true;
  manager.active = true;
  manager.tier = 2;
  manager.scale = 0.8;
  manager.lastAdjust = 0;
  manager.lastChange = 1000;
  manager.frameTimes = Array(45).fill(16);
  manager.cpuTimes = Array(45).fill(4);

  manager._adjust(3000);
  assert.equal(manager.scale, 0.8);
  assert.equal(changes.length, 0);

  manager.lastAdjust = 3000;
  manager._adjust(5000);
  assert.equal(manager.scale, 0.9);
  assert.equal(changes.length, 1);
});
