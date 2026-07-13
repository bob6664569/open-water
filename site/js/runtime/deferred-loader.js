import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const IS_CONSTRAINED_DEVICE = matchMedia('(pointer: coarse)').matches
  || 'ontouchstart' in window
  || (navigator.deviceMemory != null && navigator.deviceMemory <= 4);

function whenIdle(callback) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(callback, { timeout: 1200 });
  } else {
    setTimeout(callback, 32);
  }
}

export function createDeferredGLTFLoader({
  loader = new GLTFLoader(),
  constrainedDevice = IS_CONSTRAINED_DEVICE,
  schedule = whenIdle,
} = {}) {
  let decodeQueue = Promise.resolve();

  return function loadDeferred(url, onLoad, onError) {
    const run = () => new Promise(resolve => {
      schedule(() => {
        const handleError = (error) => {
          try { onError?.(error); } finally { resolve(); }
        };

        try {
          loader.load(url, (gltf) => {
            try { onLoad(gltf); } finally { resolve(); }
          }, undefined, handleError);
        } catch (error) {
          handleError(error);
        }
      });
    });

    if (constrainedDevice) {
      // Serialize mobile decodes to cap temporary geometry and texture memory.
      decodeQueue = decodeQueue.then(run, run);
      return decodeQueue;
    }
    return run();
  };
}

export const loadGLTFDeferred = createDeferredGLTFLoader();
