const THREE_URL = new URL('../site/vendor/three.module.js', import.meta.url).href;
const ADDONS_URL = new URL('../site/vendor/addons/', import.meta.url);

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { shortCircuit: true, url: THREE_URL };
  }
  if (specifier.startsWith('three/addons/')) {
    return {
      shortCircuit: true,
      url: new URL(specifier.slice('three/addons/'.length), ADDONS_URL).href,
    };
  }
  return nextResolve(specifier, context);
}
