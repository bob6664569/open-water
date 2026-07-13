import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../site/js/main.js', import.meta.url), 'utf8');

test('main delegates driving, cameras and water passes to focused runtime controllers', () => {
  for (const contract of [
    "import { DriveController } from './drive-controller.js';",
    "import { CameraController } from './camera-controller.js';",
    "import { WaterPassRenderer } from './water-pass-renderer.js';",
    "import { EnvironmentController } from './environment-controller.js';",
    'const drive = new DriveController(',
    'const cameraController = new CameraController(',
    'const waterPasses = new WaterPassRenderer(',
    'const environment = new EnvironmentController(',
    'drive.update(dt, waveField.time, gestureState);',
    'cameraController.update(dt);',
    'waterPasses.render(frameStart, currentQuality);',
  ]) {
    assert.ok(mainSource.includes(contract), `missing runtime contract: ${contract}`);
  }
});

test('the frame loop preserves simulation and rendering dependency order', () => {
  const loopStart = mainSource.indexOf('renderer.setAnimationLoop(() => {');
  assert.notEqual(loopStart, -1);
  const frameLoop = mainSource.slice(loopStart);
  const orderedSteps = [
    'waveField.update(',
    'environment.updateAtmosphere(',
    'drive.update(',
    'boat.update(',
    'achievements.update(',
    'ocean.update(',
    'foamTrail.update(',
    'effects.update(',
    'cameraController.update(',
    'firstVoyageGuide.update(',
    'audio.update(',
    'weather.update(',
    'fauna.update(',
    'boatHud.update(',
    'performanceManager.beginGpu(',
    'waterPasses.render(',
    'composer.render(',
    'performanceManager.endGpu(',
    'performanceManager.endFrame(',
  ];
  let previousIndex = -1;
  for (const step of orderedSteps) {
    const index = frameLoop.indexOf(step);
    assert.ok(index > previousIndex, `${step} moved before a required dependency`);
    previousIndex = index;
  }
});

test('quality changes resize water targets before delegating subsystem budgets', () => {
  const applyStart = mainSource.indexOf('function applyQuality(');
  const applyEnd = mainSource.indexOf('\nfunction queueQuality(', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const applyQuality = mainSource.slice(applyStart, applyEnd);
  const waterIndex = applyQuality.indexOf('waterPasses.setQuality(');
  const boatIndex = applyQuality.indexOf('boat.setPerformanceBudget(');
  assert.ok(waterIndex >= 0);
  assert.ok(boatIndex > waterIndex);
});
