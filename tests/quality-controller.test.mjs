import assert from 'node:assert/strict';
import test from 'node:test';
import { QualityController } from '../site/js/runtime/quality-controller.js';

function createElement() {
  const listeners = new Map();
  return {
    dataset: {},
    style: {},
    textContent: '',
    value: '',
    title: '',
    blurred: 0,
    removed: 0,
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
    blur() { this.blurred++; },
    remove() { this.removed++; },
  };
}

const HIGH = {
  id: 'high', dprMax: 1.5, scale: 1, bloom: true, bloomStrength: 0.2,
  msaa: 2, shadowSize: 1536,
};
const LOW = {
  id: 'low', dprMax: 1, scale: 0.8, bloom: false, bloomStrength: 0,
  msaa: 0, shadowSize: 512,
};

function createFixture({ perf = false } = {}) {
  const calls = [];
  let width = 1280;
  let height = 720;
  let dpr = 2;
  let rendererRatio = 1;
  const stats = {
    profile: 'high', mode: 'auto', scale: 1,
    frameP95: 16.7, cpuP95: 7.2, gpuP90: 8.1,
    targetFps: 60, calls: 42, triangles: 1_250_000,
  };
  const performanceManager = {
    quality: HIGH,
    stats,
    onChange: null,
    setMode(mode) {
      calls.push(['mode', mode]);
      stats.mode = mode === 'auto' ? 'auto' : 'manual';
      stats.profile = mode === 'auto' ? 'high' : mode;
      this.quality = mode === 'low' ? LOW : HIGH;
      this.onChange?.(this.quality);
    },
  };
  const renderer = {
    setPixelRatio: value => { rendererRatio = value; calls.push(['renderer-ratio', value]); },
    setSize: (...args) => calls.push(['renderer-size', ...args]),
    getDrawingBufferSize: target => {
      target.x = width * rendererRatio;
      target.y = height * rendererRatio;
      calls.push(['resolution']);
    },
  };
  const makeRenderTarget = samples => ({
    samples,
    disposed: 0,
    dispose() { this.disposed++; },
  });
  const composer = {
    renderTarget1: makeRenderTarget(0),
    renderTarget2: makeRenderTarget(2),
    setPixelRatio: value => calls.push(['composer-ratio', value]),
    setSize: (...args) => calls.push(['composer-size', ...args]),
  };
  const waterPasses = {
    setQuality: (...args) => calls.push(['water-quality', ...args]),
  };
  const shadowMap = { disposed: 0, dispose() { this.disposed++; } };
  const sunLight = {
    shadow: {
      mapSize: { set: (...args) => calls.push(['shadow-size', ...args]) },
      map: shadowMap,
    },
  };
  const budgetTargets = ['boat', 'ocean', 'effects'].map(name => ({
    setPerformanceBudget: quality => calls.push(['budget', name, quality.id]),
  }));
  const elements = {
    control: createElement(),
    current: createElement(),
    select: createElement(),
  };
  const appended = [];
  const document = {
    documentElement: { dataset: {} },
    body: { appendChild: element => appended.push(element) },
    createElement: () => createElement(),
  };
  const replacedUrls = [];
  let achievementChanges = 0;
  const resolutionTarget = { x: 0, y: 0 };
  const controller = new QualityController({
    performanceManager,
    renderer,
    composer,
    waterPasses,
    bloom: {},
    sunLight,
    budgetTargets,
    resolutionTarget,
    achievements: { recordQualityChange: () => { achievementChanges++; } },
    elements,
    document,
    location: {
      href: `https://example.test/play?quality=low${perf ? '&perf' : ''}`,
      search: perf ? '?quality=low&perf' : '?quality=low',
    },
    history: { replaceState: (_state, _unused, url) => replacedUrls.push(String(url)) },
    requestFrame: callback => callback(),
    viewportWidth: () => width,
    viewportHeight: () => height,
    devicePixelRatio: () => dpr,
  });
  return {
    controller,
    performanceManager,
    renderer,
    composer,
    waterPasses,
    sunLight,
    shadowMap,
    elements,
    appended,
    calls,
    resolutionTarget,
    replacedUrls,
    setViewport: (nextWidth, nextHeight, nextDpr = dpr) => {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
    },
    get achievementChanges() { return achievementChanges; },
  };
}

