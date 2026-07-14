import * as THREE from 'three';

const GLASS = /glass|verre|vitre|window|windscreen|windshield/i;
const METAL = /chrome|brass|silver|mirror|inox|steel|aluminium|aluminum|rail|propeller|metal/i;
const WOOD = /wood|teak|bois|slat|cabinet/i;
const SOFT = /couch|carp|leather|lether|rope|bumper|rubber|boudin|foot.*pad|seat|fabric|blind/i;
const PAINT = /boat|body|hull|cabin|fiancate|chiglia|coperta|gelcoat|zodiac_(?:blanc|gris|rouge|orange|noir)|\bwhite\b|\bblue\b/i;

function clamp(value, min, max) {
  return THREE.MathUtils.clamp(value, min, max);
}

export function vesselMaterialFamily(material) {
  const name = material?.name || '';
  if (GLASS.test(name)) return 'glass';
  if (METAL.test(name)) return 'metal';
  if (WOOD.test(name)) return 'wood';
  if (SOFT.test(name)) return 'soft';
  if (PAINT.test(name)) return 'paint';
  return 'generic';
}

function asPhysicalMaterial(material) {
  if (material.isMeshPhysicalMaterial) return material;
  const physical = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(physical, material);
  physical.defines = { STANDARD: '', PHYSICAL: '' };
  physical.name = material.name;
  physical.userData = { ...material.userData };
  return physical;
}

function applyFinishOverrides(material, finish) {
  for (const property of [
    'metalness', 'roughness', 'envMapIntensity', 'clearcoat',
    'clearcoatRoughness', 'specularIntensity', 'opacity', 'transparent',
    'depthWrite', 'alphaTest',
  ]) {
    if (finish[property] !== undefined && property in material) {
      material[property] = finish[property];
    }
  }
}

export function tuneVesselMaterial(source, finish = {}) {
  if (!source?.isMeshStandardMaterial) return source;
  const options = typeof finish === 'string' ? { family: finish } : finish;
  const family = options.family || vesselMaterialFamily(source);
  let material = family === 'paint' ? asPhysicalMaterial(source) : source;

  if (family === 'glass') {
    material.metalness = 0;
    material.roughness = clamp(material.roughness, 0.08, 0.22);
    material.envMapIntensity = 1.05;
    if (material.transparent || material.opacity < 0.98) material.depthWrite = false;
  } else if (family === 'metal') {
    if (!material.metalnessMap) material.metalness = Math.max(material.metalness, 0.82);
    material.roughness = clamp(material.roughness, 0.18, 0.38);
    material.envMapIntensity = 1.1;
  } else if (family === 'wood') {
    if (!material.metalnessMap) material.metalness = 0;
    material.roughness = clamp(material.roughness, 0.38, 0.7);
    material.envMapIntensity = 0.72;
    if ('specularIntensity' in material) material.specularIntensity = 0.38;
    if ('clearcoat' in material) material.clearcoat = 0;
  } else if (family === 'soft') {
    if (!material.metalnessMap) material.metalness = 0;
    material.roughness = clamp(material.roughness, 0.62, 0.9);
    material.envMapIntensity = 0.58;
    if ('specularIntensity' in material) material.specularIntensity = 0.26;
    if ('clearcoat' in material) material.clearcoat = 0;
  } else if (family === 'paint') {
    if (!material.metalnessMap) material.metalness = Math.min(material.metalness, 0.08);
    material.roughness = clamp(material.roughness, 0.24, 0.48);
    material.clearcoat = Math.max(material.clearcoat, 0.5);
    material.clearcoatRoughness = clamp(material.clearcoatRoughness, 0.14, 0.24);
    material.envMapIntensity = 0.95;
  } else {
    material.roughness = clamp(material.roughness, 0.28, 0.82);
    material.envMapIntensity = 0.82;
  }

  applyFinishOverrides(material, options);
  if (material.aoMap) material.aoMapIntensity = 1.08;
  material.userData.vesselMaterialFamily = family;
  material.needsUpdate = true;
  return material;
}

export function tuneVesselMaterials(model, finishes = {}) {
  const tuned = new WeakMap();
  model.traverse(object => {
    if (!object.isMesh || !object.material) return;
    const tune = material => {
      if (!material) return material;
      if (!tuned.has(material)) {
        tuned.set(material, tuneVesselMaterial(material, finishes[material.name]));
      }
      return tuned.get(material);
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(tune)
      : tune(object.material);
  });
}
