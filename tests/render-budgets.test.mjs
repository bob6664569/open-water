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
  const { WaveField } = await import('../site/js/waves.js');

function canvasContext() {
  return {
    fillStyle: '',
    beginPath() {},
    arc() {},
    fill() {},
    fillRect() {},
    putImageData() {},
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    createRadialGradient: () => ({ addColorStop() {} }),
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
        ? { width: 0, height: 0, getContext: () => canvasContext() }
        : { style: {} },
    },
  },
});

const [
  { Ocean, makeWaterNormalTexture },
  { BoatEffects },
  { WeatherEffects },
  { Seabed },
  { FoamTrail },
  { VesselAnimationRig },
] = await Promise.all([
  import('../site/js/ocean.js'),
  import('../site/js/effects.js'),
  import('../site/js/weather.js'),
  import('../site/js/seabed.js'),
  import('../site/js/foamtrail.js'),
  import('../site/js/vessel-animations.js'),
]);

test('streamed water-normal generation stays bit-identical', () => {
  const texture = makeWaterNormalTexture(64);
  const hash = createHash('sha256').update(texture.image.data).digest('hex');
  assert.equal(hash, 'ecbe855ea1268bde4299eb4764952d206ae8427b7377c90696a4b66854e38c94');
  texture.dispose();
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
  assert.equal(ocean.mesh.geometry.attributes.position.count, 11 * 11);
  assert.equal(ocean.patch.geometry.attributes.position.count, 7 * 7);
  assert.equal(farDisposed, true);
  assert.equal(patchDisposed, true);
  const currentFar = ocean.mesh.geometry;
  const currentPatch = ocean.patch.geometry;
  ocean.setPerformanceBudget({ oceanFarSegments: 10, oceanPatchSegments: 6 });
  assert.equal(ocean.mesh.geometry, currentFar);
  assert.equal(ocean.patch.geometry, currentPatch);
});

test('ocean updates reuse uniforms and snap both meshes to their grids', () => {
  const waveField = new WaveField();
  const ocean = new Ocean(waveField, { oceanFarSegments: 10, oceanPatchSegments: 10 });
  const boat = {
    pos: new THREE.Vector3(123.4, 0.2, -87.6),
    quat: new THREE.Quaternion(),
    speedKn: 12,
    wet: 0.8,
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
  assert.deepEqual(ocean.uniforms.uBoatSize.value.toArray(), [6.5, 2.1]);
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
    [effects.propWash, 425],
  ];
  for (const [system, limit] of expected) {
    assert.equal(system.activeLimit, limit);
    assert.equal(system.points.geometry.drawRange.count, limit);
    assert.ok(system.cursor < limit);
  }
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

test('weather rain budget updates CPU work and GPU draw range together', () => {
  const waveField = { significantWaveHeight: 0.35 };
  const weather = new WeatherEffects(
    new THREE.Scene(), new THREE.PerspectiveCamera(),
    waveField, null,
  );

  weather.setPerformanceBudget({ rainScale: 0.3 });
  assert.equal(weather.activeDropCount, 1560);
  assert.equal(weather.rainGeometry.drawRange.count, 3120);
  assert.equal(weather.dropX instanceof Float64Array, true);
  assert.equal(weather.dropY instanceof Float64Array, true);
  assert.equal(weather.dropZ instanceof Float64Array, true);
  assert.equal(
    weather.rainGeometry.attributes.position.usage,
    THREE.DynamicDrawUsage,
  );

  waveField.significantWaveHeight = 6;
  weather.update(1);
  assert.deepEqual(
    weather.rainGeometry.attributes.position.updateRanges,
    [{ start: 0, count: weather.activeDropCount * 6 }],
    'only active rain vertices should be uploaded',
  );

  weather.setPerformanceBudget({ rainScale: 0 });
  assert.equal(weather.activeDropCount, 400, 'minimum rain density must remain visible');
  assert.equal(weather.rainGeometry.drawRange.count, 800);
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
