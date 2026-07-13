import assert from 'node:assert/strict';
import test from 'node:test';
import { ExperienceController } from '../site/js/ui/experience-controller.js';

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
    listenerCount: type => listeners.get(type)?.size ?? 0,
  };
}

function createElement() {
  const target = createEventTarget();
  const classes = new Set();
  const attributes = new Map();
  return Object.assign(target, {
    hidden: true,
    inert: false,
    offsetWidth: 100,
    textContent: '',
    focused: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name),
    focus(options) { this.focused++; this.focusOptions = options; },
  });
}

function createFixture({ isTouch = false, selectionUnlocked = false, seaUnlocked = false } = {}) {
  const elements = {
    loader: createElement(),
    welcome: createElement(),
    startButton: createElement(),
    helpHint: createElement(),
    waveControls: createElement(),
    voyageIntro: createElement(),
  };
  const body = createElement();
  body.classList.add('awaiting-start');
  const eventTarget = createEventTarget();
  const timers = new Map();
  let nextTimer = 1;
  const calls = [];
  const rewards = new Set(seaUnlocked ? ['azure'] : []);
  const vessels = {
    selectionUnlocked: () => selectionUnlocked,
    handleRewardUnlocked: reward => calls.push(['reward', reward]),
    playActiveHornOnce: () => { calls.push('horn'); return Promise.resolve(); },
  };
  const controller = new ExperienceController({
    achievements: {
      isRewardUnlocked: reward => rewards.has(reward),
      startVoyage: () => calls.push('voyage'),
    },
    performanceManager: { setActive: value => calls.push(['performance', value]) },
    audio: { start: () => calls.push('audio') },
    vessels,
    firstVoyageGuide: { start: () => calls.push('guide') },
    isTouch,
    elements,
    body,
    eventTarget,
    setTimer: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
  });

  function runTimerWithDelay(delay) {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `missing timer with delay ${delay}`);
    timers.delete(entry[0]);
    entry[1].callback();
  }

  return {
    controller,
    elements,
    body,
    eventTarget,
    timers,
    calls,
    rewards,
    vessels,
    runTimerWithDelay,
    setSelectionUnlocked: value => { selectionUnlocked = value; },
  };
}

test('initial loading completes only after the boat, sky and three frames are ready', () => {
  const fixture = createFixture();
  fixture.controller.markBoatReady();
  fixture.controller.markSkyReady();
  fixture.controller.frameRendered();
  fixture.controller.frameRendered();
  assert.equal(fixture.elements.loader.classList.contains('done'), false);

  fixture.controller.frameRendered();
  assert.equal(fixture.elements.loader.classList.contains('done'), true);
  assert.equal(fixture.elements.welcome.classList.contains('ready'), true);
  fixture.runTimerWithDelay(620);
  assert.equal(fixture.elements.startButton.focused, 1);
  assert.deepEqual(fixture.elements.startButton.focusOptions, { preventScroll: true });
});

test('launch activates the experience once and schedules unlocked controls', () => {
  const fixture = createFixture({ selectionUnlocked: true, seaUnlocked: true });
  fixture.controller.bind();
  fixture.elements.startButton.dispatch('click');
  fixture.elements.startButton.dispatch('click');

  assert.equal(fixture.controller.started, true);
  assert.equal(fixture.body.classList.contains('awaiting-start'), false);
  assert.equal(fixture.body.classList.contains('started'), true);
  assert.equal(fixture.elements.startButton.getAttribute('aria-busy'), 'true');
  assert.equal(fixture.elements.welcome.getAttribute('aria-hidden'), 'true');
  assert.equal(fixture.elements.welcome.inert, true);
  assert.deepEqual(fixture.calls, [
    ['performance', true], 'voyage', 'audio', 'horn', 'guide',
  ]);
  assert.match(fixture.elements.helpHint.textContent, /B boat/);
  assert.match(fixture.elements.helpHint.textContent, /1–4 sea/);

  fixture.runTimerWithDelay(4_000);
  fixture.runTimerWithDelay(7_000);
  assert.equal(fixture.body.classList.contains('dock-revealed'), true);
  assert.equal(fixture.body.classList.contains('controls-revealed'), true);
  fixture.runTimerWithDelay(20_000);
  assert.equal(fixture.elements.helpHint.classList.contains('help-dismissed'), true);
  assert.equal(fixture.elements.helpHint.getAttribute('aria-hidden'), 'true');
});

test('fresh-profile voyage intro appears, dismisses on drive input and fades out', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.controller.launch();
  fixture.runTimerWithDelay(1_300);
  assert.equal(fixture.elements.voyageIntro.hidden, false);
  assert.equal(fixture.elements.voyageIntro.classList.contains('playing'), true);
  assert.equal(fixture.eventTarget.listenerCount('keydown'), 1);

  fixture.eventTarget.dispatch('keydown', { code: 'KeyX' });
  assert.equal(fixture.elements.voyageIntro.classList.contains('playing'), true);
  fixture.eventTarget.dispatch('keydown', { code: 'KeyW' });
  assert.equal(fixture.elements.voyageIntro.classList.contains('playing'), false);
  assert.equal(fixture.elements.voyageIntro.classList.contains('leaving'), true);
  assert.equal(fixture.eventTarget.listenerCount('keydown'), 0);
  fixture.runTimerWithDelay(1_400);
  assert.equal(fixture.elements.voyageIntro.hidden, true);
  assert.equal(fixture.elements.voyageIntro.classList.contains('leaving'), false);
});

test('reward events refresh vessel and sea access without reviving dismissed help', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.controller.started = true;
  fixture.elements.helpHint.classList.add('help-dismissed');
  fixture.rewards.add('azure');
  fixture.eventTarget.dispatch('ocean-boat:reward-unlocked', {
    detail: { reward: 'azure' },
  });

  assert.deepEqual(fixture.calls, [['reward', 'azure']]);
  assert.equal(fixture.elements.waveControls.inert, false);
  assert.equal(fixture.elements.waveControls.getAttribute('aria-hidden'), 'false');
  assert.equal(fixture.elements.helpHint.textContent, '');
  fixture.runTimerWithDelay(900);
  assert.equal(fixture.body.classList.contains('controls-revealed'), true);
});

test('destroy removes listeners and all outstanding timers', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.controller.launch();
  assert.ok(fixture.timers.size > 0);
  fixture.controller.destroy();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.elements.startButton.listenerCount('click'), 0);
  assert.equal(fixture.eventTarget.listenerCount('ocean-boat:reward-unlocked'), 0);
});