test('initial quality configures render targets before subsystem budgets', () => {
  const fixture = createFixture();
  fixture.controller.bind();

  assert.equal(fixture.controller.current, HIGH);
  assert.equal(fixture.composer.renderTarget1.samples, 2);
  assert.equal(fixture.composer.renderTarget1.disposed, 1);
  assert.equal(fixture.composer.renderTarget2.disposed, 0);
  assert.equal(fixture.shadowMap.disposed, 1);
  assert.equal(fixture.sunLight.shadow.map, null);
  assert.deepEqual(fixture.resolutionTarget, { x: 1920, y: 1080 });
  assert.equal(fixture.elements.control.dataset.quality, 'high');
  assert.equal(fixture.elements.current.textContent, 'high');
  const waterIndex = fixture.calls.findIndex(call => call[0] === 'water-quality');
  const budgetIndex = fixture.calls.findIndex(call => call[0] === 'budget');
  assert.ok(waterIndex >= 0 && budgetIndex > waterIndex);
});

test('manager changes remain queued until the pre-render application point', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.calls.length = 0;
  fixture.performanceManager.onChange(LOW);
  assert.equal(fixture.controller.current, HIGH);
  assert.equal(fixture.calls.length, 0);

  assert.equal(fixture.controller.applyPending(), true);
  assert.equal(fixture.controller.current, LOW);
  assert.equal(fixture.controller.applyPending(), false);
  assert.equal(fixture.calls[0][0], 'renderer-ratio');
  assert.equal(fixture.calls.some(call => call[0] === 'water-quality'), true);
});

test('resize forces viewport-dependent targets to refresh on the next frame', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.calls.length = 0;
  fixture.setViewport(900, 600, 1);
  fixture.controller.resize();
  fixture.controller.applyPending();

  assert.deepEqual(fixture.calls.find(call => call[0] === 'renderer-size'),
    ['renderer-size', 900, 600]);
  const waterCall = fixture.calls.find(call => call[0] === 'water-quality');
  assert.equal(waterCall[3], 900);
  assert.equal(waterCall[4], 600);
  assert.deepEqual(waterCall[5], { force: true, viewportChanged: true });
});

test('manual selection updates persistence URL, telemetry and pointer focus', () => {
  const fixture = createFixture();
  fixture.controller.bind();
  fixture.elements.select.dispatch('pointerdown');
  fixture.elements.select.value = 'low';
  fixture.elements.select.dispatch('change');

  assert.deepEqual(fixture.calls.at(-1), ['mode', 'low']);
  assert.equal(fixture.achievementChanges, 1);
  assert.equal(fixture.replacedUrls[0], 'https://example.test/play?quality=low');
  assert.equal(fixture.elements.select.blurred, 1);
  assert.equal(fixture.elements.control.dataset.mode, 'manual');
  assert.equal(fixture.elements.current.textContent, 'low');
});

test('performance HUD is opt-in, throttled and removed during teardown', () => {
  const fixture = createFixture({ perf: true });
  fixture.controller.bind();
  assert.equal(fixture.appended.length, 1);
  fixture.controller.updateHud(100);
  assert.match(fixture.appended[0].textContent, /HIGH auto · scale 1\.00/);
  assert.match(fixture.appended[0].textContent, /1\.25 M triangles/);
  fixture.appended[0].textContent = 'sentinel';
  fixture.controller.updateHud(200);
  assert.equal(fixture.appended[0].textContent, 'sentinel');

  fixture.controller.destroy();
  assert.equal(fixture.appended[0].removed, 1);
  assert.equal(fixture.elements.select.listenerCount('change'), 0);
  assert.equal(fixture.performanceManager.onChange, null);
});
