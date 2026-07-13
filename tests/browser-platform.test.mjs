import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelTimeout,
  fetchResource,
  requestNextFrame,
  scheduleTimeout,
} from '../site/js/runtime/browser-platform.js';

test('browser platform adapters preserve the global receiver for native APIs', async () => {
  const originals = {
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  const calls = [];
  try {
    globalThis.fetch = function (...args) {
      assert.equal(this, globalThis);
      calls.push(['fetch', ...args]);
      return Promise.resolve({ ok: true });
    };
    globalThis.setTimeout = function (callback, delay) {
      assert.equal(this, globalThis);
      calls.push(['timeout', delay]);
      callback();
      return 17;
    };
    globalThis.clearTimeout = function (timer) {
      assert.equal(this, globalThis);
      calls.push(['clear', timer]);
    };
    globalThis.requestAnimationFrame = function (callback) {
      assert.equal(this, globalThis);
      calls.push(['frame']);
      callback(42);
      return 23;
    };

    assert.deepEqual(await fetchResource('/catalog.json'), { ok: true });
    assert.equal(scheduleTimeout(() => calls.push(['timeout-callback']), 900), 17);
    cancelTimeout(17);
    assert.equal(requestNextFrame(time => calls.push(['frame-callback', time])), 23);
    assert.deepEqual(calls, [
      ['fetch', '/catalog.json'],
      ['timeout', 900],
      ['timeout-callback'],
      ['clear', 17],
      ['frame'],
      ['frame-callback', 42],
    ]);
  } finally {
    globalThis.fetch = originals.fetch;
    globalThis.setTimeout = originals.setTimeout;
    globalThis.clearTimeout = originals.clearTimeout;
    if (originals.requestAnimationFrame) {
      globalThis.requestAnimationFrame = originals.requestAnimationFrame;
    } else {
      delete globalThis.requestAnimationFrame;
    }
  }
});

test('requestNextFrame has a synchronous fallback outside visual runtimes', () => {
  const original = globalThis.requestAnimationFrame;
  try {
    delete globalThis.requestAnimationFrame;
    let called = false;
    const result = requestNextFrame(() => { called = true; return 'done'; });
    assert.equal(called, true);
    assert.equal(result, 'done');
  } finally {
    if (original) globalThis.requestAnimationFrame = original;
  }
});
