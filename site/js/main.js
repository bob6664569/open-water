import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WaveField, SEA_PRESETS } from './waves.js';
import { Ocean } from './ocean.js';
import { Boat } from './boat.js';
import { BoatEffects } from './effects.js';
import { BoatAudio } from './audio.js';
import { FoamTrail } from './foamtrail.js';
import { WeatherEffects } from './weather.js';
import { createFaunaManager } from './fauna.js';
import { getVesselSpec } from './vessels.js';
import { PerformanceManager } from './performance.js';
import { AchievementManager } from './achievements.js';
import { FirstVoyageGuide } from './first-voyage.js';
import { BoatHud } from './hud.js';
import { DriveController } from './drive-controller.js';
import { CameraController } from './camera-controller.js';
import { WaterPassRenderer } from './water-pass-renderer.js';
import { EnvironmentController } from './environment-controller.js';

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

let allBoatList = [];
let boatList = [];
let boatIdx = 0;
const REWARD_VESSELS = [
  { file: /^boat\.glb$/i, reward: 'racer' },
  { file: /zefiro/i, reward: 'azure' },
  { file: /motoryacht/i, reward: 'ivory' },
  { file: /zodiac_boat/i, reward: 'zodiac' },
  { file: /seadoo-gti/i, reward: 'jetski' },
  { file: /frickies_yacht/i, reward: 'megayacht' },
  { file: /assault-boat/i, reward: 'blackfin' },
  { file: /ss_minnow_iii/i, reward: 'minnow' },
];
const LAST_BOAT_KEY = 'ocean-boat:last-vessel';
const MEGAYACHT_HORN_KEY = 'ocean-boat:megayacht-horn-played';
const WAVE_INTENSITY_KEY = 'ocean-boat:wave-intensity';
const initialLoader = document.getElementById('loading');
const welcome = document.getElementById('welcome');
const startButton = document.getElementById('start-experience');
const helpHint = document.getElementById('help');
const boatLoader = document.getElementById('boat-loading');
const vesselSelector = document.getElementById('vessel-selector');
const boatName = document.getElementById('boatname');
const boatPosition = document.getElementById('boat-position');
const prevBoatButton = document.getElementById('prev-boat');
const nextBoatButton = document.getElementById('next-boat');
const waveControls = document.getElementById('controls');
const vesselUnlockAlert = document.getElementById('vessel-unlock-alert');
const vesselUnlockName = document.getElementById('vessel-unlock-name');
const vesselUnlockHint = document.getElementById('vessel-unlock-hint');
if (vesselUnlockHint) vesselUnlockHint.textContent = IS_TOUCH ? 'Tap to take the helm' : 'Click to take the helm';
let initialBoatReady = false;
let skyReady = false;
let renderedFrames = 0;
let appStarted = false;

function availableBoatNames() {
  return allBoatList.filter(name => {
    const gate = REWARD_VESSELS.find(entry => entry.file.test(name));
    return !gate || achievements.isRewardUnlocked(gate.reward);
  });
}

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

function vesselSelectionUnlocked() {
  return boatList.length >= 2;
}

function syncVesselSelectorAccess() {
  const unlocked = vesselSelectionUnlocked();
  vesselSelector.inert = !unlocked;
  vesselSelector.setAttribute('aria-hidden', String(!unlocked));
  if (!unlocked) document.body.classList.remove('dock-revealed');
}

let vesselAlertShowTimer = null;
let vesselAlertHideTimer = null;
let pendingUnlockVessel = null;

function dismissVesselUnlockAlert() {
  clearTimeout(vesselAlertShowTimer);
  clearTimeout(vesselAlertHideTimer);
  vesselAlertShowTimer = null;
  vesselAlertHideTimer = null;
  vesselUnlockAlert?.classList.remove('visible');
  vesselUnlockAlert?.setAttribute('aria-hidden', 'true');
  vesselSelector.classList.remove('new-vessel');
  pendingUnlockVessel = null;
}

