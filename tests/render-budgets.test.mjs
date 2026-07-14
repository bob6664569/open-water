import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ISOLATED = process.env.OCEAN_BOAT_RENDER_CASES === '1';
const UNDER_COVERAGE = process.execArgv.includes('--experimental-test-coverage')
  || Boolean(process.env.NODE_V8_COVERAGE);

if (!ISOLATED) {
  test('render-budget integration cases pass in an isolated DOM runtime', {
    skip: UNDER_COVERAGE ? 'integration suite is exercised by npm test before coverage' : false,
  }, () => {
    const childEnv = { ...process.env, OCEAN_BOAT_RENDER_CASES: '1' };
    delete childEnv.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '--import', './tests/register-three.mjs',
      fileURLToPath(import.meta.url),
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: childEnv,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
} else {
  const THREE = await import('three');
  const { WaveField } = await import('../site/js/simulation/waves.js');

function canvasContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    beginPath() {},
    arc() {},
    ellipse() {},
    fill() {},
    stroke() {},
    moveTo() {},
    quadraticCurveTo() {},
    clearRect() {},
    setTransform() {},
    fillRect() {},
    putImageData() {},
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
}

Object.defineProperties(globalThis, {
  window: { configurable: true, value: {} },
  navigator: { configurable: true, value: { deviceMemory: 8 } },
  matchMedia: { configurable: true, value: () => ({ matches: false }) },
  document: {
    configurable: true,
    value: {
      body: { appendChild() {} },
      createElement: tag => tag === 'canvas'
        ? { width: 0, height: 0, style: {}, getContext: () => canvasContext() }
        : { style: {} },
    },
  },
});

const [
  { Ocean, makeOceanGridGeometry, makeWaterNormalTexture },
  { BoatEffects, turnSpraySpeedBoost },
  { WeatherEffects },
  { PerceptualEffects },
  { Seabed },
  { FoamTrail },
  { VesselAnimationRig },
] = await Promise.all([
  import('../site/js/rendering/ocean.js'),
  import('../site/js/rendering/effects.js'),
  import('../site/js/rendering/weather.js'),
  import('../site/js/rendering/perceptual-effects.js'),
  import('../site/js/fauna/seabed.js'),
  import('../site/js/rendering/foamtrail.js'),
  import('../site/js/simulation/vessel-animations.js'),
]);

test('streamed water-normal generation stays bit-identical', () => {
  const texture = makeWaterNormalTexture(64);
  const hash = createHash('sha256').update(texture.image.data).digest('hex');
  assert.equal(hash, 'ecbe855ea1268bde4299eb4764952d206ae8427b7377c90696a4b66854e38c94');
  texture.dispose();
});

test('adaptive ocean grid preserves coverage while reducing distant triangles', () => {
  const profiles = [192, 320, 512, 768];
  let previousTriangles = 0;
  for (const segments of profiles) {
    const geometry = makeOceanGridGeometry(2200, segments, true);
    geometry.computeBoundingBox();
    const triangles = geometry.index.count / 3;
    assert.ok(triangles > previousTriangles);
    assert.ok(triangles < segments * segments, 'LOD must remove over half the far triangles');
    assert.deepEqual(geometry.boundingBox.min.toArray(), [-1100, 0, -1100]);
    assert.deepEqual(geometry.boundingBox.max.toArray(), [1100, 0, 1100]);
    const [columns, rows] = geometry.userData.gridSize;
    assert.equal(geometry.attributes.position.count, columns * rows);
    assert.equal(geometry.index.count, (columns - 1) * (rows - 1) * 6);
    assert.ok(geometry.userData.snapCell <= 2200 / segments);
    const position = geometry.attributes.position;
    const firstTriangle = [0, 1, 2].map(offset => (
      new THREE.Vector3().fromBufferAttribute(position, geometry.index.array[offset])
    ));
    const normal = new THREE.Triangle(...firstTriangle).getNormal(new THREE.Vector3());
    assert.ok(normal.y > 0.999, 'ocean triangles must remain front-facing from above');
    previousTriangles = triangles;
    geometry.dispose();
  }
});

test('ocean budgets replace geometry only when segment counts change', () => {
  const waveField = new WaveField();
  const ocean = new Ocean(waveField, { oceanFarSegments: 8, oceanPatchSegments: 4 });
  const originalFar = ocean.mesh.geometry;
  const originalPatch = ocean.patch.geometry;
  let farDisposed = false;
  let patchDisposed = false;
  originalFar.addEventListener('dispose', () => { farDisposed = true; });
  originalPatch.addEventListener('dispose', () => { patchDisposed = true; });

  ocean.setPerformanceBudget({ oceanFarSegments: 10, oceanPatchSegments: 6 });

  assert.equal(ocean.farSegments, 10);
  assert.equal(ocean.patchSegments, 6);
  assert.ok(ocean.mesh.geometry.attributes.position.count < 11 * 11);
  assert.equal(ocean.patch.geometry.attributes.position.count, 7 * 7);
  assert.equal(farDisposed, true);
  assert.equal(patchDisposed, true);
  const currentFar = ocean.mesh.geometry;
  const currentPatch = ocean.patch.geometry;
  ocean.setPerformanceBudget({
    oceanFarSegments: 10,
    oceanPatchSegments: 6,
    oceanNormalDetail: 0.58,
  });
  assert.equal(ocean.mesh.geometry, currentFar);
  assert.equal(ocean.patch.geometry, currentPatch);
  assert.equal(ocean.uniforms.uNormalDetail.value, 0.58);

  ocean.setPerformanceBudget({ oceanNormalDetail: 4 });
  assert.equal(ocean.uniforms.uNormalDetail.value, 1);
});

test('wind strengthens micro-ripples without sliding the normal map over waves', () => {
  const ocean = new Ocean(new WaveField(), {
    oceanFarSegments: 8,
    oceanPatchSegments: 4,
  });
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <normal_fragment_begin>',
      '#include <color_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <opaque_fragment>',
      '}',
    ].join('\n'),
  };

  ocean.mesh.material.onBeforeCompile(shader);

  assert.match(shader.fragmentShader, /float windSpeed = length\(uWind\.xz\)/);
  assert.match(shader.fragmentShader, /float worldFootprint = max\(length\(dFdx/);
  assert.match(shader.fragmentShader, /float normalVariance = max\(dot\(normalDx/);
  assert.match(shader.fragmentShader, /float specularKernel = min\(normalVariance/);
  assert.match(shader.fragmentShader, /float detailBlend = smoothstep\(35\.0, 43\.0/);
  assert.match(shader.fragmentShader, /float transitionNoise = ob_transitionNoise/);
  assert.match(shader.fragmentShader, /vec2\(uTime \* 0\.011, uTime \* 0\.006\)/);
  assert.doesNotMatch(shader.fragmentShader, /wind(?:Dir|Cross) \* uTime/);
  assert.match(shader.vertexShader, /uniform vec4 uWake\[WAKE_MAX\]/);
  assert.match(shader.vertexShader, /uniform vec2 uWakeExtra\[WAKE_MAX\]/);
  assert.match(shader.vertexShader, /#if IS_PATCH == 1/);
  assert.equal(shader.uniforms.uCloudiness, ocean.uniforms.uCloudiness);
  assert.equal(shader.uniforms.uCloudOffset, ocean.uniforms.uCloudOffset);
  assert.equal(shader.uniforms.uCloudShadowStrength,
    ocean.uniforms.uCloudShadowStrength);
  assert.equal(shader.uniforms.uNormalDetail, ocean.uniforms.uNormalDetail);
  assert.match(shader.fragmentShader, /float cloudDensity = ob_fbm\(cloudUv\)/);
  assert.match(shader.fragmentShader, /cloudMask \* uCloudShadowStrength/);
});

test('ocean updates reuse uniforms and snap both meshes to their grids', () => {
  const waveField = new WaveField();
  waveField.setWakeField({
    fillUniforms: (_x, _z, wakeUniforms, metaUniforms, extraUniforms) => {
      wakeUniforms[0].set(3, 4, 0.2, 2);
      metaUniforms[0].set(0, 1, 2.1, 1.4);
      extraUniforms[0].set(5.2, 3.4);
      return 1;
    },
  });
  const ocean = new Ocean(waveField, { oceanFarSegments: 10, oceanPatchSegments: 10 });
  const boat = {
    pos: new THREE.Vector3(123.4, 0.2, -87.6),
    quat: new THREE.Quaternion(),
    speedKn: 12,
    wet: 0.8,
    angVelB: new THREE.Vector3(0, 0.3, 0),
    spec: { length: 6.5, beam: 2.1 },
    visualRig: null,
  };

  ocean.update(1 / 60, boat.pos.x, boat.pos.z, boat);

  assert.ok(Math.abs(ocean.mesh.position.x % ocean.farCell) < 1e-12);
  assert.ok(Math.abs(ocean.mesh.position.z % ocean.farCell) < 1e-12);
  assert.ok(Math.abs(ocean.patch.position.x % ocean.patchCell) < 1e-12);
  assert.ok(Math.abs(ocean.patch.position.z % ocean.patchCell) < 1e-12);
  assert.deepEqual(ocean.uniforms.uPatchCenter.value.toArray(), [
    ocean.patch.position.x, ocean.patch.position.z,
  ]);
  assert.equal(ocean.uniforms.uBoatWet.value, boat.wet);
  assert.ok(ocean.uniforms.uBoatTurn.value > 0.5);
  assert.deepEqual(ocean.uniforms.uBoatSize.value.toArray(), [6.5, 2.1]);
  assert.equal(ocean.uniforms.uWakeCount.value, 1);
  assert.deepEqual(ocean.uniforms.uWake.value[0].toArray(), [3, 4, 0.2, 2]);
  assert.deepEqual(ocean.uniforms.uWakeExtra.value[0].toArray(), [5.2, 3.4]);
});

test('particle budgets scale every pool and its GPU draw range', () => {
  const scene = new THREE.Scene();
  const waveField = { heightAt: () => 0 };
  const effects = new BoatEffects(scene, waveField, { spec: { id: 'test' } });

  effects.setPerformanceBudget({ particleScale: 0.25 });

  const expected = [
    [effects.droplets, 400],
    [effects.mist, 100],
    [effects.impactFoam, 300],
    [effects.wakeFoam, 225],
    [effects.turnSheet, 650],
    [effects.turnMist, 300],
    [effects.roosterTail, 1330],
    [effects.roosterMist, 489],
    [effects.exhaustSmoke, 125],
    [effects.exhaustSparks, 162],
    [effects.propWash, 425],
  ];
  for (const [system, limit] of expected) {
    assert.equal(system.activeLimit, limit);
    assert.equal(system.points.geometry.drawRange.count, limit);
    assert.ok(system.cursor < limit);
  }
});

test('racer flame bursts and exhaust pops share the same trigger', () => {
  const scene = new THREE.Scene();
  const boat = {
    group: new THREE.Group(),
    throttle: 1,
    spec: { id: 'boat', maxPropSpeed: 77.2 },
    worldPoint: (point, out) => out.copy(point),
  };
  scene.add(boat.group);
  const effects = new BoatEffects(scene, { heightAt: () => 0 }, boat);
  const exhausts = [[-0.78, 0.96, -6.04], [0.78, 0.96, -6.04]];
  let pop = null;
  effects.onExhaustPop = (strength, position) => { pop = { strength, position: position.clone() }; };

  effects._updateRacerExhaust(1 / 60, boat, 4, exhausts);

  assert.ok(pop?.strength > 0.5);
  assert.deepEqual(pop.position.toArray(), [0, 0.96, -6.04]);
  assert.equal(effects.exhaustFlames.group.visible, true);
  assert.equal(effects.exhaustFlames.lights.length, 2);
  assert.ok(effects.exhaustFlames.lights.every(light => light.intensity > 0));
  assert.deepEqual(
    effects.exhaustFlames.lights.map(light => light.position.toArray()),
    [[-0.78, 0.98, -6.32], [0.78, 0.98, -6.32]],
  );
  for (const mesh of effects.exhaustFlames.ports[0].children) {
    assert.equal(mesh.material.isShaderMaterial, true);
    assert.ok(mesh.material.uniforms.uOpacity.value > 0);
    assert.equal(mesh.layers.mask, 1, 'flames must stay out of the layer-1 water pass');
  }
});

test('racer rooster tail emits a dense ballistic core and a separate mist cloud', () => {
  const scene = new THREE.Scene();
  const waveField = { heightAt: () => 0 };
  const boat = {
    throttle: 1,
    propWet: 1,
    wet: 1,
    vel: new THREE.Vector3(),
    spec: { id: 'boat', beam: 3, restDraft: 0.32, length: 12.8, maxPropSpeed: 77.2 },
    worldPoint: (point, out) => out.copy(point),
  };
  const effects = new BoatEffects(scene, waveField, boat);

  effects._emitRoosterTail(1 / 30, boat, 55, {
    origin: [0, -0.26, -6.05], speedStart: 10, speedFull: 55,
    rate: 1.25, height: 1.15, spread: 1.15,
  });

  assert.ok(effects.roosterTail.activeCount > 50);
  assert.ok(effects.roosterMist.activeCount > 1);
  const particle = effects.roosterTail.activeIndices[0] * 3;
  const insidePlume = new THREE.Vector3(
    effects.roosterTail.pos[particle],
    effects.roosterTail.pos[particle + 1],
    effects.roosterTail.pos[particle + 2],
  );
  assert.ok(
    effects.cameraSprayExposure(insidePlume) > 0.2,
    'a camera inside the rooster tail must register direct spray',
  );
  assert.equal(effects.cameraSprayExposure(new THREE.Vector3(100, 100, 100)), 0);
});

test('turn spray escalates sharply from normal speed to 150-200 knots', () => {
  const normal = turnSpraySpeedBoost(25);
  const at150Kn = turnSpraySpeedBoost(150 / 1.94384);
  const at200Kn = turnSpraySpeedBoost(200 / 1.94384);

  assert.equal(normal, 1);
  assert.ok(at150Kn > 2, '150-knot turns need a violent spray multiplier');
  assert.ok(at200Kn > 3.9, '200-knot turns need the full spray multiplier');
  assert.ok(at200Kn > at150Kn * 1.5);
});

test('the lateral water wall exists at low speed and scales violently by 175 knots', () => {
  const scene = new THREE.Scene();
  const waveField = {
    heightAt: () => 0,
    velocityAt: (_x, _z, out) => out.set(0, 0, 0),
  };
  const makeBoat = speed => ({
    group: new THREE.Group(),
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(0, 0, speed),
    quat: new THREE.Quaternion(),
    throttle: 1,
    propWet: 1,
    wet: 1,
    speedKn: speed * 1.94384,
    steer: 0.9,
    _effSteer: 0.04,
    angVelB: new THREE.Vector3(0, 0.08, 0),
    slam: 0,
    visualRig: null,
    spec: {
      id: 'boat', length: 12.8, beam: 3, restDraft: 0.32,
      maxPropSpeed: 102.9, maxSteerRad: THREE.MathUtils.degToRad(18),
      buoyPoints: [],
      effects: {
        prop: new THREE.Vector3(0, -0.48, -5.7),
      },
    },
    worldPoint(point, out) { return out.copy(point).add(this.pos); },
  });
  const fastBoat = makeBoat(175 / 1.94384);
  scene.add(fastBoat.group);
  const fastEffects = new BoatEffects(scene, waveField, fastBoat);

  fastEffects.update(1 / 30);

  assert.ok(fastEffects.turnSheet.activeCount > 30);
  assert.ok(fastEffects.turnMist.activeCount > 4);
  assert.ok(fastEffects.turnViolence > 1);
  const turnParticle = fastEffects.turnSheet.activeIndices[0] * 3;
  const insideTurnSheet = new THREE.Vector3(
    fastEffects.turnSheet.pos[turnParticle],
    fastEffects.turnSheet.pos[turnParticle + 1],
    fastEffects.turnSheet.pos[turnParticle + 2],
  );
  assert.ok(
    fastEffects.cameraSprayExposure(insideTurnSheet) > 0.2,
    'a camera inside a lateral turn sheet must register direct spray',
  );

  const slowBoat = makeBoat(5);
  const slowEffects = new BoatEffects(new THREE.Scene(), waveField, slowBoat);
  slowEffects.update(1 / 15);
  assert.ok(slowEffects.turnSheet.activeCount > 0);
  assert.ok(fastEffects.turnSheet.activeCount > slowEffects.turnSheet.activeCount * 20);
});

test('particle pools track live slots and coalesce GPU buffer uploads', () => {
  const scene = new THREE.Scene();
  const waveField = { heightAt: () => -100 };
  const effects = new BoatEffects(scene, waveField, { spec: { id: 'test' } });
  const system = effects.droplets;
  const at = system.points.geometry.attributes;
  const initialVersions = [at.position, at.aSize, at.aAlpha, at.aSeed]
    .map(attribute => attribute.version);

  system.update(1 / 60, waveField);
  system.points.onBeforeRender();
  assert.deepEqual(
    [at.position, at.aSize, at.aAlpha, at.aSeed].map(attribute => attribute.version),
    initialVersions,
    'idle pools must not upload unchanged buffers',
  );

  system.setBudget(0.02);
  for (let i = 0; i < system.activeLimit + 5; i++) {
    system.spawn(i, 1, 0, 0, -1, 0, 0.1, 1, 1);
  }
  assert.equal(system.activeLimit, 32);
  assert.equal(system.activeCount, system.activeLimit, 'ring overwrites must not duplicate slots');

  system.points.onBeforeRender();
  const spawnedVersions = [at.position, at.aSize, at.aAlpha, at.aSeed]
    .map(attribute => attribute.version);
  assert.deepEqual(spawnedVersions, initialVersions.map(version => version + 1));
  system.points.onBeforeRender();
  assert.deepEqual(
    [at.position, at.aSize, at.aAlpha, at.aSeed].map(attribute => attribute.version),
    spawnedVersions,
    'multiple render passes must not repeat the same upload',
  );

  system.update(0.2, waveField);
  assert.equal(system.activeCount, 0);
  assert.ok(system.activeSlot.every(slot => slot === -1));
  system.points.onBeforeRender();
  assert.equal(at.aSeed.version, spawnedVersions[3], 'animation must not re-upload seeds');

  const wash = effects.propWash;
  const zero = new THREE.Vector3();
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  wash.spawn(zero, zero, right, up, 1);
  assert.equal(wash.activeCount, 1);
  wash.update(10);
  assert.equal(wash.activeCount, 0);
  wash.clear();
  assert.ok(wash.alpha.every(alpha => alpha === 0));
});

test('weather rain runs as a budgeted GPU-instanced simulation', () => {
  const waveField = {
    significantWaveHeight: 0.35,
    windAt: (_x, _z, out) => out.set(5, 0, 12),
  };
  const weather = new WeatherEffects(
    new THREE.Scene(), new THREE.PerspectiveCamera(),
    waveField, null,
  );

  weather.setPerformanceBudget({ rainScale: 0.3 });
  assert.equal(weather.activeDropCount, 1560);
  assert.equal(weather.rainGeometry.isInstancedBufferGeometry, true);
  assert.equal(weather.rainGeometry.instanceCount, 1560);
  assert.equal(weather.rainGeometry.drawRange.count, 2);
  assert.equal(weather.rainGeometry.attributes.aOrigin.count, 5200);
  assert.equal(weather.rainGeometry.attributes.aMotion.count, 5200);
  assert.equal(weather.rainGeometry.attributes.aSeed.count, 5200);

  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
  };
  weather.rainMaterial.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uRainTime, weather.rainUniforms.uRainTime);
  assert.equal(shader.uniforms.uWindOffset, weather.rainUniforms.uWindOffset);
  assert.equal(shader.uniforms.uWindLean, weather.rainUniforms.uWindLean);
  assert.match(shader.vertexShader, /attribute vec3 aOrigin/);
  assert.match(shader.vertexShader, /rawY \+ cycle \* 58\.0/);

  waveField.significantWaveHeight = 6;
  const versions = Object.fromEntries(Object.entries(weather.rainGeometry.attributes)
    .map(([name, attribute]) => [name, attribute.version]));
  weather.update(1);
  assert.ok(weather.rainUniforms.uRainTime.value > 0);
  assert.deepEqual(weather.rainUniforms.uWindOffset.value.toArray(), [5, 12]);
  assert.deepEqual(
    weather.rainUniforms.uWindLean.value.toArray(), [5 / 42, 12 / 42],
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(weather.rainGeometry.attributes)
      .map(([name, attribute]) => [name, attribute.version])),
    versions,
    'rain animation must not upload geometry buffers',
  );

  weather.setPerformanceBudget({ rainScale: 0 });
  assert.equal(weather.activeDropCount, 400, 'minimum rain density must remain visible');
  assert.equal(weather.rainGeometry.instanceCount, 400);
});

test('perceptual rain uses one budgeted ripple draw and physically triggered lens spray', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
  camera.position.set(0, 4, 0);
  camera.lookAt(0, 2, 20);
  const waveField = {
    significantWaveHeight: 6,
    heightAt: (x, z) => Math.sin(x * 0.15 + z * 0.08) * 1.8,
  };
  const boat = {
    pos: new THREE.Vector3(0, 0, 1),
    vel: new THREE.Vector3(0, 0, 16),
    slam: 0,
    slamSpeed: 0,
    throttle: 1,
    propWet: 1,
    steer: 0,
    _effSteer: 0,
    angVelB: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    spec: { length: 20, beam: 4 },
  };
  const effects = new PerceptualEffects({
    scene, camera, boat, waveField,
    viewportWidth: () => 800,
    viewportHeight: () => 600,
    devicePixelRatio: () => 2,
  });

  effects.setPerformanceBudget({ rainScale: 0.3 });
  assert.equal(effects.activeRippleCount, 28);
  assert.equal(effects.rippleGeometry.instanceCount, 28);
  assert.equal(effects.rippleGeometry.attributes.aCenter.count, 96);
  effects.update(0.25, 1, 1);
  assert.ok(effects.rippleCursor > 0);
  assert.equal(effects.ripples.visible, true);

  boat.slam = 1.2;
  boat.slamSpeed = 8;
  effects.update(1 / 60, 1, 1);
  assert.ok(effects.sprayVeil > 0);
  assert.ok(effects.lensDrops.length > 0);
  assert.equal(effects.lensCanvas.width, 368, 'lens refraction mask stays below scene resolution');

  effects.lensDrops.length = 0;
  effects.update(1 / 60, 0, 1, 1);
  assert.ok(effects.sprayVeil > 0.9, 'a physical spray intersection must veil the lens');
  assert.ok(
    effects.lensDrops.filter(drop => drop.kind === 'cameraSpray').length >= 20,
    'entering a dense spray plume must soak the camera in one moving burst',
  );

  camera.position.set(0, 5, -15);
  boat.pos.set(0, 0, 0);
  boat.vel.set(0, 0, 86);
  boat.slam = 0;
  effects.lensDrops.length = 0;
  effects.update(0.5, 0, 0);
  assert.ok(effects.sprayVeil > 0.3, 'a chase camera inside a fast rooster tail must get wet');
  assert.ok(effects.lensDrops.length > 0);

  effects.lensDrops.length = 0;
  effects.plumeDropAccumulator = 0;
  boat.propWet = 0;
  boat.vel.set(0, 0, 18);
  boat.angVelB.y = 0.24;
  boat._effSteer = 0.16;
  waveField.significantWaveHeight = 0.35;
  for (let i = 0; i < 240; i++) effects.update(1 / 60, 0, 0);
  assert.ok(
    effects.lensDrops.some(drop => drop.kind === 'turn'),
    'turning should throw a few drops even in a calm sea',
  );

  effects.lensDrops.length = 0;
  effects.rainDropAccumulator = 0;
  boat.vel.set(0, 0, 0);
  boat.angVelB.y = 0;
  boat._effSteer = 0;
  waveField.significantWaveHeight = 6;
  for (let i = 0; i < 240; i++) effects.update(1 / 60, 1, 1);
  const persistentRain = effects.lensDrops.filter(drop => drop.kind === 'rain');
  assert.ok(persistentRain.length >= 4, 'storm rain should keep the lens continuously wet');

  effects.lensDrops.length = 0;
  effects.rainDropAccumulator = 0;
  waveField.preset = 4;
  effects.update(1 / 60, 0, 1);
  const immediateStormRain = effects.lensDrops.filter(drop => drop.kind === 'rain');
  assert.ok(
    immediateStormRain.length >= 1 && immediateStormRain.length <= 3,
    'the Storm preset must begin progressively instead of force-filling a frozen pool',
  );
  assert.equal(effects.lensPass.enabled, true, 'Storm must enable the wet-lens pass immediately');
  const initialStormSeeds = new Set(immediateStormRain.map(drop => drop.seed));
  const firstStormDrop = immediateStormRain[0];
  const firstStormY = firstStormDrop.y;
  for (let i = 0; i < 60; i++) effects.update(1 / 60, 0, 1);
  assert.ok(
    !effects.lensDrops.includes(firstStormDrop) || firstStormDrop.y > firstStormY + 0.005,
    'storm drops must visibly run down the lens or leave the frame',
  );
  assert.ok(
    effects.lensDrops.filter(drop => drop.kind === 'rain').length > immediateStormRain.length,
    'Storm must add rain over time rather than as one synchronous batch',
  );
  for (let i = 0; i < 360; i++) effects.update(1 / 60, 0, 1);
  assert.ok(
    effects.lensDrops.some(drop => !initialStormSeeds.has(drop.seed)),
    'storm coverage must continuously replace expired droplets',
  );

  effects.lensDrops.length = 0;
  waveField.preset = 3;
  effects._spawnLensDrop('rain', 1);
  const drainingDrop = effects.lensDrops[0];
  drainingDrop.age = drainingDrop.life * 0.76;
  const beforeDrainY = drainingDrop.y;
  effects.update(0.1, 0, 1);
  assert.ok(drainingDrop.y > beforeDrainY, 'old drops should run down the lens');
  assert.ok(drainingDrop.fade > 0 && drainingDrop.fade < 1, 'old drops should fade before removal');
});

test('seabed quality profiles change instance counts without rebuilding meshes', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const boat = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
  const seabed = new Seabed(scene, camera, { preset: 2 }, boat);
  const meshes = [...seabed.reefMeshes];

  seabed.setPerformanceBudget({ id: 'low' });
  assert.deepEqual(seabed.reefMeshes.map(mesh => mesh.count), [6, 4, 5, 5, 24, 42]);
  seabed.setPerformanceBudget({ id: 'ultra' });
  assert.deepEqual(seabed.reefMeshes.map(mesh => mesh.count), [22, 16, 17, 14, 96, 170]);
  assert.deepEqual(seabed.reefMeshes, meshes);
});

test('seabed updates reuse their recycling scratch collections', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const boat = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
  const seabed = new Seabed(scene, camera, { preset: 1 }, boat);
  const dirtyMeshes = seabed._dirtyReefMeshes;
  const reefPool = seabed._reefBuddyPool;
  const starPool = seabed._starBuddyPool;

  seabed.update(1 / 60);
  seabed.update(1 / 60);

  assert.equal(seabed._dirtyReefMeshes, dirtyMeshes);
  assert.equal(seabed._reefBuddyPool, reefPool);
  assert.equal(seabed._starBuddyPool, starPool);
});

test('vessel rigs reuse propeller world-position vectors', () => {
  const model = new THREE.Group();
  for (const [name, x] of [['left-prop', -1], ['right-prop', 1]]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    mesh.name = name;
    mesh.position.x = x;
    model.add(mesh);
  }
  const rig = new VesselAnimationRig(model, {
    rig: {
      nodePropellers: [
        { node: 'left-prop' },
        { node: 'right-prop' },
      ],
    },
  });
  model.updateMatrixWorld(true);
  const target = rig.getPropellerWorldPositions([]);
  const references = [...target];
  const firstPositions = target.map(position => position.clone());

  model.position.x = 5;
  model.updateMatrixWorld(true);
  const reused = rig.getPropellerWorldPositions(target);

  assert.equal(reused, target);
  assert.ok(reused.every((position, i) => position === references[i]));
  assert.ok(reused.every((position, i) => position.x === firstPositions[i].x + 5));
});

test('vessel rigs skip inactive animation inputs without changing active motion', () => {
  const unusedInput = name => ({
    get() { throw new Error(`${name} should not be read`); },
  });
  const staticRig = new VesselAnimationRig(new THREE.Group(), { rig: {} });
  const staticBoat = {};
  Object.defineProperties(staticBoat, {
    _effSteer: unusedInput('steering'),
    throttle: unusedInput('throttle'),
    wf: unusedInput('wave field'),
    speedKn: unusedInput('speed'),
  });
  staticRig.update(0.25, staticBoat);
  assert.equal(staticRig._time, 0.25);

  const propellerRig = new VesselAnimationRig(new THREE.Group(), { rig: {} });
  const pivot = new THREE.Group();
  propellerRig.propellers.push({
    pivot, axis: 'z', handedness: -1,
  });
  const propellerBoat = { throttle: 0.5 };
  Object.defineProperties(propellerBoat, {
    _effSteer: unusedInput('steering'),
    wf: unusedInput('wave field'),
    speedKn: unusedInput('speed'),
  });
  propellerRig.update(0.25, propellerBoat);
  assert.equal(pivot.rotation.z, -3.625);
});

test('telescoping steering counter-moves its two hydraulic rods', () => {
  const model = new THREE.Group();
  const rudder = new THREE.Group();
  rudder.name = 'rudder';
  rudder.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 3, 2), new THREE.MeshBasicMaterial(),
  ));
  model.add(rudder);
  const makeActuator = (name, outer, inner) => {
    const start = new THREE.Vector3().fromArray(outer);
    const end = new THREE.Vector3().fromArray(inner);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const geometry = new THREE.CylinderGeometry(0.25, 0.25, length, 8, 4);
    geometry.rotateX(Math.PI / 2);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), direction.normalize(),
    ));
    geometry.translate(
      (start.x + end.x) * 0.5,
      (start.y + end.y) * 0.5,
      (start.z + end.z) * 0.5,
    );
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = name;
    model.add(mesh);
  };
  makeActuator('port-actuator', [-4, 0, 0], [-1, 0, 10]);
  makeActuator('starboard-actuator', [4, 0, 0], [1, 0, 10]);

  const rig = new VesselAnimationRig(model, {
    rig: {
      telescopingSteering: {
        nodes: ['rudder'], pivot: [0, 0, 8], axis: 'y',
        actuators: [
          {
            mesh: 'port-actuator', outer: [-4, 0, 0], inner: [-1, 0, 10],
            rodBase: 0.7, rodSplit: 0.7,
          },
          {
            mesh: 'starboard-actuator', outer: [4, 0, 0], inner: [1, 0, 10],
            rodBase: 0.7, rodSplit: 0.7,
          },
        ],
      },
    },
  });
  assert.equal(rig.steeringActuators.length, 2);
  assert.equal(model.getObjectByName('port-actuator').visible, false);

  rig.update(1, { _effSteer: 0.25, throttle: 0 });
  const scales = rig.steeringActuators.map(({ rodFrame }) => rodFrame.scale.z);
  assert.ok(
    (scales[0] - 1) * (scales[1] - 1) < 0,
    'one rod should retract while the other extends',
  );
  assert.ok(Math.abs(rig.steerPivots[0].pivot.rotation.y) > 0.2);
});

test('foam trail batches every active splat into one instanced draw', () => {
  const foam = new FoamTrail();
  const renderCalls = [];
  const renderer = {
    setRenderTarget() {},
    render: (scene, camera) => renderCalls.push({ scene, camera }),
  };
  const boat = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    speedKn: 14,
    wet: 0.8,
    slam: 0,
    spec: {
      length: 6.5,
      beam: 2.1,
      effects: { wakeOrigin: new THREE.Vector3(), wakeHalfWidth: 0.7 },
    },
    worldPoint(point, out) { return out.copy(point).add(this.pos); },
  };

  foam.update(renderer, 1 / 60, boat);
  boat.pos.x = 2;
  foam.update(renderer, 1 / 60, boat);

  assert.equal(foam.splats.isInstancedMesh, true);
  assert.equal(foam.scene.children.length, 2, 'fade quad plus one splat batch');
  assert.ok(foam.splats.count > 0);
  assert.ok(foam.splats.count <= 56);
  assert.equal(foam.splats.geometry.attributes.aOpacity.count, 56);
  assert.equal(renderCalls.length, 2);
});
}
