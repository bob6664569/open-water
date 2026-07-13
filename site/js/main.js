import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WaveField, SEA_PRESETS } from './simulation/waves.js';
import { Boat } from './simulation/boat.js';
import { Ocean } from './rendering/ocean.js';
import { BoatEffects } from './rendering/effects.js';
import { FoamTrail } from './rendering/foamtrail.js';
import { WeatherEffects } from './rendering/weather.js';
import { WaterPassRenderer } from './rendering/water-pass-renderer.js';
import { EnvironmentController } from './rendering/environment-controller.js';
import { createFaunaManager } from './fauna/index.js';
import { BoatAudio } from './runtime/audio.js';
import { PerformanceManager } from './runtime/performance.js';
import { QualityController } from './runtime/quality-controller.js';
import { AchievementManager } from './ui/achievements.js';
import { FirstVoyageGuide } from './ui/first-voyage.js';
import { BoatHud } from './ui/hud.js';
import { DriveController } from './controllers/drive-controller.js';
import { CameraController } from './controllers/camera-controller.js';
import { VesselController } from './controllers/vessel-controller.js';
import { GestureDriveController } from './controllers/gesture-drive-controller.js';
import { ViewInputController } from './controllers/view-input-controller.js';

document.addEventListener('selectstart', (event) => event.preventDefault());

const IS_TOUCH = new URLSearchParams(location.search).has('touch')
  || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', IS_TOUCH);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
const performanceManager = new PerformanceManager(renderer, { isTouch: IS_TOUCH });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(-12, 5, -12);
const waveField = new WaveField();
const environment = new EnvironmentController({
  renderer,
  scene,
  waveField,
  isTouch: IS_TOUCH,
});
const { sunLight, paradiseSky } = environment;
const ocean = new Ocean(waveField, performanceManager.quality);
scene.add(ocean.mesh);
scene.add(ocean.patch);
const boat = new Boat(waveField, scene, environment.startYaw());
const effects = new BoatEffects(scene, waveField, boat);
const audio = new BoatAudio(waveField);
effects.onExhaustPop = (intensity, position) => audio.exhaustPop(intensity, position);
const foamTrail = new FoamTrail();
const weather = new WeatherEffects(scene, camera, waveField, audio);
const fauna = createFaunaManager({ scene, camera, waveField, boat, audio });
const achievements = new AchievementManager();
const drive = new DriveController(boat, {
  isTouch: IS_TOUCH,
  auto: () => location.hash === '#auto',
});
const cameraController = new CameraController({
  camera,
  boat,
  waveField,
  achievements,
  isTouch: IS_TOUCH,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  statusElement: document.getElementById('camera-status'),
});
const firstVoyageGuide = new FirstVoyageGuide({
  scene, camera, boat, waveField, achievements,
  fish: fauna.fish,
  wildlife: fauna.wildlife,
});
achievements.button?.addEventListener('click', () => {
  document.body.classList.remove('achievement-trial-visible');
});

const WAVE_INTENSITY_KEY = 'ocean-boat:wave-intensity';
const initialLoader = document.getElementById('loading');
const welcome = document.getElementById('welcome');
const startButton = document.getElementById('start-experience');
const helpHint = document.getElementById('help');
const waveControls = document.getElementById('controls');
let initialBoatReady = false;
let skyReady = false;
let renderedFrames = 0;
let appStarted = false;
const vessels = new VesselController({
  boat,
  achievements,
  cameraController,
  audio,
  isTouch: IS_TOUCH,
  body: document.body,
  elements: {
    loader: document.getElementById('boat-loading'),
    selector: document.getElementById('vessel-selector'),
    name: document.getElementById('boatname'),
    position: document.getElementById('boat-position'),
    previousButton: document.getElementById('prev-boat'),
    nextButton: document.getElementById('next-boat'),
    unlockAlert: document.getElementById('vessel-unlock-alert'),
    unlockName: document.getElementById('vessel-unlock-name'),
    unlockHint: document.getElementById('vessel-unlock-hint'),
  },
  isAppStarted: () => appStarted,
  onInitialReady: () => {
    initialBoatReady = true;
    finishInitialLoadingWhenReady();
  },
  revealDock: delay => revealAfter('dock-revealed', delay),
});
vessels.bind();

