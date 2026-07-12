import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const IS_CONSTRAINED_DEVICE = matchMedia('(pointer: coarse)').matches
  || 'ontouchstart' in window
  || (navigator.deviceMemory != null && navigator.deviceMemory <= 4);

let mobileQueue = Promise.resolve();

function whenIdle(callback) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(callback, { timeout: 1200 });
  } else {
    setTimeout(callback, 32);
  }
}

// Les décodeurs GLB créent des buffers et textures transitoires importants.
// Sur appareil contraint, une file unique garantit qu'un seul modèle de faune
// est décodé à la fois. Sur desktop, les chargements restent parallèles.
export function loadGLTFDeferred(url, onLoad, onError) {
  const run = () => new Promise(resolve => {
    whenIdle(() => {
      new GLTFLoader().load(url, (gltf) => {
        try { onLoad(gltf); } finally { resolve(); }
      }, undefined, (error) => {
        try { onError?.(error); } finally { resolve(); }
      });
    });
  });
  if (IS_CONSTRAINED_DEVICE) {
    mobileQueue = mobileQueue.then(run);
    return mobileQueue;
  }
  return run();
}
