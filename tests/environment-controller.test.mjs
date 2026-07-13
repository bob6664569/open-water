import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  analyzeHdrTexture,
  EnvironmentController,
} from '../site/js/rendering/environment-controller.js';

function createHdrTexture() {
  const width = 8;
  const height = 100;
  const data = new Float32Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 0.1;
    data[index + 1] = 0.1;
    data[index + 2] = 0.1;
    data[index + 3] = 1;
  }
  for (const x of [0, 4]) {
    const horizon = (48 * width + x) * 4;
    data[horizon] = 1;
    data[horizon + 1] = 0.5;
    data[horizon + 2] = 0.25;
  }
  const sun = (20 * width + 4) * 4;
  data[sun] = 10;
  data[sun + 1] = 9;
  data[sun + 2] = 8;
  return { image: { data, width, height }, type: THREE.FloatType, mapping: null };
}

function createFixture({ isTouch = false } = {}) {
  const texture = createHdrTexture();
  const loaderCalls = [];
  const loader = {
    setDataType(type) {
      loaderCalls.push(['dataType', type]);
      return this;
    },
    load(url, onLoad) {
      loaderCalls.push(['load', url]);
      onLoad(texture);
    },
  };
  const pmremTexture = { id: 'pmrem' };
  let pmremDisposed = false;
  const scene = new THREE.Scene();
  const renderer = { toneMappingExposure: 0.85 };
  const waveField = { significantWaveHeight: 1, preset: 2 };
  const sunSprite = new THREE.Object3D();
  sunSprite.material = { opacity: 1 };
  const environment = new EnvironmentController({
    renderer,
    scene,
    waveField,
    isTouch,
    loaderFactory: () => loader,
    pmremFactory: () => ({
      fromEquirectangular: () => ({ texture: pmremTexture }),
      dispose: () => { pmremDisposed = true; },
    }),
    sunSpriteFactory: () => sunSprite,
  });
  return {
    environment,
    texture,
    loaderCalls,
    scene,
    renderer,
    waveField,
    sunSprite,
    pmremTexture,
    get pmremDisposed() { return pmremDisposed; },
  };
}

test('HDR analysis finds the sun and tone-maps the sampled horizon', () => {
  const { sunDirection, fogColor } = analyzeHdrTexture(createHdrTexture());
  assert.ok(Math.abs(sunDirection.length() - 1) < 1e-12);
  assert.ok(sunDirection.y > 0.8);
  assert.ok(Math.abs(fogColor.r - 0.5) < 1e-12);
  assert.ok(Math.abs(fogColor.g - 1 / 3) < 1e-12);
  assert.ok(Math.abs(fogColor.b - 0.2) < 1e-12);
});

test('loads the device HDR, synchronizes sun consumers and releases PMREM work', () => {
  const fixture = createFixture({ isTouch: true });
  const { environment, texture, loaderCalls, scene, sunSprite, pmremTexture } = fixture;
  const ocean = { uniforms: { uSunDir: { value: new THREE.Vector3() } } };
  const boat = {
    calls: [],
    setStartYaw(yaw, applyNow) { this.calls.push([yaw, applyNow]); },
  };
  let snaps = 0;
  let ready = 0;
  environment.load({
    ocean,
    boat,
    cameraController: { snap: () => { snaps++; } },
    onReady: () => { ready++; },
  });

  assert.deepEqual(loaderCalls, [
    ['dataType', THREE.HalfFloatType],
    ['load', './assets/sky_clear_1k.hdr'],
  ]);
  assert.equal(texture.mapping, THREE.EquirectangularReflectionMapping);
  assert.deepEqual(ocean.uniforms.uSunDir.value.toArray(), environment.sun.toArray());
  assert.deepEqual(boat.calls, [[environment.startYaw(), true]]);
  assert.equal(snaps, 1);
  assert.equal(ready, 1);
  assert.equal(scene.background, texture);
  assert.equal(scene.environment, pmremTexture);
  assert.equal(fixture.pmremDisposed, true);
  assert.equal(environment.sunHolder.children.includes(sunSprite), true);
});

test('atmosphere transitions reuse state and retain calm-only sky behavior', () => {
  const { environment, renderer, scene, waveField, sunSprite } = createFixture();
  scene.background = {};
  scene.environment = {};
  scene.backgroundIntensity = 1;
  scene.environmentIntensity = 1;
  environment.sunSprite = sunSprite;
  waveField.significantWaveHeight = 8;
  waveField.preset = 1;
  const fogScratch = environment.atmosphereFogColor;

  environment.updateAtmosphere(1);
  assert.ok(renderer.toneMappingExposure < 0.85);
  assert.ok(scene.backgroundIntensity < 1);
  assert.ok(scene.environmentIntensity < 1);
  assert.ok(environment.sunLight.intensity < 2);
  assert.ok(scene.fog.near < 180);
  assert.ok(scene.fog.far < 640);
  assert.ok(sunSprite.material.opacity < 1);
  assert.ok(environment.paradiseSkyMaterial.uniforms.uCalm.value > 0);
  assert.equal(environment.atmosphereFogColor, fogScratch);
});

test('positions sky and lights without allocating replacement vectors', () => {
  const { environment } = createFixture();
  const holderPosition = environment.sunHolder.position;
  const skyPosition = environment.paradiseSky.position;
  const lightPosition = environment.sunLight.position;
  const cameraPosition = new THREE.Vector3(4, 8, 12);
  const boatPosition = new THREE.Vector3(7, 2, -3);

  environment.positionSunHolder(cameraPosition);
  environment.positionSky(cameraPosition);
  environment.positionSunLight(boatPosition);
  assert.deepEqual(holderPosition.toArray(), [4, 0, 12]);
  assert.deepEqual(skyPosition.toArray(), cameraPosition.toArray());
  assert.deepEqual(environment.sunLight.target.position.toArray(), boatPosition.toArray());
  assert.equal(environment.sunHolder.position, holderPosition);
  assert.equal(environment.paradiseSky.position, skyPosition);
  assert.equal(environment.sunLight.position, lightPosition);
});