function announceNewVessel(fileName, delay = 0) {
  dismissVesselUnlockAlert();
  vesselAlertShowTimer = setTimeout(() => {
    vesselAlertShowTimer = null;
    if (!vesselUnlockAlert || !vesselUnlockName) return;
    pendingUnlockVessel = fileName;
    vesselUnlockName.textContent = getVesselSpec(fileName).label;
    vesselUnlockAlert.setAttribute('aria-hidden', 'false');
    vesselUnlockAlert.classList.add('visible');
    vesselSelector.classList.add('new-vessel');
    vesselAlertHideTimer = setTimeout(dismissVesselUnlockAlert, 5200);
  }, delay);
}

function takeHelmOfUnlockedVessel() {
  const name = pendingUnlockVessel;
  if (!name) return;
  const idx = boatList.indexOf(name);
  if (idx < 0 || idx === boatIdx) { dismissVesselUnlockAlert(); return; }
  loadBoatByIndex(idx);
}
vesselUnlockAlert?.addEventListener('click', takeHelmOfUnlockedVessel);

function refreshAvailableBoatList() {
  const currentName = boatList[boatIdx];
  boatList = availableBoatNames();
  const currentIndex = currentName ? boatList.indexOf(currentName) : -1;
  boatIdx = currentIndex >= 0 ? currentIndex : 0;
  if (boatList.length && currentName) updateVesselSelector(boat.spec);
  else syncVesselSelectorAccess();
}

