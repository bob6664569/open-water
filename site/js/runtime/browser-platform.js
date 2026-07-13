export function fetchResource(...args) {
  return globalThis.fetch(...args);
}

export function scheduleTimeout(callback, delay) {
  return globalThis.setTimeout(callback, delay);
}

export function cancelTimeout(timer) {
  return globalThis.clearTimeout(timer);
}

export function requestNextFrame(callback) {
  if (globalThis.requestAnimationFrame) {
    return globalThis.requestAnimationFrame(callback);
  }
  return callback();
}
