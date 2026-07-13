export const REFRACTION_LAYER = 1;
export const REFLECTION_LAYER = 2;

export function showInRefraction(object) {
  object.layers.set(REFRACTION_LAYER);
}

export function enableWaterPasses(object) {
  object.layers.enable(REFRACTION_LAYER);
  object.layers.enable(REFLECTION_LAYER);
}