addEventListener('ocean-boat:reward-unlocked', event => {
  if (REWARD_VESSELS.some(entry => entry.reward === event.detail?.reward)) {
    const previousBoats = new Set(boatList);
    const selectorWasUnlocked = vesselSelectionUnlocked();
    refreshAvailableBoatList();
    if (appStarted && vesselSelectionUnlocked()) revealAfter('dock-revealed', 900);
    const unlockedBoat = boatList.find(name => !previousBoats.has(name));
    if (unlockedBoat) announceNewVessel(unlockedBoat, selectorWasUnlocked ? 250 : 1650);
  }
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
  if (vesselSelectionUnlocked()) revealAfter('dock-revealed', DOCK_REVEAL_DELAY);
  if (seaControlsUnlocked()) revealAfter('controls-revealed', CONTROLS_REVEAL_DELAY);
}

function buildHelpHint() {
  if (!helpHint) return;
  const segments = ['W / ↑ throttle', 'S / ↓ reverse', 'A D / ← → rudder', 'Space stop', 'C camera / cinema'];
  if (vesselSelectionUnlocked()) segments.push('B boat');
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
  void playMegayachtHornOnce(boat.spec);
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
  if (voyageIntroPlayed || !voyageIntro || vesselSelectionUnlocked()) return;
  voyageIntroPlayed = true;
  voyageIntroTimers.push(setTimeout(() => {
    voyageIntro.hidden = false;
    void voyageIntro.offsetWidth;
    voyageIntro.classList.add('playing');
    addEventListener('keydown', voyageIntroKeyDismiss, true);
    voyageIntroTimers.push(setTimeout(dismissVoyageIntro, VOYAGE_INTRO_HOLD));
  }, VOYAGE_INTRO_DELAY));
}

function storedBoatName() {
  try { return localStorage.getItem(LAST_BOAT_KEY); } catch { return null; }
}

function rememberBoat(name) {
  try { localStorage.setItem(LAST_BOAT_KEY, name); } catch {  }
}

let megayachtHornPending = false;

function megayachtHornPlayed() {
  try { return localStorage.getItem(MEGAYACHT_HORN_KEY) === '1'; } catch { return false; }
}

function rememberMegayachtHorn() {
  try { localStorage.setItem(MEGAYACHT_HORN_KEY, '1'); } catch {  }
}

async function playMegayachtHornOnce(spec) {
  if (!appStarted || spec?.id !== 'frickies_yacht'
    || megayachtHornPending || megayachtHornPlayed()) return;
  megayachtHornPending = true;
  try {
    if (await audio.megayachtHorn()) rememberMegayachtHorn();
  } finally {
    megayachtHornPending = false;
  }
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

function updateVesselSelector(spec, direction = 0) {
  boatName.textContent = spec.label;
  boatPosition.textContent = `${String(boatIdx + 1).padStart(2, '0')} / ${String(boatList.length).padStart(2, '0')}`;
  prevBoatButton.disabled = boatList.length < 2;
  nextBoatButton.disabled = boatList.length < 2;
  vesselSelector.classList.toggle('single-vessel', boatList.length < 2);
  syncVesselSelectorAccess();
  if (!direction) return;
  const animationClass = direction > 0 ? 'changing-next' : 'changing-prev';
  vesselSelector.classList.remove('changing-next', 'changing-prev');
  void vesselSelector.offsetWidth;
  vesselSelector.classList.add(animationClass);
}

async function loadBoatByIndex(i, { initial = false, direction = 0 } = {}) {
  if (!boatList.length) return;
  if (!initial) dismissVesselUnlockAlert();
  // Preserve an active voyage when swapping models instead of resetting world position.
  const navigationState = initial ? null : {
    position: boat.pos.clone(),
    orientation: boat.quat.clone(),
    velocity: boat.vel.clone(),
    angularVelocity: boat.angVelB.clone(),
    rideHeight: boat.spec?.rideHeight ?? 0,
  };
  boatIdx = ((i % boatList.length) + boatList.length) % boatList.length;
  const name = boatList[boatIdx];
  const m = name.match(/_(\d+(?:\.\d+)?)(r)?\.glb$/i);
  const spec = getVesselSpec(name);
  boat.setSpec(spec);
  boat.reset();
  if (navigationState) {
    boat.pos.copy(navigationState.position);
    boat.pos.y += (spec.rideHeight ?? 0) - navigationState.rideHeight;
    boat.quat.copy(navigationState.orientation);
    boat.vel.copy(navigationState.velocity);
    boat.angVelB.copy(navigationState.angularVelocity);
  }
  achievements.resetFlight();
  achievements.resetCircle();
  if (!initial) boatLoader.classList.add('visible');
  vesselSelector.setAttribute('aria-busy', 'true');
  updateVesselSelector(spec, direction);
  try {
    await boat.loadModel('./assets/boats/' + encodeURIComponent(name),
                         m ? parseFloat(m[1]) : spec.length,
                         !!(m && m[2]) || !!spec.reversed);
    achievements.recordBoat(spec.id || name);
    void playMegayachtHornOnce(spec);
  } finally {
    rememberBoat(name);
    if (initial) {
      initialBoatReady = true;
      finishInitialLoadingWhenReady();
    } else {
      boatLoader.classList.remove('visible');
    }
    vesselSelector.setAttribute('aria-busy', 'false');
  }
  cameraController.setVessel(spec);
}
fetch('./assets/boats/index.json')
  .then(r => r.json())
  .then(list => {
    allBoatList = list.map(e => e.name).filter(n => /\.glb$/i.test(n)).sort();
    boatList = availableBoatNames();
    const saved = storedBoatName();
    const unsafeMobileStartup = IS_TOUCH && /motoryacht|ss_minnow|frickies_yacht/i.test(saved || '');
    const savedIdx = unsafeMobileStartup ? -1 : boatList.indexOf(saved);
    const z = boatList.findIndex(n => /zefiro/i.test(n));
    if (boatList.length) loadBoatByIndex(savedIdx >= 0 ? savedIdx : (z >= 0 ? z : 0), { initial: true });
    else boat.loadModel('./assets/boat.glb').finally(() => { initialBoatReady = true; finishInitialLoadingWhenReady(); });
  })
  .catch(() => boat.loadModel('./assets/boat.glb').finally(() => { initialBoatReady = true; finishInitialLoadingWhenReady(); }));

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

let currentQuality = null;
let pendingQuality = null;
let pendingQualityForce = false;
let appliedPixelRatio = 0;
let appliedWidth = 0;
let appliedHeight = 0;
const qualityControl = document.getElementById('quality-control');
const qualityCurrent = document.getElementById('quality-current');
const qualitySelect = document.getElementById('quality-select');

function syncQualityControl() {
  if (!qualityControl) return;
  const stats = performanceManager.stats;
  qualityControl.dataset.quality = stats.profile;
  qualityControl.dataset.mode = stats.mode;
  qualityCurrent.textContent = stats.profile;
  qualitySelect.value = stats.mode === 'auto' ? 'auto' : stats.profile;
  qualityControl.title = stats.mode === 'auto'
    ? `Adaptive quality · currently ${stats.profile}`
    : `Quality forced to ${stats.profile}`;
}

function applyQuality(quality, force = false) {
  const previous = currentQuality;
  currentQuality = quality;
  const pixelRatio = Math.min(devicePixelRatio, quality.dprMax) * quality.scale;
  const ratioChanged = Math.abs(pixelRatio - appliedPixelRatio) > 0.001;
  const viewportChanged = force || innerWidth !== appliedWidth || innerHeight !== appliedHeight;
  if (ratioChanged || viewportChanged) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    if (ratioChanged) composer.setPixelRatio(pixelRatio);
    if (viewportChanged) composer.setSize(innerWidth, innerHeight);
    appliedPixelRatio = pixelRatio;
    appliedWidth = innerWidth;
    appliedHeight = innerHeight;
  }
  waterPasses.setQuality(quality, previous, innerWidth, innerHeight, {
    force,
    viewportChanged,
  });
  bloom.enabled = quality.bloom;
  bloom.strength = quality.bloomStrength;
  for (const target of [composer.renderTarget1, composer.renderTarget2]) {
    if (!target || target.samples === quality.msaa) continue;
    target.samples = quality.msaa;
    target.dispose();
  }
  if (force || !previous || previous.shadowSize !== quality.shadowSize) {
    sunLight.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    if (sunLight.shadow.map) {
      sunLight.shadow.map.dispose();
      sunLight.shadow.map = null;
    }
  }
  boat.setPerformanceBudget(quality);
  ocean.setPerformanceBudget(quality);
  effects.setPerformanceBudget(quality);
  weather.setPerformanceBudget(quality);
  fauna.setPerformanceBudget(quality);
  renderer.getDrawingBufferSize(ocean.uniforms.uResolution.value);
  document.documentElement.dataset.quality = quality.id;
  syncQualityControl();
}

function queueQuality(quality, force = false) {
  pendingQuality = quality;
  pendingQualityForce ||= force;
}

performanceManager.onChange = quality => queueQuality(quality);
applyQuality(performanceManager.quality, true);

let qualityPointerInteraction = false;
qualitySelect?.addEventListener('pointerdown', () => { qualityPointerInteraction = true; });
qualitySelect?.addEventListener('keydown', () => { qualityPointerInteraction = false; });
qualitySelect?.addEventListener('pointercancel', () => { qualityPointerInteraction = false; });
qualitySelect?.addEventListener('change', () => {
  const releasePointerFocus = qualityPointerInteraction;
  qualityPointerInteraction = false;
  const mode = qualitySelect.value;
  performanceManager.setMode(mode);
  achievements.recordQualityChange();
  const url = new URL(location.href);
  if (mode === 'auto') url.searchParams.delete('quality');
  else url.searchParams.set('quality', mode);
  history.replaceState(null, '', url);
  syncQualityControl();
  if (releasePointerFocus) requestAnimationFrame(() => qualitySelect.blur());
});

const showPerformanceHud = new URLSearchParams(location.search).has('perf');
const performanceHud = showPerformanceHud ? document.createElement('pre') : null;
let nextPerformanceHudAt = 0;
if (performanceHud) {
  Object.assign(performanceHud.style, {
    position: 'fixed', left: '12px', bottom: '88px', zIndex: '50', margin: '0',
    padding: '8px 10px', color: '#bcecff', background: 'rgba(0,10,18,.78)',
    border: '1px solid rgba(188,236,255,.25)', borderRadius: '5px',
    font: '10px/1.45 ui-monospace, monospace', pointerEvents: 'none',
  });
  document.body.appendChild(performanceHud);
}

function updatePerformanceHud(now) {
  if (!performanceHud || now < nextPerformanceHudAt) return;
  nextPerformanceHudAt = now + 250;
  const s = performanceManager.stats;
  performanceHud.textContent = [
    `${s.profile.toUpperCase()} ${s.mode} · scale ${s.scale.toFixed(2)}`,
    `frame p95 ${s.frameP95.toFixed(1)} ms · target ${s.targetFps} fps`,
    `CPU p95 ${s.cpuP95.toFixed(1)} ms · GPU p90 ${s.gpuP90.toFixed(1)} ms`,
    `${s.calls} calls · ${(s.triangles / 1e6).toFixed(2)} M triangles`,
  ].join('\n');
}

function resetBoat() {
  drive.resetOutput();
  boat.reset();
  achievements.resetFlight();
  achievements.resetCircle();
  cameraController.resetVessel();
  resetGestureDrive();
}
function cycleCamera() {
  cameraController.cycle();
}
function changeBoat(direction) {
  if (boatList.length > 1 && !boatLoader.classList.contains('visible')) {
    loadBoatByIndex(boatIdx + direction, { direction });
  }
}
function nextBoat() {
  changeBoat(1);
}
function previousBoat() {
  changeBoat(-1);
}

addEventListener('keydown', (e) => {
  if (!appStarted) return;
  audio.start();
  drive.press(e.code);
  if (e.code === 'KeyR') resetBoat();
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyB') e.shiftKey ? previousBoat() : nextBoat();
  if (e.code === 'KeyL') achievements.togglePanel(false);
  const states = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };
  if (states[e.code] !== undefined && seaControlsUnlocked()) {
    setWaveIntensity(states[e.code], { userInitiated: true });
  }
});
addEventListener('keyup', (e) => drive.release(e.code));
addEventListener('blur', () => { drive.clearInput(); resetGestureDrive(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { drive.clearInput(); resetGestureDrive(); }
});

const gestureDrive = document.getElementById('gesture-drive');
const driveTutorial = document.getElementById('drive-tutorial');
const driveVector = gestureDrive?.querySelector('.drive-vector');
const gestureState = { active: false, id: null, originX: 0, originY: 0, throttle: 0, steer: 0 };
const DRIVE_RADIUS = 76;
const DRIVE_DEADZONE = 0.09;
const TUTORIAL_DISMISS_DISTANCE = 14;
const DRIVE_HINT_IDLE_DELAY = 20_000;
let driveIdleTimer = null;
let driveHasBeenUsed = false;
let driveTutorialAvailable = true;

function waitForDriveHintIdle() {
  if (!driveHasBeenUsed) return;
  clearTimeout(driveIdleTimer);
  gestureDrive?.classList.add('awaiting-drive-idle');
  driveIdleTimer = setTimeout(() => {
    driveIdleTimer = null;
    driveTutorialAvailable = true;
    gestureDrive?.classList.remove('awaiting-drive-idle');
  }, DRIVE_HINT_IDLE_DELAY);
}

function beginDriveHintCooldown() {
  const showTutorial = driveTutorialAvailable;
  driveHasBeenUsed = true;
  driveTutorialAvailable = false;
  clearTimeout(driveIdleTimer);
  driveIdleTimer = null;
  gestureDrive?.classList.add('awaiting-drive-idle');
  return showTutorial;
}

function driveAxis(delta) {
  const raw = THREE.MathUtils.clamp(delta / DRIVE_RADIUS, -1, 1);
  if (Math.abs(raw) <= DRIVE_DEADZONE) return 0;
  return Math.sign(raw) * (Math.abs(raw) - DRIVE_DEADZONE) / (1 - DRIVE_DEADZONE);
}
function updateDriveVector(clientX, clientY) {
  if (!driveVector) return;
  const dx = clientX - gestureState.originX;
  const dy = clientY - gestureState.originY;
  const length = Math.min(Math.hypot(dx, dy), DRIVE_RADIUS);
  const scale = Math.hypot(dx, dy) > DRIVE_RADIUS ? DRIVE_RADIUS / Math.hypot(dx, dy) : 1;
  driveVector.style.setProperty('--drive-x', `${gestureState.originX}px`);
  driveVector.style.setProperty('--drive-y', `${gestureState.originY}px`);
  driveVector.style.setProperty('--drive-end-x', `${dx * scale}px`);
  driveVector.style.setProperty('--drive-end-y', `${dy * scale}px`);
  driveVector.style.setProperty('--drive-length', `${length}px`);
  driveVector.style.setProperty('--drive-angle', `${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg`);
}
function resetGestureDrive() {
  gestureState.active = false;
  gestureState.id = null;
  gestureState.throttle = 0;
  gestureState.steer = 0;
  gestureDrive?.classList.remove('active');
  driveTutorial?.classList.remove('visible');
  gestureDrive?.setAttribute('aria-valuetext', 'Neutral');
  waitForDriveHintIdle();
}
function updateGestureFromPointer(e) {
  const dx = e.clientX - gestureState.originX;
  const dy = e.clientY - gestureState.originY;
  gestureState.throttle = driveAxis(gestureState.originY - e.clientY);
  gestureState.steer = driveAxis(e.clientX - gestureState.originX);
  updateDriveVector(e.clientX, e.clientY);
  if (Math.hypot(dx, dy) >= TUTORIAL_DISMISS_DISTANCE) {
    driveTutorial?.classList.remove('visible');
  }
  const power = Math.round(Math.abs(gestureState.throttle) * 100);
  const turn = Math.round(Math.abs(gestureState.steer) * 100);
  const motion = gestureState.throttle > 0 ? `forward ${power}%`
    : gestureState.throttle < 0 ? `reverse ${power}%` : 'neutral';
  const heading = gestureState.steer > 0 ? `right ${turn}%`
    : gestureState.steer < 0 ? `left ${turn}%` : 'centered';
  gestureDrive?.setAttribute('aria-valuetext', `${motion}, ${heading}`);
}
if (gestureDrive) {
  gestureDrive.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (gestureState.active) {
      if (e.pointerId === gestureState.id) return;
      resetGestureDrive();
    }
    e.preventDefault();
    audio.start();
    dismissVoyageIntro();
    const showTutorial = beginDriveHintCooldown();
    gestureState.active = true;
    gestureState.id = e.pointerId;
    gestureState.originX = e.clientX;
    gestureState.originY = e.clientY;
    gestureDrive.classList.add('active');
    try { gestureDrive.setPointerCapture(e.pointerId); } catch {}
    updateGestureFromPointer(e);
    if (navigator.vibrate) navigator.vibrate(12);
    driveTutorial?.classList.toggle('visible', showTutorial);
  });
  gestureDrive.addEventListener('pointermove', (e) => {
    if (!gestureState.active || e.pointerId !== gestureState.id) return;
    e.preventDefault();
    updateGestureFromPointer(e);
  });
  const releaseGesture = (e) => {
    if (!gestureState.active || (e.pointerId !== undefined && e.pointerId !== gestureState.id)) return;
    resetGestureDrive();
    if (navigator.vibrate) navigator.vibrate(8);
  };
  gestureDrive.addEventListener('pointerup', releaseGesture);
  gestureDrive.addEventListener('pointercancel', releaseGesture);
  gestureDrive.addEventListener('lostpointercapture', releaseGesture);

  addEventListener('pointerup', releaseGesture, true);
  addEventListener('pointercancel', releaseGesture, true);
  addEventListener('touchend', (e) => {
    if (!gestureState.active) return;
    const endedOnDrive = e.target instanceof Node && gestureDrive.contains(e.target);
    if (endedOnDrive || e.touches.length === 0) resetGestureDrive();
  }, { passive: true, capture: true });
  addEventListener('touchcancel', () => {
    if (gestureState.active) resetGestureDrive();
  }, { passive: true, capture: true });
  addEventListener('pagehide', resetGestureDrive);
}

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
prevBoatButton.addEventListener('click', (e) => { previousBoat(); blurAfterPointerClick(e); });
nextBoatButton.addEventListener('click', (e) => { nextBoat(); blurAfterPointerClick(e); });