function seaControlsUnlocked() {
  return achievements.isRewardUnlocked('azure');
}

function syncSeaControlAccess() {
  const unlocked = seaControlsUnlocked();
  if (waveControls) {
    waveControls.inert = !unlocked;
    waveControls.setAttribute('aria-hidden', String(!unlocked));
  }
  if (!unlocked) document.body.classList.remove('controls-revealed');
}

addEventListener('ocean-boat:reward-unlocked', event => {
  vessels.handleRewardUnlocked(event.detail?.reward);
  if (event.detail?.reward === 'azure') {
    syncSeaControlAccess();
    if (appStarted) revealAfter('controls-revealed', 900);
  }
  if (helpHint && !IS_TOUCH && !helpHint.classList.contains('help-dismissed')) buildHelpHint();
});

function finishInitialLoadingWhenReady() {
  if (initialLoader.classList.contains('done')) return;
  if (initialBoatReady && skyReady && renderedFrames >= 3) {
    initialLoader.classList.add('done');
    welcome?.classList.add('ready');
    setTimeout(() => {
      if (!appStarted) startButton?.focus({ preventScroll: true });
    }, 620);
  }
}

const HELP_VISIBLE_DURATION = 20_000;
let helpDismissTimer = null;

const DOCK_REVEAL_DELAY = 4_000;
const CONTROLS_REVEAL_DELAY = DOCK_REVEAL_DELAY + 3_000;
const revealTimers = [];

function revealAfter(className, delay) {
  revealTimers.push(setTimeout(() => document.body.classList.add(className), delay));
}

function scheduleControlReveals() {
  revealTimers.forEach(clearTimeout);
  revealTimers.length = 0;
  if (vessels.selectionUnlocked()) revealAfter('dock-revealed', DOCK_REVEAL_DELAY);
  if (seaControlsUnlocked()) revealAfter('controls-revealed', CONTROLS_REVEAL_DELAY);
}

function buildHelpHint() {
  if (!helpHint) return;
  const segments = ['W / ↑ throttle', 'S / ↓ reverse', 'A D / ← → rudder', 'Space stop', 'C camera / cinema'];
  if (vessels.selectionUnlocked()) segments.push('B boat');
  segments.push('Mouse orbit', 'Wheel zoom');
  if (seaControlsUnlocked()) segments.push('1–4 sea');
  segments.push('R reset', 'L log');
  helpHint.textContent = segments.join(' · ');
}

function scheduleHelpDismiss() {
  if (IS_TOUCH || !helpHint) return;
  buildHelpHint();
  clearTimeout(helpDismissTimer);
  helpDismissTimer = setTimeout(() => {
    helpDismissTimer = null;
    helpHint.classList.add('help-dismissed');
    helpHint.setAttribute('aria-hidden', 'true');
  }, HELP_VISIBLE_DURATION);
}

function launchExperience() {
  if (appStarted) return;
  appStarted = true;
  performanceManager.setActive(true);
  startButton?.setAttribute('aria-busy', 'true');

  document.body.classList.remove('awaiting-start');
  document.body.classList.add('started');
  achievements.startVoyage();
  welcome?.setAttribute('aria-hidden', 'true');
  if (welcome) welcome.inert = true;
  try { audio.start(); } catch {  }
  void vessels.playActiveHornOnce();
  scheduleHelpDismiss();
  scheduleControlReveals();
  playVoyageIntro();
  firstVoyageGuide.start();
}

startButton?.addEventListener('click', launchExperience);

