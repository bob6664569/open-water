import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { VesselController } from '../site/js/controllers/vessel-controller.js';

function createElement() {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  return {
    textContent: '',
    disabled: false,
    inert: false,
    hidden: false,
    offsetWidth: 100,
    blurred: 0,
    captures: [],
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name),
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatch: (name, event = {}) => listeners.get(name)?.(event),
    setPointerCapture(pointerId) { this.captures.push(pointerId); },
    blur() { this.blurred++; },
  };
}

const SPECS = {
  'zefiro_6.5.glb': {
    id: 'zefiro', label: 'Azure Comet', length: 6.5, rideHeight: 0.1,
    camera: { chaseDistance: 12 },
  },
  'motoryacht_20r.glb': {
    id: 'motoryacht', label: 'Ivory Arrow', length: 20, rideHeight: 0.4, reversed: false,
    camera: { chaseDistance: 24 },
  },
  'ss_minnow_iii.glb': {
    id: 'ss_minnow_iii', label: 'Minnow', length: 14, rideHeight: 0.2,
    camera: { chaseDistance: 18 },
  },
};

function createFixture({
  unlocked = ['azure'],
  storedBoat = null,
  isTouch = false,
  appStarted = false,
  fetchFailure = false,
} = {}) {
  const unlockedRewards = new Set(unlocked);
  const storageValues = new Map();
  if (storedBoat) storageValues.set('ocean-boat:last-vessel', storedBoat);
  const modelCalls = [];
  const boat = {
    pos: new THREE.Vector3(1, 2, 3),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0.3)),
    vel: new THREE.Vector3(4, 5, 6),
    angVelB: new THREE.Vector3(0.4, 0.5, 0.6),
    spec: SPECS['zefiro_6.5.glb'],
    setSpec(spec) { this.spec = spec; },
    reset() {
      this.pos.set(0, 0, 0);
      this.quat.identity();
      this.vel.set(0, 0, 0);
      this.angVelB.set(0, 0, 0);
    },
    async loadModel(...args) { modelCalls.push(args); },
  };
  const achievementCalls = [];
  const achievements = {
    isRewardUnlocked: reward => unlockedRewards.has(reward),
    resetFlight: () => achievementCalls.push('flight'),
    resetCircle: () => achievementCalls.push('circle'),
    recordBoat: name => achievementCalls.push(['boat', name]),
  };
  const elements = {
    loader: createElement(),
    selector: createElement(),
    name: createElement(),
    position: createElement(),
    previousButton: createElement(),
    nextButton: createElement(),
    unlockAlert: createElement(),
    unlockName: createElement(),
    unlockHint: createElement(),
  };
  const body = createElement();
  const timers = [];
  let readyCount = 0;
  const revealCalls = [];
  const cameraSpecs = [];
  let hornCalls = 0;
  const controller = new VesselController({
    boat,
    achievements,
    cameraController: { setVessel: spec => cameraSpecs.push(spec) },
    audio: {
      start() {},
      async megayachtHorn() { hornCalls++; return true; },
    },
    elements,
    body,
    isTouch,
    storage: {
      getItem: key => storageValues.get(key) ?? null,
      setItem: (key, value) => storageValues.set(key, value),
    },
    fetcher: async () => {
      if (fetchFailure) throw new Error('offline');
      return { json: async () => Object.keys(SPECS).map(name => ({ name })) };
    },
    getSpec: name => SPECS[name],
    isAppStarted: () => appStarted,
    onInitialReady: () => { readyCount++; },
    revealDock: delay => revealCalls.push(delay),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, id: timers.length + 1 };
      timers.push(timer);
      return timer.id;
    },
    clearTimer: () => {},
  });
  return {
    controller,
    boat,
    elements,
    body,
    timers,
    modelCalls,
    achievementCalls,
    unlockedRewards,
    storageValues,
    revealCalls,
    cameraSpecs,
    get readyCount() { return readyCount; },
    get hornCalls() { return hornCalls; },
  };
}