let vesselSwipe = null;
vesselSelector.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.vessel-arrow')) return;
  vesselSwipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  try { vesselSelector.setPointerCapture(e.pointerId); } catch {}
});
vesselSelector.addEventListener('pointerup', (e) => {
  if (!vesselSwipe || vesselSwipe.id !== e.pointerId) return;
  const dx = e.clientX - vesselSwipe.x;
  const dy = e.clientY - vesselSwipe.y;
  vesselSwipe = null;
  if (Math.abs(dx) >= 46 && Math.abs(dx) > Math.abs(dy) * 1.25) {
    audio.start();
    changeBoat(dx < 0 ? 1 : -1);
  }
});
const cancelVesselSwipe = () => { vesselSwipe = null; };
vesselSelector.addEventListener('pointercancel', cancelVesselSwipe);
vesselSelector.addEventListener('lostpointercapture', cancelVesselSwipe);
syncSeaControlAccess();
syncVesselSelectorAccess();
setWaveIntensity(seaControlsUnlocked() ? storedWaveIntensity() : 2);

const dragPointers = new Map();
let pinchStartDist = 0, pinchStartZoom = 0;
const VIEW_TAP_MAX_DURATION = 280;
const VIEW_TAP_MAX_MOVEMENT = 18;
const VIEW_DOUBLE_TAP_DELAY = 340;
const VIEW_DOUBLE_TAP_DISTANCE = 48;
let lastViewTap = null;

