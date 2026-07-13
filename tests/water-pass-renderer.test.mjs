import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WaterPassRenderer } from '../site/js/rendering/water-pass-renderer.js';
import { REFLECTION_LAYER, REFRACTION_LAYER } from '../site/js/rendering/render-layers.js';

function createFixture() {
  const events = [];
  const renderer = {
    clippingPlanes: [],
    setClearColor(color, alpha) { events.push(['clearColor', color, alpha]); },
    setRenderTarget(target) { events.push(['target', target]); },
    clear() { events.push(['clear']); },
    render(scene, camera) { events.push(['render', scene, camera, camera.layers.mask]); },
  };
  const scene = new THREE.Scene();
  const background = new THREE.Color(0x123456);
  const fog = new THREE.Fog(0x123456, 1, 100);
  scene.background = background;
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
  camera.position.set(4, 8, 12);
  camera.lookAt(0, 0, 0);
  const ocean = {
    uniforms: {
      uReflMap: { value: null },
      uRefrMap: { value: null },
      uRefrDepth: { value: null },
      uCameraNear: { value: null },
      uCameraFar: { value: null },
      uReflMatrix: { value: new THREE.Matrix4() },
    },
  };
  const paradiseSky = { visible: true };
  const waterPasses = new WaterPassRenderer({
    renderer,
    scene,
    camera,
    ocean,
    waveField: { heightAt: () => 2 },
    boat: { pos: new THREE.Vector3(5, 0, 7) },
    paradiseSky,
    width: 800,
    height: 600,
  });
  return {
    waterPasses,
    events,
    renderer,
    scene,
    camera,
    ocean,
    paradiseSky,
    background,
    fog,
  };
}

test('binds water targets and applies quality sizes without replacing textures', () => {
  const { waterPasses, ocean } = createFixture();
  assert.equal(ocean.uniforms.uReflMap.value, waterPasses.reflectionTarget.texture);
  assert.equal(ocean.uniforms.uRefrMap.value, waterPasses.refractionTarget.texture);
  assert.equal(ocean.uniforms.uRefrDepth.value, waterPasses.refractionTarget.depthTexture);
  assert.equal(ocean.uniforms.uCameraNear.value, 0.1);
  assert.equal(ocean.uniforms.uCameraFar.value, 4000);

  waterPasses.lastReflectionAt = 10;
  waterPasses.lastRefractionAt = 10;
  waterPasses.setQuality(
    { reflectionSize: 256, refractionScale: 0.25 },
    { reflectionSize: 512, refractionScale: 0.5 },
    1000,
    500,
  );
  assert.equal(waterPasses.reflectionTarget.width, 256);
  assert.equal(waterPasses.reflectionTarget.height, 256);
  assert.equal(waterPasses.refractionTarget.width, 250);
  assert.equal(waterPasses.refractionTarget.height, 125);
  assert.equal(waterPasses.lastReflectionAt, -Infinity);
  assert.equal(waterPasses.lastRefractionAt, -Infinity);
});

test('renders refraction before reflection and restores shared render state', () => {
  const fixture = createFixture();
  const {
    waterPasses, events, renderer, scene, camera, paradiseSky, background, fog,
  } = fixture;
  const oldMask = camera.layers.mask;
  waterPasses.render(100, { reflectionHz: 60, refractionHz: 30 });

  const renders = events.filter(event => event[0] === 'render');
  assert.equal(renders.length, 2);
  assert.equal(renders[0][2], camera);
  assert.equal(renders[0][3], 1 << REFRACTION_LAYER);
  assert.equal(renders[1][2], waterPasses.mirrorCamera);
  assert.equal(renders[1][3], 1 << REFLECTION_LAYER);
  assert.equal(camera.layers.mask, oldMask);
  assert.equal(scene.background, background);
  assert.equal(scene.fog, fog);
  assert.equal(paradiseSky.visible, true);
  assert.equal(renderer.clippingPlanes, waterPasses.noClipping);
  assert.deepEqual(events.at(-1), ['target', null]);
  assert.equal(waterPasses.reflectionPlane.constant, -1.95);
  assert.equal(waterPasses.refractionPlane.constant, 2.35);
});

test('cadence skips fresh passes and independently schedules due work', () => {
  const { waterPasses, events } = createFixture();
  const quality = { reflectionHz: 60, refractionHz: 30 };
  waterPasses.render(0, quality);
  const initialRenders = events.filter(event => event[0] === 'render').length;
  waterPasses.render(5, quality);
  assert.equal(events.filter(event => event[0] === 'render').length, initialRenders);

  waterPasses.render(20, quality);
  const laterRenders = events.filter(event => event[0] === 'render');
  assert.equal(laterRenders.length, initialRenders + 1);
  assert.equal(laterRenders.at(-1)[2], waterPasses.mirrorCamera);
});

test('restores scene and camera state when a water pass throws', () => {
  const fixture = createFixture();
  const { waterPasses, renderer, scene, camera, paradiseSky, background, fog } = fixture;
  const oldMask = camera.layers.mask;
  renderer.render = () => { throw new Error('GPU failure'); };
  assert.throws(
    () => waterPasses.render(0, { reflectionHz: 60, refractionHz: 30 }),
    /GPU failure/,
  );
  assert.equal(camera.layers.mask, oldMask);
  assert.equal(scene.background, background);
  assert.equal(scene.fog, fog);
  assert.equal(paradiseSky.visible, true);
  assert.equal(renderer.clippingPlanes, waterPasses.noClipping);
});
