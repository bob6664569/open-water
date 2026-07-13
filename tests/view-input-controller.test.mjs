import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewInputController } from '../site/js/controllers/view-input-controller.js';

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      event.type ??= type;
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function createFixture({ isTouch = false, appStarted = true, gestureActive = false } = {}) {
  const element = createEventTarget();
  const eventTarget = createEventTarget();
  const calls = [];
  let zoom = 20;
  let now = 0;
  let audioStarts = 0;
  const cameraController = {
    activeZoom: () => zoom,
    setActiveZoom: value => { zoom = value; calls.push(['zoom', value]); },
    orbitHoriz: value => calls.push(['horizontal', value]),
    orbitPitchBy: value => calls.push(['pitch', value]),
  };
  let cycles = 0;
  const controller = new ViewInputController({
    element,
    eventTarget,
    cameraController,
    audio: { start: () => { audioStarts++; } },
    isTouch,
    isAppStarted: () => appStarted,
    isGestureActive: () => gestureActive,
    cycleCamera: () => { cycles++; },
    now: () => now,
  });
  return {
    controller,
    element,
    eventTarget,
    calls,
    setNow: value => { now = value; },
    setGestureActive: value => { gestureActive = value; },
    get zoom() { return zoom; },
    get cycles() { return cycles; },
    get audioStarts() { return audioStarts; },
  };
}

function pointer(pointerId, clientX, clientY, pointerType = 'mouse') {
  return { pointerId, clientX, clientY, pointerType };
}

test('single-pointer drag orbits while wheel zoom ignores the achievements panel', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.element.dispatch('pointerdown', pointer(1, 10, 20));
  fixture.eventTarget.dispatch('pointermove', pointer(1, 16, 28));
  assert.deepEqual(fixture.calls, [['horizontal', 6], ['pitch', 8]]);
  assert.equal(fixture.audioStarts, 1);

  fixture.eventTarget.dispatch('wheel', {
    deltaY: 100,
    target: { closest: selector => selector === '#achievements-panel' },
  });
  assert.equal(fixture.calls.length, 2);
  fixture.eventTarget.dispatch('wheel', { deltaY: 100, target: { closest: () => null } });
  assert.ok(Math.abs(fixture.zoom - 20 * Math.exp(0.12)) < 1e-12);
});

test('two-pointer pinch uses the initial distance and zoom', () => {
  const fixture = createFixture({ isTouch: true });
  fixture.controller.bind();
  fixture.element.dispatch('pointerdown', pointer(1, 0, 0, 'touch'));
  fixture.element.dispatch('pointerdown', pointer(2, 100, 0, 'touch'));
  fixture.eventTarget.dispatch('pointermove', pointer(2, 200, 0, 'touch'));
  assert.equal(fixture.zoom, 10);
  assert.deepEqual(fixture.calls.at(-1), ['zoom', 10]);
});

test('a touch double tap cycles camera only after startup and outside drive gestures', () => {
  const fixture = createFixture({ isTouch: true });
  fixture.controller.bind();
  fixture.setNow(100);
  fixture.element.dispatch('pointerdown', pointer(1, 40, 50, 'touch'));
  fixture.setNow(150);
  fixture.eventTarget.dispatch('pointerup', pointer(1, 40, 50, 'touch'));
  fixture.setNow(220);
  fixture.element.dispatch('pointerdown', pointer(2, 44, 54, 'touch'));
  fixture.setNow(250);
  fixture.eventTarget.dispatch('pointerup', pointer(2, 44, 54, 'touch'));
  assert.equal(fixture.cycles, 1);

  fixture.setGestureActive(true);
  fixture.element.dispatch('pointerdown', pointer(3, 20, 30, 'touch'));
  fixture.eventTarget.dispatch('pointermove', pointer(3, 25, 40, 'touch'));
  assert.deepEqual(fixture.calls.slice(-2).map(call => call[0]), ['horizontal', 'zoom']);
});

test('binding and teardown are idempotent', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.controller.bind();
  assert.equal(fixture.element.listenerCount('pointerdown'), 1);
  fixture.element.dispatch('pointerdown', pointer(1, 0, 0));
  fixture.controller.destroy();
  assert.equal(fixture.controller.pointers.size, 0);
  assert.equal(fixture.element.listenerCount('pointerdown'), 0);
  assert.equal(fixture.eventTarget.listenerCount('pointermove'), 0);
});