function registerViewTap(e, pointer) {
  if (!IS_TOUCH || e.pointerType !== 'touch' || !appStarted || gestureState.active) return;
  const now = performance.now();
  const moved = Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY);
  if (pointer.multiTouch || moved > VIEW_TAP_MAX_MOVEMENT
    || now - pointer.startTime > VIEW_TAP_MAX_DURATION) {
    lastViewTap = null;
    return;
  }
  if (lastViewTap && now - lastViewTap.time <= VIEW_DOUBLE_TAP_DELAY
    && Math.hypot(e.clientX - lastViewTap.x, e.clientY - lastViewTap.y)
      <= VIEW_DOUBLE_TAP_DISTANCE) {
    lastViewTap = null;
    cycleCamera();
    return;
  }
  lastViewTap = { time: now, x: e.clientX, y: e.clientY };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  audio.start();
  dragPointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    startTime: performance.now(),
    multiTouch: false,
  });
  if (dragPointers.size === 2) {
    dragPointers.forEach(pointer => { pointer.multiTouch = true; });
    const [a, b] = [...dragPointers.values()];
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchStartZoom = cameraController.activeZoom();
  }
});
addEventListener('pointermove', (e) => {
  const p = dragPointers.get(e.pointerId);
  if (!p) return;
  const prevX = p.x, prevY = p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (dragPointers.size >= 2) {
    const [a, b] = [...dragPointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStartDist > 0 && d > 0) {
      cameraController.setActiveZoom(pinchStartZoom * pinchStartDist / d);
    }
  } else if (gestureState.active && IS_TOUCH) {
    cameraController.orbitHoriz(e.clientX - prevX);
    cameraController.setActiveZoom(
      cameraController.activeZoom() * Math.exp((e.clientY - prevY) * 0.008),
    );
  } else {
    cameraController.orbitHoriz(e.clientX - prevX);
    cameraController.orbitPitchBy(e.clientY - prevY);
  }
});
function endDrag(e) {
  const pointer = dragPointers.get(e.pointerId);
  if (pointer && e.type === 'pointerup') registerViewTap(e, pointer);
  dragPointers.delete(e.pointerId);
  if (dragPointers.size < 2) pinchStartDist = 0;
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('wheel', (e) => {
  if (e.target instanceof Element && e.target.closest('#achievements-panel')) return;
  cameraController.setActiveZoom(
    cameraController.activeZoom() * Math.exp(e.deltaY * 0.0012),
  );
}, { passive: true });

const elKn = document.getElementById('kn');
const elThrottle = document.querySelector('#throttle i');
const elRudder = document.querySelector('#rudder i');
const boatHud = new BoatHud(elKn, elThrottle, elRudder);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  queueQuality(currentQuality, true);
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
  if (pendingQuality) {
    // Reallocate before rendering; doing it after composition produces a black flash.
    const quality = pendingQuality;
    const force = pendingQualityForce;
    pendingQuality = null;
    pendingQualityForce = false;
    applyQuality(quality, force);
  }
  renderer.info.reset();
  const frameDt = Math.min(clock.getDelta(), 0.05);
  const dt = appStarted ? frameDt : 0;
  waveField.update(dt, boat.pos.x, boat.pos.z);
  environment.updateAtmosphere(dt);
  drive.update(dt, waveField.time, gestureState);
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
  waterPasses.render(frameStart, currentQuality);
  composer.render();
  performanceManager.endGpu();
  performanceManager.endFrame();
  updatePerformanceHud(frameStart);
  renderedFrames++;
  finishInitialLoadingWhenReady();
});
