import assert from 'node:assert/strict';
import test from 'node:test';
import { GestureDriveController } from '../site/js/controllers/gesture-drive-controller.js';

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

function createElement() {
  const target = createEventTarget();
  const classes = new Set();
  const attributes = new Map();
  const styles = new Map();
  const vector = { style: { setProperty: (name, value) => styles.set(name, value) } };
  return Object.assign(target, {
    vector,
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
    querySelector: selector => selector === '.drive-vector' ? vector : null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name),
    setPointerCapture(pointerId) { this.captures.push(pointerId); },
    contains: node => node === target.child,
    styles,
  });
}

function createFixture() {
  const element = createElement();
  const tutorial = createElement();
  const eventTarget = createEventTarget();
  const timers = new Map();
  const vibrations = [];
  let nextTimer = 1;
  let audioStarts = 0;
  let engagements = 0;
  const controller = new GestureDriveController({
    element,
    tutorialElement: tutorial,
    audio: { start: () => { audioStarts++; } },
    onEngage: () => { engagements++; },
    navigator: { vibrate: duration => vibrations.push(duration) },
    eventTarget,
    setTimer: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
  });
  return {
    controller,
    element,
    tutorial,
    eventTarget,
    timers,
    vibrations,
    get audioStarts() { return audioStarts; },
    get engagements() { return engagements; },
  };
}

function pointerEvent(overrides = {}) {
  return {
    button: 0,
    pointerId: 7,
    clientX: 100,
    clientY: 100,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
}

test('gesture driving maps a pointer vector to normalized throttle and steering', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  const down = pointerEvent();
  fixture.element.dispatch('pointerdown', down);

  assert.equal(down.prevented, true);
  assert.equal(fixture.controller.state.active, true);
  assert.deepEqual(fixture.element.captures, [7]);
  assert.equal(fixture.audioStarts, 1);
  assert.equal(fixture.engagements, 1);
  assert.equal(fixture.tutorial.classList.contains('visible'), true);
  assert.deepEqual(fixture.vibrations, [12]);

  fixture.element.dispatch('pointermove', pointerEvent({ clientX: 176, clientY: 24 }));
  assert.equal(fixture.controller.state.throttle, 1);
  assert.equal(fixture.controller.state.steer, 1);
  assert.equal(fixture.element.getAttribute('aria-valuetext'), 'forward 100%, right 100%');
  assert.equal(fixture.element.styles.get('--drive-length'), '76px');
  assert.equal(fixture.tutorial.classList.contains('visible'), false);
});

test('release returns to neutral and restores the tutorial only after idle', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.element.dispatch('pointerdown', pointerEvent());
  fixture.eventTarget.dispatch('pointerup', pointerEvent({ pointerId: 8 }));
  assert.equal(fixture.controller.state.active, true);

  fixture.eventTarget.dispatch('pointerup', pointerEvent());
  assert.deepEqual(fixture.controller.state, {
    active: false,
    id: null,
    originX: 100,
    originY: 100,
    throttle: 0,
    steer: 0,
  });
  assert.equal(fixture.element.getAttribute('aria-valuetext'), 'Neutral');
  assert.deepEqual(fixture.vibrations, [12, 8]);
  const timer = [...fixture.timers.values()][0];
  assert.equal(timer.delay, 20_000);
  assert.equal(fixture.element.classList.contains('awaiting-drive-idle'), true);

  timer.callback();
  assert.equal(fixture.element.classList.contains('awaiting-drive-idle'), false);
  fixture.element.dispatch('pointerdown', pointerEvent({ pointerId: 9 }));
  assert.equal(fixture.tutorial.classList.contains('visible'), true);
});

test('binding is idempotent and destroy removes global interaction state', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.controller.bind();
  assert.equal(fixture.element.listenerCount('pointerdown'), 1);
  assert.equal(fixture.eventTarget.listenerCount('pointerup'), 1);

  fixture.element.dispatch('pointerdown', pointerEvent());
  fixture.controller.destroy();
  assert.equal(fixture.controller.state.active, false);
  assert.equal(fixture.element.listenerCount('pointerdown'), 0);
  assert.equal(fixture.eventTarget.listenerCount('pointerup'), 0);
});