const voyageIntro = document.getElementById('voyage-intro');
const VOYAGE_INTRO_DELAY = 1300;
const VOYAGE_INTRO_HOLD = 6000;
const VOYAGE_INTRO_FADE = 1400;
const VOYAGE_INTRO_DRIVE_KEYS = new Set(
  ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
const voyageIntroTimers = [];
let voyageIntroPlayed = false;

function voyageIntroKeyDismiss(e) {
  if (VOYAGE_INTRO_DRIVE_KEYS.has(e.code)) dismissVoyageIntro();
}

function dismissVoyageIntro() {
  if (!voyageIntro || !voyageIntro.classList.contains('playing')) return;
  voyageIntroTimers.forEach(clearTimeout);
  voyageIntroTimers.length = 0;
  removeEventListener('keydown', voyageIntroKeyDismiss, true);
  voyageIntro.classList.remove('playing');
  voyageIntro.classList.add('leaving');
  voyageIntroTimers.push(setTimeout(() => {
    voyageIntro.classList.remove('leaving');
    voyageIntro.hidden = true;
  }, VOYAGE_INTRO_FADE));
}

function playVoyageIntro() {
  if (voyageIntroPlayed || !voyageIntro || vessels.selectionUnlocked()) return;
  voyageIntroPlayed = true;
  voyageIntroTimers.push(setTimeout(() => {
    voyageIntro.hidden = false;
    void voyageIntro.offsetWidth;
    voyageIntro.classList.add('playing');
    addEventListener('keydown', voyageIntroKeyDismiss, true);
    voyageIntroTimers.push(setTimeout(dismissVoyageIntro, VOYAGE_INTRO_HOLD));
  }, VOYAGE_INTRO_DELAY));
}

function storedWaveIntensity() {
  try {
    const level = Number(localStorage.getItem(WAVE_INTENSITY_KEY));
    return Number.isInteger(level) && SEA_PRESETS[level] ? level : 2;
  } catch {
    return 2;
  }
}

function rememberWaveIntensity(level) {
  try { localStorage.setItem(WAVE_INTENSITY_KEY, String(level)); } catch {  }
}

void vessels.loadCatalog();

environment.load({
  ocean,
  boat,
  cameraController,
  onReady: () => {
    skyReady = true;
    finishInitialLoadingWhenReady();
  },
});

const waterPasses = new WaterPassRenderer({
  renderer,
  scene,
  camera,
  ocean,
  waveField,
  boat,
  paradiseSky,
  isTouch: IS_TOUCH,
  width: innerWidth,
  height: innerHeight,
});

const bufSize = renderer.getDrawingBufferSize(new THREE.Vector2());
const composerRT = new THREE.WebGLRenderTarget(bufSize.x, bufSize.y, {
  samples: IS_TOUCH ? 0 : 4,
  type: THREE.HalfFloatType,
});
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(bufSize.clone(), 0.22, 0.55, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
ocean.uniforms.uResolution.value.copy(bufSize);

const qualityController = new QualityController({
  performanceManager,
  renderer,
  composer,
  waterPasses,
  bloom,
  sunLight,
  budgetTargets: [boat, ocean, effects, weather, fauna],
  resolutionTarget: ocean.uniforms.uResolution.value,
  achievements,
  elements: {
    control: document.getElementById('quality-control'),
    current: document.getElementById('quality-current'),
    select: document.getElementById('quality-select'),
  },
});
qualityController.bind();

const gestureDrive = new GestureDriveController({
  element: document.getElementById('gesture-drive'),
  tutorialElement: document.getElementById('drive-tutorial'),
  audio,
  onEngage: dismissVoyageIntro,
});
gestureDrive.bind();

function resetBoat() {
  drive.resetOutput();
  boat.reset();
  achievements.resetFlight();
  achievements.resetCircle();
  cameraController.resetVessel();
  gestureDrive.reset();
}

addEventListener('keydown', (e) => {
  if (!appStarted) return;
  audio.start();
  drive.press(e.code);
  if (e.code === 'KeyR') resetBoat();
  if (e.code === 'KeyC') cameraController.cycle();
  if (e.code === 'KeyB') e.shiftKey ? vessels.previous() : vessels.next();
  if (e.code === 'KeyL') achievements.togglePanel(false);
  const states = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };
  if (states[e.code] !== undefined && seaControlsUnlocked()) {
    setWaveIntensity(states[e.code], { userInitiated: true });
  }
});
addEventListener('keyup', (e) => drive.release(e.code));
addEventListener('blur', () => { drive.clearInput(); gestureDrive.reset(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { drive.clearInput(); gestureDrive.reset(); }
});

function setWaveIntensity(level, { userInitiated = false } = {}) {
  if (!SEA_PRESETS[level]) return;
  const changed = waveField.preset !== level;
  if (userInitiated && changed) {
    const continueOnboarding = document.body.classList.contains('sea-trial-visible');
    achievements.recordWaveChange();
    document.body.classList.remove('sea-trial-visible');
    if (continueOnboarding) document.body.classList.add('achievement-trial-visible');
  }
  waveField.setSeaPreset(level);
  achievements.recordSea(level);
  rememberWaveIntensity(level);
  document.querySelectorAll('.wave-option').forEach(button => {
    const active = Number(button.dataset.wave) === level;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function blurAfterPointerClick(e) {
  if (e.detail > 0) e.currentTarget.blur();
}

document.querySelectorAll('.wave-option').forEach(button => {
  button.addEventListener('click', (e) => {
    if (!seaControlsUnlocked()) return;
    audio.start();
    setWaveIntensity(Number(button.dataset.wave), { userInitiated: true });
    blurAfterPointerClick(e);
  });
});
syncSeaControlAccess();
setWaveIntensity(seaControlsUnlocked() ? storedWaveIntensity() : 2);

const viewInput = new ViewInputController({
  element: renderer.domElement,
  cameraController,
  audio,
  isTouch: IS_TOUCH,
  isAppStarted: () => appStarted,
  isGestureActive: () => gestureDrive.state.active,
});
viewInput.bind();

const elKn = document.getElementById('kn');
const elThrottle = document.querySelector('#throttle i');
const elRudder = document.querySelector('#rudder i');
const boatHud = new BoatHud(elKn, elThrottle, elRudder);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  qualityController.resize();
});

if (new URLSearchParams(location.search).has('debug')) {
  window.openWater = {
    boat, waveField, camera, ocean, effects, foamTrail, weather, audio, renderer, achievements,
    snapCamera: () => cameraController.snap(),
  };
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const frameStart = performance.now();
  performanceManager.beginFrame(frameStart);
  qualityController.applyPending();
  renderer.info.reset();
  const frameDt = Math.min(clock.getDelta(), 0.05);
  const dt = appStarted ? frameDt : 0;
  waveField.update(dt, boat.pos.x, boat.pos.z);
  environment.updateAtmosphere(dt);
  drive.update(dt, waveField.time, gestureDrive.state);
  boat.update(dt);
  achievements.update(dt, boat, waveField, fauna.achievementSources);
  ocean.update(dt, boat.pos.x, boat.pos.z, boat);
  foamTrail.update(renderer, dt, boat);
  ocean.uniforms.uFoamTrail.value = foamTrail.texture;
  ocean.uniforms.uTrailCenter.value.copy(foamTrail.center);
  effects.update(dt);
  environment.positionSunHolder(camera.position);
  cameraController.update(dt);
  firstVoyageGuide.update(dt);
  environment.positionSky(camera.position);
  audio.update(boat, camera, dt);
  weather.update(dt);
  fauna.update(dt);
  boatHud.update(boat.speedKn, drive.throttle, drive.wheel);
  environment.positionSunLight(boat.pos);
  performanceManager.beginGpu();
  waterPasses.render(frameStart, qualityController.current);
  composer.render();
  performanceManager.endGpu();
  performanceManager.endFrame();
  qualityController.updateHud(frameStart);
  renderedFrames++;
  finishInitialLoadingWhenReady();
});
