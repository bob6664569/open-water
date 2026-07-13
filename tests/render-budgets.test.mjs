import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const [{ Ocean }, { BoatEffects }, { WeatherEffects }, { Seabed }, { FoamTrail }] = await Promise.all([
  import('../site/js/ocean.js'),
  import('../site/js/effects.js'),
  import('../site/js/weather.js'),
  import('../site/js/seabed.js'),
  import('../site/js/foamtrail.js'),
]);

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

test('weather rain budget updates CPU work and GPU draw range together', () => {
  const weather = new WeatherEffects(
    new THREE.Scene(), new THREE.PerspectiveCamera(),
    { significantWaveHeight: 0.35 }, null,
  );

  weather.setPerformanceBudget({ rainScale: 0.3 });
  assert.equal(weather.activeDropCount, 1560);
  assert.equal(weather.rainGeometry.drawRange.count, 3120);

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
