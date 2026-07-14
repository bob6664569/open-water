import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../site/js/main.js', import.meta.url), 'utf8');

test('main delegates driving, cameras and water passes to focused runtime controllers', () => {
  for (const contract of [
    "import { DriveController } from './controllers/drive-controller.js';",
    "import { WakeField } from './simulation/wake-field.js';",
    "import { CameraController } from './controllers/camera-controller.js';",
    "import { WaterPassRenderer } from './rendering/water-pass-renderer.js';",
    "import { EnvironmentController } from './rendering/environment-controller.js';",
    "import { VesselController } from './controllers/vessel-controller.js';",
    "import { GestureDriveController } from './controllers/gesture-drive-controller.js';",
    "import { ViewInputController } from './controllers/view-input-controller.js';",
    "import { QualityController } from './runtime/quality-controller.js';",
    "import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';",
    "import { ColorGrading } from './rendering/color-grading.js';",
    "import { VesselOcclusionPass } from './rendering/vessel-occlusion.js';",
    "import { ExperienceController } from './ui/experience-controller.js';",
    'const drive = new DriveController(',
    'const wakeField = new WakeField(',
    'const cameraController = new CameraController(',
    'const waterPasses = new WaterPassRenderer(',
    'const environment = new EnvironmentController(',
    'const vessels = new VesselController(',
    'const gestureDrive = new GestureDriveController(',
    'const viewInput = new ViewInputController(',
    'const qualityController = new QualityController(',
    'const smaa = new SMAAPass(',
    'const colorGrading = new ColorGrading(',
    'const vesselOcclusion = new VesselOcclusionPass(',
    'experience = new ExperienceController(',
    'void vessels.loadCatalog();',
    'drive.update(dt, waveField.time, gestureDrive.state);',
    'cameraController.update(dt);',
    'qualityController.applyPending();',
    'experience.frameRendered();',
    'waterPasses.render(frameStart, qualityController.current);',
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
    'wakeField.update(',
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
    'colorGrading.update(',
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

test('color grading runs before SMAA and output conversion', () => {
  const gradeIndex = mainSource.indexOf('composer.addPass(colorGrading.pass);');
  const smaaIndex = mainSource.indexOf('composer.addPass(smaa);');
  const outputIndex = mainSource.indexOf('composer.addPass(new OutputPass());');
  assert.ok(gradeIndex >= 0 && gradeIndex < smaaIndex);
  assert.ok(smaaIndex < outputIndex);
});

test('vessel occlusion is composed before bloom and color grading', () => {
  const occlusionIndex = mainSource.indexOf('composer.addPass(vesselOcclusion);');
  const bloomIndex = mainSource.indexOf('composer.addPass(bloom);');
  const gradeIndex = mainSource.indexOf('composer.addPass(colorGrading.pass);');
  assert.ok(occlusionIndex >= 0 && occlusionIndex < bloomIndex);
  assert.ok(bloomIndex < gradeIndex);
});

test('quality reallocations stay before rendering and resize delegates to the controller', () => {
  const loopStart = mainSource.indexOf('renderer.setAnimationLoop(() => {');
  const frameLoop = mainSource.slice(loopStart);
  const qualityIndex = frameLoop.indexOf('qualityController.applyPending();');
  const renderIndex = frameLoop.indexOf('waterPasses.render(');
  assert.ok(qualityIndex >= 0 && renderIndex > qualityIndex);
  assert.ok(mainSource.includes('qualityController.resize();'));
});