test('mobile startup avoids restoring a heavy vessel and selects the safe default', async () => {
  const fixture = createFixture({
    unlocked: ['azure', 'ivory'],
    storedBoat: 'motoryacht_20r.glb',
    isTouch: true,
  });
  fixture.controller.bind();
  await fixture.controller.loadCatalog();

  assert.deepEqual(fixture.controller.names, ['motoryacht_20r.glb', 'zefiro_6.5.glb']);
  assert.equal(fixture.controller.index, 1);
  assert.equal(fixture.modelCalls[0][0], './assets/boats/zefiro_6.5.glb');
  assert.equal(fixture.elements.unlockHint.textContent, 'Tap to take the helm');
  assert.equal(fixture.elements.selector.inert, false);
  assert.equal(fixture.readyCount, 1);
});

test('vessel changes wrap indexes and restore the active navigation state', async () => {
  const fixture = createFixture({ unlocked: ['azure', 'ivory'] });
  await fixture.controller.loadCatalog();
  fixture.boat.pos.set(10, 3, -4);
  fixture.boat.vel.set(7, 0.5, 2);
  fixture.boat.angVelB.set(0.2, 0.3, 0.4);
  fixture.boat.quat.setFromEuler(new THREE.Euler(0.2, 0.4, 0.1));
  const expectedQuat = fixture.boat.quat.toArray();

  await fixture.controller.loadByIndex(-2);
  assert.equal(fixture.controller.index, 0);
  assert.deepEqual(fixture.boat.pos.toArray(), [10, 3.3, -4]);
  assert.deepEqual(fixture.boat.vel.toArray(), [7, 0.5, 2]);
  assert.deepEqual(fixture.boat.angVelB.toArray(), [0.2, 0.3, 0.4]);
  assert.deepEqual(fixture.boat.quat.toArray(), expectedQuat);
  assert.deepEqual(fixture.modelCalls.at(-1), [
    './assets/boats/motoryacht_20r.glb',
    20,
    true,
  ]);
  assert.equal(fixture.elements.loader.classList.contains('visible'), false);
  assert.equal(fixture.elements.selector.getAttribute('aria-busy'), 'false');
  assert.equal(fixture.cameraSpecs.at(-1), SPECS['motoryacht_20r.glb']);
});

test('reward unlocks refresh access, reveal the dock and announce the new vessel', async () => {
  const fixture = createFixture({ unlocked: ['azure'], appStarted: true });
  fixture.controller.bind();
  await fixture.controller.loadCatalog();
  assert.equal(fixture.controller.selectionUnlocked(), false);

  fixture.unlockedRewards.add('ivory');
  assert.equal(fixture.controller.handleRewardUnlocked('ivory'), true);
  assert.equal(fixture.controller.selectionUnlocked(), true);
  assert.deepEqual(fixture.revealCalls, [900]);
  assert.equal(fixture.timers[0].delay, 1650);
  fixture.timers[0].callback();
  assert.equal(fixture.elements.unlockName.textContent, 'Ivory Arrow');
  assert.equal(fixture.elements.unlockAlert.classList.contains('visible'), true);
  assert.equal(fixture.elements.selector.classList.contains('new-vessel'), true);
  assert.equal(fixture.timers[1].delay, 5200);
  assert.equal(fixture.controller.handleRewardUnlocked('not-a-vessel'), false);
});

test('megayacht horn plays and persists at most once', async () => {
  const fixture = createFixture({ appStarted: true });
  const megayacht = { id: 'frickies_yacht' };
  await fixture.controller.playHornOnce(megayacht);
  await fixture.controller.playHornOnce(megayacht);
  assert.equal(fixture.hornCalls, 1);
  assert.equal(fixture.storageValues.get('ocean-boat:megayacht-horn-played'), '1');
});

test('catalog failures retain the fallback model and still release initial loading', async () => {
  const fixture = createFixture({ fetchFailure: true });
  await fixture.controller.loadCatalog();
  assert.deepEqual(fixture.modelCalls, [['./assets/boat.glb']]);
  assert.equal(fixture.readyCount, 1);
});

test('bound pointer gestures change vessels only for a deliberate horizontal swipe', async () => {
  const fixture = createFixture({ unlocked: ['azure', 'ivory'] });
  fixture.controller.bind();
  await fixture.controller.loadCatalog();
  const target = { closest: () => null };
  fixture.elements.selector.dispatch('pointerdown', {
    button: 0, pointerId: 3, clientX: 100, clientY: 100, target,
  });
  fixture.elements.selector.dispatch('pointerup', {
    pointerId: 3, clientX: 40, clientY: 105,
  });
  await Promise.resolve();
  assert.equal(fixture.elements.selector.captures[0], 3);
  assert.equal(fixture.controller.index, 0);
});
