import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  analyzeHdrTexture,
  atmosphericDepthForCloudiness,
  cloudinessForWaveHeight,
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

test('cloud cover follows every sea preset and clamps beyond the authored range', () => {
  assert.equal(cloudinessForWaveHeight(0), 0);
  assert.equal(cloudinessForWaveHeight(0.35), 0);
  assert.equal(cloudinessForWaveHeight(0.9), 0.24);
  assert.equal(cloudinessForWaveHeight(2.4), 0.62);
  assert.equal(cloudinessForWaveHeight(5.2), 1);
  assert.equal(cloudinessForWaveHeight(20), 1);
  assert.ok(cloudinessForWaveHeight(1.5) > 0.24);
  assert.ok(cloudinessForWaveHeight(1.5) < 0.62);
});

test('atmospheric depth thickens progressively without reaching the near field', () => {
  const profiles = [0, 0.24, 0.62, 1]
    .map(value => atmosphericDepthForCloudiness(value));
  assert.deepEqual(
    profiles.map(profile => profile.fogNear),
    [...profiles.map(profile => profile.fogNear)].sort((a, b) => b - a),
  );
  assert.deepEqual(
    profiles.map(profile => profile.fogFar),
    [...profiles.map(profile => profile.fogFar)].sort((a, b) => b - a),
  );
  assert.deepEqual(
    profiles.map(profile => profile.haze),
    [...profiles.map(profile => profile.haze)].sort((a, b) => a - b),
  );
  assert.equal(atmosphericDepthForCloudiness(-2).fogFar, profiles[0].fogFar);
  assert.equal(atmosphericDepthForCloudiness(3).fogFar, profiles[3].fogFar);
  assert.ok(profiles[3].fogNear > 40);
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
  const depthScratch = environment.atmosphereTarget;
  const cloudOffset = environment.cloudOffset;
  const initialCloudiness = environment.cloudiness;
  const initialFogNear = scene.fog.near;
  const initialFogFar = scene.fog.far;
  const initialHaze = environment.paradiseSkyMaterial.uniforms.uHaze.value;

  environment.updateAtmosphere(1);
  assert.ok(renderer.toneMappingExposure < 0.85);
  assert.ok(scene.backgroundIntensity < 1);
  assert.ok(scene.environmentIntensity < 1);
  assert.ok(environment.sunLight.intensity < 2);
  assert.ok(scene.fog.near > initialFogNear);
  assert.ok(scene.fog.far > initialFogFar);
  assert.ok(environment.paradiseSkyMaterial.uniforms.uHaze.value < initialHaze);
  assert.ok(sunSprite.material.opacity < 1);
  assert.ok(environment.paradiseSkyMaterial.uniforms.uCalm.value > 0);
  assert.ok(environment.cloudiness < initialCloudiness);
  assert.equal(environment.paradiseSkyMaterial.uniforms.uCloudiness.value,
    environment.cloudiness);
  assert.equal(environment.cloudOffset, cloudOffset);
  assert.equal(environment.atmosphereFogColor, fogScratch);
  assert.equal(environment.atmosphereTarget, depthScratch);
  assert.equal(environment.paradiseSkyMaterial.uniforms.uFogColor.value,
    scene.fog.color);
  assert.match(environment.paradiseSkyMaterial.fragmentShader, /hazeShape/);
  assert.match(environment.paradiseSkyMaterial.fragmentShader, /uFogColor \* hazeAlpha/);
});

test('clouds build in a crescendo, drift with wind and clear completely in Paradise', () => {
  const { environment, waveField } = createFixture();
  const ocean = {
    uniforms: {
      uCloudiness: { value: 0 },
      uCloudOffset: { value: new THREE.Vector2() },
      uCloudShadowStrength: { value: 0 },
    },
  };
  environment.ocean = ocean;
  environment.cloudiness = 0;
  waveField.windSpeed = 10;
  waveField.windDirection = Math.PI / 2;

  waveField.preset = 2;
  waveField.significantWaveHeight = 0.9;
  for (let i = 0; i < 8; i++) environment.updateAtmosphere(0.5);
  const rolling = environment.cloudiness;
  assert.ok(rolling > 0.22 && rolling < 0.25);
  assert.ok(Math.abs(environment.cloudOffset.x) < 1e-12);
  assert.ok(environment.cloudOffset.y > 0);

  waveField.preset = 3;
  waveField.significantWaveHeight = 2.4;
  for (let i = 0; i < 8; i++) environment.updateAtmosphere(0.5);
  const rough = environment.cloudiness;
  assert.ok(rough > rolling);

  waveField.preset = 4;
  waveField.significantWaveHeight = 5.2;
  for (let i = 0; i < 10; i++) environment.updateAtmosphere(0.5);
  assert.ok(environment.cloudiness > rough);
  assert.ok(ocean.uniforms.uCloudShadowStrength.value > 0.7);

  waveField.preset = 1;
  for (let i = 0; i < 8; i++) environment.updateAtmosphere(0.5);
  assert.ok(environment.cloudiness < 0.0001);
  assert.ok(ocean.uniforms.uCloudiness.value < 0.0001);
  assert.ok(ocean.uniforms.uCloudShadowStrength.value < 0.0001);
});

test('cloud rendering quality scales shader detail and water-shadow work', () => {
  const { environment } = createFixture();
  const ocean = {
    uniforms: {
      uCloudiness: { value: 0 },
      uCloudOffset: { value: new THREE.Vector2() },
      uCloudShadowStrength: { value: 0 },
    },
  };
  environment.ocean = ocean;
  environment.cloudiness = 0.8;

  environment.setPerformanceBudget({ cloudOctaves: 2, cloudShadowScale: 0 });
  assert.equal(environment.paradiseSkyMaterial.defines.CLOUD_OCTAVES, 2);
  assert.equal(ocean.uniforms.uCloudShadowStrength.value, 0);

  environment.setPerformanceBudget({ cloudOctaves: 5, cloudShadowScale: 1 });
  assert.equal(environment.paradiseSkyMaterial.defines.CLOUD_OCTAVES, 5);
  assert.equal(ocean.uniforms.uCloudShadowStrength.value, 0.8);
  assert.match(environment.paradiseSkyMaterial.fragmentShader, /cloudFbm/);
  assert.match(environment.paradiseSkyMaterial.fragmentShader, /uLightning/);
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
