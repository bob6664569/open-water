import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalMatchMedia = globalThis.matchMedia;

before(() => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: {} },
    navigator: { configurable: true, value: {} },
    matchMedia: { configurable: true, value: () => ({ matches: false }) },
  });
});

after(() => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: originalWindow },
    navigator: { configurable: true, value: originalNavigator },
    matchMedia: { configurable: true, value: originalMatchMedia },
  });
});

const { createDeferredGLTFLoader } = await import('../site/js/deferred-loader.js');

function createControllableLoader() {
  const requests = [];
  return {
    requests,
    load(url, onLoad, _onProgress, onError) {
      requests.push({ url, onLoad, onError });
    },
  };
}

const scheduleImmediately = callback => callback();
const nextMicrotask = () => new Promise(resolve => {
  queueMicrotask(resolve);
});

test('constrained devices serialize deferred GLTF decodes', async () => {
  const loader = createControllableLoader();
  const loadDeferred = createDeferredGLTFLoader({
    loader,
    constrainedDevice: true,
    schedule: scheduleImmediately,
  });
  const loaded = [];

  const first = loadDeferred('first.glb', gltf => loaded.push(gltf.name));
  const second = loadDeferred('second.glb', gltf => loaded.push(gltf.name));

  await nextMicrotask();
  assert.deepEqual(loader.requests.map(({ url }) => url), ['first.glb']);

  loader.requests[0].onLoad({ name: 'first' });
  await nextMicrotask();
  assert.deepEqual(loader.requests.map(({ url }) => url), ['first.glb', 'second.glb']);

  loader.requests[1].onLoad({ name: 'second' });
  await Promise.all([first, second]);
  assert.deepEqual(loaded, ['first', 'second']);
});

test('desktop requests share a loader without serializing downloads', async () => {
  const loader = createControllableLoader();
  const loadDeferred = createDeferredGLTFLoader({
    loader,
    constrainedDevice: false,
    schedule: scheduleImmediately,
  });

  const first = loadDeferred('first.glb', () => {});
  const second = loadDeferred('second.glb', () => {});

  assert.deepEqual(loader.requests.map(({ url }) => url), ['first.glb', 'second.glb']);
  loader.requests[0].onLoad({});
  loader.requests[1].onLoad({});
  await Promise.all([first, second]);
});

test('a failed constrained decode reports the error and advances the queue', async () => {
  const loader = createControllableLoader();
  const loadDeferred = createDeferredGLTFLoader({
    loader,
    constrainedDevice: true,
    schedule: scheduleImmediately,
  });
  const errors = [];

  const failed = loadDeferred('broken.glb', () => {}, error => errors.push(error.message));
  const next = loadDeferred('next.glb', () => {});

  await nextMicrotask();
  loader.requests[0].onError(new Error('decode failed'));
  await failed;
  await nextMicrotask();

  assert.deepEqual(errors, ['decode failed']);
  assert.equal(loader.requests[1].url, 'next.glb');
  loader.requests[1].onLoad({});
  await next;
});

test('synchronous loader failures use the same error path', async () => {
  const expected = new Error('invalid URL');
  const loader = {
    load() {
      throw expected;
    },
  };
  const loadDeferred = createDeferredGLTFLoader({
    loader,
    constrainedDevice: false,
    schedule: scheduleImmediately,
  });
  let received;

  await loadDeferred('invalid.glb', () => {}, error => { received = error; });
  assert.equal(received, expected);
});
