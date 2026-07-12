import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
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
import { Wildlife } from './wildlife.js';
import { FishLife } from './fish.js';
import { Dolphins } from './dolphins.js';
import { Whales } from './whale.js';
import { Seabed } from './seabed.js';
import { Turtles } from './turtles.js';
import { Mantas } from './manta.js';
import { Birds } from './birds.js';
import { getVesselSpec } from './vessels.js';
import { PerformanceManager } from './performance.js';
import { AchievementManager } from './achievements.js';
import { FirstVoyageGuide } from './first-voyage.js';

// L'application entière est une surface interactive : aucune sélection native
// ne doit concurrencer les gestes de pilotage ou de caméra.
document.addEventListener('selectstart', (event) => event.preventDefault());

// tactile / mobile : entrée principale au doigt → contrôles à l'écran + budget
// de rendu allégé (le shader océan est fill-rate bound, on plafonne les pixels).
// `?touch` permet de valider le layout mobile depuis un navigateur desktop.
const IS_TOUCH = new URLSearchParams(location.search).has('touch')
  || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', IS_TOUCH);

// ---------------- rendu ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false; // cumule toutes les passes d'une frame pour le diagnostic
document.body.appendChild(renderer.domElement);
const performanceManager = new PerformanceManager(renderer, { isTouch: IS_TOUCH });

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9cbfd8, 180, 640);
const clearFogColor = new THREE.Color(0x9cbfd8);
const stormFogColor = new THREE.Color(0x4a5962);
const atmosphereFogColor = new THREE.Color();

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(-12, 5, -12);

// ---------------- soleil (recalé par l'HDRI au chargement) ----------------
const sun = new THREE.Vector3(-0.4, 0.6, -0.7).normalize();
// Le bateau vise légèrement à tribord du soleil : la caméra de poursuite
// regarde ainsi presque dans son axe et révèle immédiatement le reflet.
const SUN_START_OFFSET = THREE.MathUtils.degToRad(12);
const startYawFromSun = () => Math.atan2(sun.x, sun.z) + SUN_START_OFFSET;
const sunLight = new THREE.DirectionalLight(0xfff2dd, 2.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
sunLight.shadow.camera.left = -14;
sunLight.shadow.camera.right = 14;
sunLight.shadow.camera.top = 14;
sunLight.shadow.camera.bottom = -14;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 160;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);
scene.add(sunLight.target);
let sunSprite = null;

// Léger voile tropical réservé au mode Calm. Le HDRI reste le ciel réel et
// conserve ses nuages/détails ; cette sphère transparente lui apporte seulement
// un peu de cyan au zénith et une chaleur pêche près de l'horizon.
const paradiseSkyMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uCalm: { value: 0 },
    uZenith: { value: new THREE.Color(0x48d9e4) },
    uHorizon: { value: new THREE.Color(0xffc59f) },
  },
  vertexShader: /* glsl */`
    varying vec3 vSkyDirection;
    void main() {
      vSkyDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uCalm;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    varying vec3 vSkyDirection;
    void main() {
      float sky = max(vSkyDirection.y, 0.0);
      float horizon = 1.0 - smoothstep(0.02, 0.42, abs(vSkyDirection.y));
      float zenith = smoothstep(0.08, 0.82, sky);
      vec3 tint = mix(uHorizon, uZenith, smoothstep(0.05, 0.72, sky));
      float alpha = uCalm * (horizon * 0.13 + zenith * 0.075);
      gl_FragColor = vec4(tint, alpha);
    }
  `,
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
const paradiseSky = new THREE.Mesh(
  new THREE.SphereGeometry(3500, 32, 16),
  paradiseSkyMaterial,
);
paradiseSky.renderOrder = -1000;
paradiseSky.frustumCulled = false;
scene.add(paradiseSky);

function updateAtmosphere(dt) {
  const storm = THREE.MathUtils.smoothstep(
    waveField.significantWaveHeight, SEA_PRESETS[2].hs, SEA_PRESETS[4].hs,
  );
  const ease = 1 - Math.exp(-dt * 0.75);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(
    renderer.toneMappingExposure, THREE.MathUtils.lerp(0.85, 0.48, storm), ease,
  );
  if (scene.background) {
    scene.backgroundIntensity = THREE.MathUtils.lerp(
      scene.backgroundIntensity, THREE.MathUtils.lerp(1, 0.38, storm), ease,
    );
  }
  if (scene.environment) {
    scene.environmentIntensity = THREE.MathUtils.lerp(
      scene.environmentIntensity ?? 1, THREE.MathUtils.lerp(1, 0.62, storm), ease,
    );
  }
  sunLight.intensity = THREE.MathUtils.lerp(
    sunLight.intensity, THREE.MathUtils.lerp(2, 0.55, storm), ease,
  );
  scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, THREE.MathUtils.lerp(180, 58, storm), ease);
  scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, THREE.MathUtils.lerp(640, 225, storm), ease);
  atmosphereFogColor.copy(clearFogColor).lerp(stormFogColor, storm * 0.82);
  scene.fog.color.lerp(atmosphereFogColor, ease);
  if (sunSprite) {
    sunSprite.material.opacity = THREE.MathUtils.lerp(
      sunSprite.material.opacity, THREE.MathUtils.lerp(1, 0.12, storm), ease,
    );
  }
  const calmTarget = waveField.preset === 1 ? 1 : 0;
  paradiseSkyMaterial.uniforms.uCalm.value = THREE.MathUtils.damp(
    paradiseSkyMaterial.uniforms.uCalm.value, calmTarget, 0.9, dt,
  );
}

// ---------------- monde ----------------
const waveField = new WaveField();
const ocean = new Ocean(waveField, performanceManager.quality);
scene.add(ocean.mesh);
scene.add(ocean.patch);
const boat = new Boat(waveField, scene, startYawFromSun());
const effects = new BoatEffects(scene, waveField, boat);
const audio = new BoatAudio(waveField);
const foamTrail = new FoamTrail();
const weather = new WeatherEffects(scene, camera, waveField, audio);
const wildlife = new Wildlife(scene, camera, waveField, audio);
const fish = new FishLife(scene, camera, waveField, boat);
const dolphins = new Dolphins(scene, camera, waveField, boat);
const whales = new Whales(scene, camera, waveField);
const seabed = new Seabed(scene, camera, waveField, boat);   // fond de sable + étoiles (calm)
const turtles = new Turtles(scene, camera, waveField, boat); // tortues (calm)
const mantas = new Mantas(scene, camera, waveField, boat);   // raies manta (calm)
const birds = new Birds(scene, camera, waveField, audio);    // perroquets (calm) + cris
const achievements = new AchievementManager();
const achievementFauna = { dolphins, whales, turtles, mantas, fish };
const firstVoyageGuide = new FirstVoyageGuide({ scene, camera, boat, waveField, achievements, fish, wildlife });

// ---------------- sélecteur de bateaux (dossier assets/boats, touche B) ----
// convention: nom_LONGUEUR.glb (ex: zefiro_6.5.glb) sinon 6,5 m
let allBoatList = [];
let boatList = [];
let boatIdx = 0;
const REWARD_VESSELS = [
  { file: /zefiro/i, reward: 'azure' },
  { file: /motoryacht/i, reward: 'ivory' },
  { file: /zodiac_boat/i, reward: 'zodiac' },
  { file: /seadoo-gti/i, reward: 'jetski' },
  { file: /frickies_yacht/i, reward: 'megayacht' },
  { file: /assault-boat/i, reward: 'blackfin' },
  { file: /ss_minnow_iii/i, reward: 'minnow' },
];
const LAST_BOAT_KEY = 'ocean-boat:last-vessel';
const WAVE_INTENSITY_KEY = 'ocean-boat:wave-intensity';
const CAM_MODE_KEY = 'ocean-boat:camera-mode';
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

// Cliquer/taper la bulle « nouveau bateau » prend directement la barre du modèle débloqué.
function takeHelmOfUnlockedVessel() {
  const name = pendingUnlockVessel;
  if (!name) return;
  const idx = boatList.indexOf(name);
  if (idx < 0 || idx === boatIdx) { dismissVesselUnlockAlert(); return; }
  loadBoatByIndex(idx); // change de bateau et masque la bulle
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
  // Débloquer pendant que l'aide est encore affichée : y refléter la nouvelle touche.
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

// Sur desktop, l'aide clavier accompagne le départ puis s'efface : elle reste
// le temps de repérer les commandes, sans encombrer la scène ensuite. Durée
// alignée sur l'indication tactile mobile (cf. DRIVE_HINT_IDLE_DELAY).
const HELP_VISIBLE_DURATION = 20_000;
let helpDismissTimer = null;

// Les instruments de bord entrent en scène en cascade une fois la scène prise en
// main, pour ne pas saturer l'écran au départ : le sélecteur de bateau remonte du
// bas (poussant qualité/achievements), puis l'intensité des vagues glisse depuis
// la droite quelques secondes plus tard. Cf. body.dock-revealed / .controls-revealed.
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

// L'aide clavier ne liste que les commandes réellement utiles à l'instant : au
// tout premier départ, ni le changement de bateau (« B boat ») ni le choix des
// vagues (« 1–4 sea ») ne sont débloqués, les mentionner enverrait sur des
// touches sans effet. On (re)compose donc l'indice selon l'état débloqué.
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
  // En tactile l'aide est déjà masquée (les raccourcis clavier n'ont pas de sens).
  if (IS_TOUCH || !helpHint) return;
  buildHelpHint();
  clearTimeout(helpDismissTimer);
  helpDismissTimer = setTimeout(() => {
    helpDismissTimer = null;
    helpHint.classList.add('help-dismissed');   // fondu ~1 s, définitif pour la session
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
  try { audio.start(); } catch { /* l'expérience visuelle reste disponible sans audio */ }
  scheduleHelpDismiss();
  scheduleControlReveals();
  playVoyageIntro();
  firstVoyageGuide.start();
}

startButton?.addEventListener('click', launchExperience);

// Carton d'accueil : une invitation cinématique à explorer, jouée une seule fois
// au tout premier départ (seul avec le smolbot, pas encore de flotte). Révélée au
// centre puis effacée d'elle-même ; se retire aussi au premier geste de conduite
// (touche clavier, ou contact sur le pad tactile). En tactile elle est décalée vers
// le haut (cf. media query) pour ne pas croiser #drive-tutorial — centré — qui, lui,
// n'apparaît qu'au moment où le doigt se pose sur le pad.
const voyageIntro = document.getElementById('voyage-intro');
const VOYAGE_INTRO_DELAY = 1300;   // laisse l'accueil se dissiper (fondu .75 s) avant d'entrer
const VOYAGE_INTRO_HOLD = 6000;    // pleinement lisible avant de commencer à s'effacer
const VOYAGE_INTRO_FADE = 1400;    // durée du fondu de sortie (>= transition CSS d'opacité)
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
    void voyageIntro.offsetWidth;            // reflow : garantit le fondu depuis l'état masqué
    voyageIntro.classList.add('playing');
    addEventListener('keydown', voyageIntroKeyDismiss, true);
    voyageIntroTimers.push(setTimeout(dismissVoyageIntro, VOYAGE_INTRO_HOLD));
  }, VOYAGE_INTRO_DELAY));
}

function storedBoatName() {
  try { return localStorage.getItem(LAST_BOAT_KEY); } catch { return null; }
}

function rememberBoat(name) {
  try { localStorage.setItem(LAST_BOAT_KEY, name); } catch { /* storage may be disabled */ }
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
  try { localStorage.setItem(WAVE_INTENSITY_KEY, String(level)); } catch { /* storage may be disabled */ }
}

function storedCamMode() {
  try {
    const m = Number(localStorage.getItem(CAM_MODE_KEY));
    return Number.isInteger(m) && m >= 0 && m <= 3 ? m : 0;
  } catch {
    return 0;
  }
}

function rememberCamMode(mode) {
  try { localStorage.setItem(CAM_MODE_KEY, String(mode)); } catch { /* storage may be disabled */ }
}
// convention: nom_LONGUEUR.glb ; suffixe "r" = modèle monté à l'envers
// (ex: motoryacht_10.7r.glb -> 10,7 m, retourné de 180 degrés)
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
  boatIdx = ((i % boatList.length) + boatList.length) % boatList.length;
  const name = boatList[boatIdx];
  const m = name.match(/_(\d+(?:\.\d+)?)(r)?\.glb$/i);
  const spec = getVesselSpec(name);
  boat.setSpec(spec);
  boat.reset();
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
  orbitDist = spec.camera.chaseDistance;
  topDist = defaultTopDist(spec);
  // le mode caméra est conservé (restauré depuis localStorage), pas remis à zéro
  camInit = false;
}
// Liste statique de la flotte (à tenir à jour en ajoutant/retirant un bateau).
// Un fichier plutôt qu'un autoindex nginx : marche aussi en hébergement statique.
fetch('./assets/boats/index.json')
  .then(r => r.json())
  .then(list => {
    allBoatList = list.map(e => e.name).filter(n => /\.glb$/i.test(n)).sort();
    boatList = availableBoatNames();
    const saved = storedBoatName();
    // Les modèles sans variante mobile sont très lourds en géométrie.
    // Ne jamais les restaurer automatiquement au démarrage d'un appareil tactile :
    // le Zefiro sûr s'affiche d'abord, ils restent sélectionnables volontairement.
    // (frickies_yacht : 11 Mo, 43 meshes d'aménagement intérieur -> même cas.)
    const unsafeMobileStartup = IS_TOUCH && /motoryacht|ss_minnow|frickies_yacht/i.test(saved || '');
    const savedIdx = unsafeMobileStartup ? -1 : boatList.indexOf(saved);
    const z = boatList.findIndex(n => /zefiro/i.test(n));
    if (boatList.length) loadBoatByIndex(savedIdx >= 0 ? savedIdx : (z >= 0 ? z : 0), { initial: true });
    else boat.loadModel('./assets/boat.glb').finally(() => { initialBoatReady = true; finishInitialLoadingWhenReady(); });
  })
  .catch(() => boat.loadModel('./assets/boat.glb').finally(() => { initialBoatReady = true; finishInitialLoadingWhenReady(); }));

// ---------------- ciel HDRI: fond, IBL, soleil et brume extraits ----------------
const skyUrl = IS_TOUCH ? './assets/sky_clear_1k.hdr' : './assets/sky_clear_4k.hdr';
new RGBELoader()
  .setDataType(THREE.HalfFloatType)
  .load(skyUrl, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const { data, width, height } = tex.image;

    // direction du soleil = texel le plus lumineux; brume = bande d'horizon
    let bestLum = -1, bestU = 0, bestV = 0;
    const horizon = [0, 0, 0];
    let hn = 0;
    const channel = (index) => tex.type === THREE.HalfFloatType
      ? THREE.DataUtils.fromHalfFloat(data[index]) : data[index];
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4;
        const r = channel(i), g = channel(i + 1), b = channel(i + 2);
        const lum = r * 0.3 + g * 0.6 + b * 0.1;
        const v = 1 - y / height; // v=1 en haut
        if (lum > bestLum) { bestLum = lum; bestU = x / width; bestV = v; }
        if (v > 0.5 && v < 0.54) {
          horizon[0] += r; horizon[1] += g; horizon[2] += b;
          hn++;
        }
      }
    }
    const lon = (bestU - 0.5) * Math.PI * 2;
    const lat = (bestV - 0.5) * Math.PI;
    sun.set(Math.cos(lon) * Math.cos(lat), Math.sin(lat),
            Math.sin(lon) * Math.cos(lat));
    if (sun.y < 0.05) sun.y = 0.05; // garde-fou si convention v inversée
    sun.normalize();
    ocean.uniforms.uSunDir.value.copy(sun);
    boat.setStartYaw(startYawFromSun(), true);
    camInit = false;

    const fogC = new THREE.Color(
      horizon[0] / hn, horizon[1] / hn, horizon[2] / hn);
    // compression HDR -> LDR pour la couleur de brume
    fogC.r = fogC.r / (1 + fogC.r); fogC.g = fogC.g / (1 + fogC.g);
    fogC.b = fogC.b / (1 + fogC.b);
    scene.fog.color.copy(fogC);
    clearFogColor.copy(fogC);

    scene.background = tex;
    scene.backgroundIntensity = 1.0;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();

    // disque solaire visible (celui de l'HDRI est voilé par les nuages)
    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    const sctx = sc.getContext('2d');
    const sg = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sg.addColorStop(0, 'rgba(255,252,240,1)');
    sg.addColorStop(0.07, 'rgba(255,248,225,0.95)');
    sg.addColorStop(0.2, 'rgba(255,238,195,0.35)');
    sg.addColorStop(0.55, 'rgba(255,228,175,0.1)');
    sg.addColorStop(1, 'rgba(255,225,165,0)');
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, 256, 256);
    const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(sc),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    sunSpr.position.copy(sun).multiplyScalar(3000);
    sunSpr.scale.set(750, 750, 1);
    sunHolder.add(sunSpr);
    sunSprite = sunSpr;
    skyReady = true;
    finishInitialLoadingWhenReady();
  }, undefined, () => {
    skyReady = true;
    finishInitialLoadingWhenReady();
  });

// suit la caméra en XZ: soleil "à l'infini"
const sunHolder = new THREE.Group();
scene.add(sunHolder);

// ---------------- passes réflexion / réfraction (couche 1 = bateau) ----------------
// résolution modérée: assez haute pour éviter les blocs à angle rasant, le
// filtrage linéaire + la distorsion par les vagues gardent le reflet doux
const reflRT = new THREE.WebGLRenderTarget(IS_TOUCH ? 512 : 1024, IS_TOUCH ? 512 : 1024);
const refrRT = new THREE.WebGLRenderTarget(
  Math.floor(innerWidth / 2), Math.floor(innerHeight / 2));
refrRT.depthTexture = new THREE.DepthTexture(
  Math.floor(innerWidth / 2), Math.floor(innerHeight / 2),
  THREE.UnsignedIntType);
refrRT.depthTexture.format = THREE.DepthFormat;
const mirrorCam = new THREE.PerspectiveCamera();
mirrorCam.layers.set(1);
const reflPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.05);  // y > -0.05
const refrPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.35); // y < 0.35
const biasMatrix = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const tmpDir = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
let lastReflectionAt = -Infinity;
let lastRefractionAt = -Infinity;

ocean.uniforms.uReflMap.value = reflRT.texture;
ocean.uniforms.uRefrMap.value = refrRT.texture;
ocean.uniforms.uRefrDepth.value = refrRT.depthTexture;
ocean.uniforms.uCameraNear.value = camera.near;
ocean.uniforms.uCameraFar.value = camera.far;

function renderWaterPasses(now, quality) {
  // 0 = synchronisé sur chaque frame. Un seuil de 60 Hz n'est pas équivalent :
  // les rAF à 16,4–16,7 ms peuvent tomber juste sous 1000/60 et faire sauter une
  // frame de manière irrégulière, très visible dans la projection du reflet.
  const reflectionDue = quality.reflectionHz <= 0
    || now - lastReflectionAt >= 1000 / quality.reflectionHz;
  const refractionDue = quality.refractionHz <= 0
    || now - lastRefractionAt >= 1000 / quality.refractionHz;
  if (!reflectionDue && !refractionDue) return;
  const waterY = waveField.heightAt(boat.pos.x, boat.pos.z);
  reflPlane.constant = -waterY + 0.05;
  refrPlane.constant = waterY + 0.35;
  const oldMask = camera.layers.mask;
  const oldBg = scene.background;
  const oldFog = scene.fog;
  const oldParadiseSkyVisible = paradiseSky.visible;
  scene.background = null;
  scene.fog = null;
  // Le voile est une finition du ciel principal, pas une source de couleur
  // pour les textures techniques de réflexion/réfraction de l'eau.
  paradiseSky.visible = false;
  renderer.setClearColor(0x000000, 0);

  if (refractionDue) {
    // réfraction: caméra normale, parties immergées du bateau
    camera.layers.set(1);
    renderer.clippingPlanes = [refrPlane];
    renderer.setRenderTarget(refrRT);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.mask = oldMask;
    lastRefractionAt = now;
  }

  if (reflectionDue) {
    // réflexion: caméra miroir sous le plan y=0
    mirrorCam.position.copy(camera.position);
    mirrorCam.position.y = 2 * waterY - mirrorCam.position.y;
    camera.getWorldDirection(tmpDir);
    tmpTarget.copy(camera.position).add(tmpDir);
    tmpTarget.y = 2 * waterY - tmpTarget.y;
  // up de la caméra-miroir = up réel de la caméra réfléchi par le plan d'eau
  // (composante y inversée). Hardcoder (0,-1,0) suppose un up monde (0,1,0) :
  // faux en vue du dessus où camera.up = (0,0,-1), l'up devenait PARALLÈLE à
  // l'axe de visée vertical, lookAt dégénérait et le reflet du bateau tournait
  // autour de lui (fantôme flou orbitant) au lieu de se poser sous la coque.
    mirrorCam.up.set(camera.up.x, -camera.up.y, camera.up.z);
    mirrorCam.lookAt(tmpTarget);
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCam.updateMatrixWorld();
    ocean.uniforms.uReflMatrix.value
      .copy(biasMatrix)
      .multiply(mirrorCam.projectionMatrix)
      .multiply(mirrorCam.matrixWorldInverse);
    renderer.clippingPlanes = [reflPlane];
    renderer.setRenderTarget(reflRT);
    renderer.clear();
    renderer.render(scene, mirrorCam);
    lastReflectionAt = now;
  }

  renderer.clippingPlanes = [];
  renderer.setRenderTarget(null);
  scene.background = oldBg;
  scene.fog = oldFog;
  paradiseSky.visible = oldParadiseSkyVisible;
}

// ---------------- post-processing ----------------
const bufSize = renderer.getDrawingBufferSize(new THREE.Vector2());
const composerRT = new THREE.WebGLRenderTarget(bufSize.x, bufSize.y, {
  samples: IS_TOUCH ? 0 : 4, // MSAA coûteux sur GPU mobile ; l'AA du shader océan suffit
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
  if (force || !previous || previous.reflectionSize !== quality.reflectionSize) {
    reflRT.setSize(quality.reflectionSize, quality.reflectionSize);
    lastReflectionAt = -Infinity;
  }
  if (viewportChanged || !previous
      || previous.refractionScale !== quality.refractionScale) {
    refrRT.setSize(
      Math.max(1, Math.floor(innerWidth * quality.refractionScale)),
      Math.max(1, Math.floor(innerHeight * quality.refractionScale)),
    );
    lastRefractionAt = -Infinity;
  }
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
  seabed.setPerformanceBudget(quality);
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
  // Un clic ne doit pas laisser le halo actif ; au clavier, le focus est conservé
  // pour permettre de continuer à naviguer avec Tab/Flèches.
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

// ---------------- entrées ----------------
const keys = new Set();

// actions ponctuelles, partagées entre clavier et boutons tactiles
function resetBoat() {
  throttle = 0;
  wheel = 0;
  boat.reset();
  achievements.resetFlight();
  achievements.resetCircle();
  orbitYaw = 0; orbitPitch = 0.3; topYaw = 0;
  orbitDist = boat.spec.camera.chaseDistance;
  topDist = defaultTopDist(boat.spec);
  camInit = false;
  resetGestureDrive();
}
function cycleCamera() {
  camMode = (camMode + 1) % 4;
  rememberCamMode(camMode);
  if (camMode === 3) beginCinematicCamera();
  else camInit = false;
  achievements.recordCamera(camMode);
  announceCameraMode();
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
  keys.add(e.code);
  if (e.code === 'KeyR') resetBoat();
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyB') e.shiftKey ? previousBoat() : nextBoat();
  // Raccourci global : on NE déplace PAS le focus (restoreFocus=false), sinon le focus
  // resterait sur le bouton du journal et la touche Espace « stop » le ré-activerait.
  if (e.code === 'KeyL') achievements.togglePanel(false);   // ouvre/ferme le journal de bord
  if (e.code === 'Space') throttle = 0;
  const states = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };
  if (states[e.code] !== undefined && seaControlsUnlocked()) {
    setWaveIntensity(states[e.code], { userInitiated: true });
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
// filet de sécurité : ne jamais laisser une commande « bloquée » si le focus
// part (onglet masqué, appel entrant, geste interrompu…)
addEventListener('blur', () => { keys.clear(); resetGestureDrive(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); resetGestureDrive(); }
});

// ---------------- commandes tactiles à l'écran ----------------
// Le contact initial devient le neutre. Les deux axes sont continus et peuvent
// être combinés ; une zone morte évite que le roulis naturel du pouce commande
// le bateau. Au relâché, updateControls() ramène les deux axes à zéro.
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
    if (gestureState.active || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    audio.start();
    dismissVoyageIntro();   // le premier contact sur le pad cède le centre au tutoriel de conduite
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
}

function setWaveIntensity(level, { userInitiated = false } = {}) {
  if (!SEA_PRESETS[level]) return;
  const changed = waveField.preset !== level;
  if (userInitiated && changed) {
    achievements.recordWaveChange();
    document.body.classList.remove('sea-trial-visible');
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

// Un clic souris laisse le focus sur le bouton. Or Espace (throttle stop) et
// Entrée ré-actionnent un bouton focalisé : piloter rejouerait alors le bouton
// sans le vouloir. On rend donc le focus après un clic pointeur (detail > 0),
// tout en le gardant pour une activation clavier (detail 0) → Tab+Entrée intact.
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

// Sur tactile, la bande elle-même devient une surface de navigation : un geste
// horizontal franc change de bateau, tandis qu'un tap sur les flèches reste précis.
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

let throttle = 0; // desktop : levier stable ; tactile : revient au neutre au relâché
let wheel = 0;    // barre: auto-centrée, +1 = tribord
function updateControls(dt) {
  if (location.hash === '#auto') { // démo: plein gaz puis virage à 6 s
    const t = waveField.time;
    throttle = 1;
    wheel = (t > 6 && t < 30) ? 0.9 : 0;
    boat.setControls(throttle, wheel);
    return;
  }
  if (gestureState.active) {
    throttle = gestureState.throttle;
    wheel = gestureState.steer;
    boat.setControls(throttle, wheel);
    return;
  }
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const dn = keys.has('KeyS') || keys.has('ArrowDown');
  if (up) throttle = Math.min(throttle + 0.7 * dt, 1);
  if (dn) throttle = Math.max(throttle - 0.9 * dt, -1);
  if (IS_TOUCH && !up && !dn) {
    const returnRate = 4.8 * dt;
    if (throttle > returnRate) throttle -= returnRate;
    else if (throttle < -returnRate) throttle += returnRate;
    else throttle = 0;
  }
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const rightK = keys.has('KeyD') || keys.has('ArrowRight');
  if (rightK && !left) wheel = Math.min(wheel + 2.2 * dt, 1);
  else if (left && !rightK) wheel = Math.max(wheel - 2.2 * dt, -1);
  else {
    const rc = 1.6 * dt;
    if (wheel > rc) wheel -= rc;
    else if (wheel < -rc) wheel += rc;
    else wheel = 0;
  }
  boat.setControls(throttle, wheel);
}

// ---------------- caméra ----------------
const CAMERA_MODE_NAMES = ['Chase camera', 'Helm camera', 'Top camera', 'Cinematic camera'];
const reducedCameraMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let camMode = storedCamMode(); // 0 = poursuite, 1 = barre, 2 = dessus, 3 = cinématique
achievements.recordCamera(camMode);
// orbite autour du bateau (relative au cap) : 1 pointeur = glisser pour orbiter,
// 2 pointeurs = pincer pour zoomer, molette = zoom (desktop).
let orbitYaw = 0;
let orbitPitch = 0.3;
let orbitDist = 12;
// Zooms indépendants : la caméra libre (poursuite) et la vue du dessus gardent
// chacune leur propre distance/hauteur ; molette et pince agissent sur le mode actif.
const ORBIT_MIN = 2.5, ORBIT_MAX = 90; // cadre encore le mégayacht de 78 m sans trop s'éloigner
// Vue du dessus : plafond assez haut pour cadrer le mégayacht de 78 m. Sa
// distance par défaut dédiée reste à 150 m afin de ne pas le perdre dans le
// brouillard de tempête ; 320 m ne sert qu'au dézoom volontaire de l'utilisateur.
const TOP_MIN = 12, TOP_MAX = 320;
let topDist = 60; // hauteur caméra en vue du dessus (recalée par bateau)
let topYaw = 0;   // orientation de la carte en vue du dessus (0 = nord en haut)
let cinematicAngle = Math.PI * 1.18;
let cinematicTime = 0;
let cameraStatusTimer = null;

function announceCameraMode() {
  const status = document.getElementById('camera-status');
  if (!status) return;
  status.textContent = CAMERA_MODE_NAMES[camMode];
  status.classList.remove('visible');
  requestAnimationFrame(() => status.classList.add('visible'));
  clearTimeout(cameraStatusTimer);
  cameraStatusTimer = setTimeout(() => status.classList.remove('visible'), 1400);
}

// Commence l'orbite depuis l'angle actuel de la caméra afin que le passage au
// mode cinématique soit un travelling continu, pas un changement de plan sec.
function beginCinematicCamera() {
  const fwd = tmpV.set(0, 0, 1).applyQuaternion(boat.quat);
  const heading = Math.atan2(fwd.x, fwd.z);
  camDesired.copy(camera.position).sub(boat.pos);
  cinematicAngle = Math.atan2(camDesired.x, camDesired.z) - heading;
  camera.getWorldDirection(tmpV2);
  camTarget.copy(camera.position).addScaledVector(
    tmpV2, Math.max(boat.spec.camera.chaseDistance, 10),
  );
  cinematicTime = 0;
  camInit = true;
}
function defaultTopDist(spec) {
  return spec.camera.topDistance
    ?? spec.camera.chaseDistance * 2 + spec.length * 4;
}
function activeZoom() { return camMode === 2 ? topDist : orbitDist; }
function setActiveZoom(v) {
  const before = activeZoom();
  if (camMode === 2) topDist = THREE.MathUtils.clamp(v, TOP_MIN, TOP_MAX);
  else orbitDist = THREE.MathUtils.clamp(v, ORBIT_MIN, ORBIT_MAX);
  if ((camMode === 0 || camMode === 2) && Math.abs(activeZoom() - before) > 0.001) {
    achievements.recordCameraControl('zoom');
  }
}
// Le glissé horizontal oriente la caméra : orbite autour du bateau en poursuite,
// pivot de la carte (autour de la verticale) en vue du dessus.
function orbitHoriz(dx) {
  if (camMode === 2) topYaw -= dx * 0.006;
  else orbitYaw -= dx * 0.006;
  if ((camMode === 0 || camMode === 2) && Math.abs(dx) > 0.1) {
    achievements.recordCameraControl('orbit');
  }
}
// On ne suit que les pointeurs nés sur le canvas : le pouce de pilotage reste
// indépendant. Pendant le pilotage, un deuxième doigt orbite horizontalement
// et son mouvement vertical règle le zoom ; sans pilotage, orbite + pinch usuels.
const dragPointers = new Map(); // pointerId -> { x, y }
let pinchStartDist = 0, pinchStartZoom = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  audio.start(); // premier contact n'importe où → démarre l'audio
  dragPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (dragPointers.size === 2) {
    const [a, b] = [...dragPointers.values()];
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchStartZoom = activeZoom();
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
      setActiveZoom(pinchStartZoom * pinchStartDist / d);
    }
  } else if (gestureState.active && IS_TOUCH) {
    orbitHoriz(e.clientX - prevX);
    setActiveZoom(activeZoom() * Math.exp((e.clientY - prevY) * 0.008));
  } else {
    orbitHoriz(e.clientX - prevX);
    // en vue du dessus, le vertical n'incline pas une caméra à la verticale ;
    // seul le glissé horizontal agit (pivot de la carte via orbitHoriz).
    if (camMode !== 2) {
      const previousPitch = orbitPitch;
      orbitPitch = THREE.MathUtils.clamp(
        orbitPitch + (e.clientY - prevY) * 0.004, 0.14, 1.25);
      if (camMode === 0 && Math.abs(orbitPitch - previousPitch) > 0.0001) {
        achievements.recordCameraControl('orbit');
      }
    }
  }
});
function endDrag(e) {
  dragPointers.delete(e.pointerId);
  if (dragPointers.size < 2) pinchStartDist = 0; // reprise propre à un seul doigt
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('wheel', (e) => {
  if (e.target instanceof Element && e.target.closest('#achievements-panel')) return;
  setActiveZoom(activeZoom() * Math.exp(e.deltaY * 0.0012));
}, { passive: true });

const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
let camInit = false;

function updateCamera(dt) {
  const fwd = tmpV.set(0, 0, 1).applyQuaternion(boat.quat);
  // la vue du dessus regarde droit vers le bas et redéfinit son « haut » ;
  // les autres modes ont besoin du haut monde classique pour leur lookAt.
  if (camMode !== 2) camera.up.set(0, 1, 0);
  if (camMode === 0) {
    const speed0 = boat.vel.length();
    const camSpec = boat.spec.camera;
    const heading = Math.atan2(fwd.x, fwd.z);
    const a = heading + Math.PI + orbitYaw; // 0 = derrière le bateau
    const dist = orbitDist + speed0 * 0.06;
    const horiz = dist * Math.cos(orbitPitch);
    camDesired.set(
      boat.pos.x + Math.sin(a) * horiz,
      boat.pos.y + dist * Math.sin(orbitPitch) + camSpec.chaseHeight,
      boat.pos.z + Math.cos(a) * horiz,
    );
    const minY = waveField.heightAt(camDesired.x, camDesired.z)
               + Math.max(1.35, camSpec.chaseHeight + 0.55);
    if (camDesired.y < minY) camDesired.y = minY;
    const k = camInit ? 1 - Math.exp(-dt * (3.2 + speed0 * 0.12)) : 1;
    camera.position.lerp(camDesired, k);
    // anticipation devant le bateau seulement quand on est derrière lui
    const ahead = 5 * Math.max(Math.cos(orbitYaw), 0);
    // Sur mobile, on vise légèrement plus bas pour remonter le bateau dans le
    // viewport et réserver la bande de sélection. Le décalage suit la distance
    // de poursuite afin de rester visuellement constant d'un bateau à l'autre.
    const mobileFramingDrop = IS_TOUCH ? camSpec.chaseDistance * 0.065 : 0;
    camLook.copy(boat.pos).addScaledVector(fwd, ahead).y += 1.1 - mobileFramingDrop;
    camTarget.lerp(camLook, camInit ? 1 - Math.exp(-dt * 8) : 1);
    camera.lookAt(camTarget);
    const fov = Math.min(58 + speed0 * 0.18, 66);
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camInit = true;
  } else if (camMode === 1) {
    const camSpec = boat.spec.camera;
    boat.worldPoint(camSpec.helm, camera.position);
    camLook.copy(camera.position)
      .addScaledVector(fwd, Math.max(10, boat.spec.length * 1.6)).y -= 0.25;
    camera.lookAt(camLook);
    if (camera.fov !== camSpec.helmFov) {
      camera.fov = camSpec.helmFov;
      camera.updateProjectionMatrix();
    }
  } else if (camMode === 2) {
    // vue du dessus : caméra verticale dézoomée façon carte, centrée sur le bateau.
    // Hauteur propre (topDist), indépendante du zoom de la caméra libre et
    // ajustable à la molette/pince ; recalée par bateau au chargement.
    camDesired.set(boat.pos.x, boat.pos.y + topDist, boat.pos.z);
    camera.position.lerp(camDesired, camInit ? 1 - Math.exp(-dt * 3.5) : 1);
    // « haut » de l'écran orientable au glissé (topYaw) ; à 0, le nord (−Z) est en haut.
    camera.up.set(Math.sin(topYaw), 0, -Math.cos(topYaw));
    camLook.lerp(boat.pos, camInit ? 1 - Math.exp(-dt * 8) : 1);
    camera.lookAt(camLook);
    if (Math.abs(camera.fov - 55) > 0.1) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    if (topDist >= TOP_MAX) achievements.recordAntWorld();
    camInit = true;
  } else {
    // Travelling automatique sans coupes. L'orbite reste liée au cap du bateau,
    // tandis que de lentes variations de focale, hauteur et distance évitent un
    // mouvement mécanique. Les dimensions viennent du spec de chaque bateau.
    cinematicTime += dt;
    const camSpec = boat.spec.camera;
    const heading = Math.atan2(fwd.x, fwd.z);
    const turnRate = reducedCameraMotion ? 0.018 : 0.055;
    cinematicAngle += dt * turnRate;

    const breathe = reducedCameraMotion ? 0 : Math.sin(cinematicTime * 0.19);
    const baseDist = Math.max(camSpec.chaseDistance * 1.35, boat.spec.length * 0.38);
    const dist = baseDist * (1 + breathe * 0.07);
    const height = Math.max(
      camSpec.chaseHeight + 1.25,
      dist * (0.24 + Math.sin(cinematicTime * 0.13 + 0.8) * 0.035),
    );
    const worldAngle = heading + cinematicAngle;
    camDesired.set(
      boat.pos.x + Math.sin(worldAngle) * dist,
      boat.pos.y + height,
      boat.pos.z + Math.cos(worldAngle) * dist,
    );
    const minY = waveField.heightAt(camDesired.x, camDesired.z)
               + Math.max(1.25, camSpec.chaseHeight + 0.5);
    if (camDesired.y < minY) camDesired.y = minY;

    const positionEase = camInit ? 1 - Math.exp(-dt * 0.82) : 1;
    camera.position.lerp(camDesired, positionEase);

    const speed = boat.vel.length();
    const ahead = Math.max(1.5, Math.min(boat.spec.length * 0.16, 9) + speed * 0.35);
    camLook.copy(boat.pos);
    camLook.x += Math.sin(heading) * ahead;
    camLook.z += Math.cos(heading) * ahead;
    camLook.y += Math.max(0.7, boat.spec.length * 0.025);
    camTarget.lerp(camLook, camInit ? 1 - Math.exp(-dt * 2.4) : 1);
    camera.lookAt(camTarget);

    const cinematicFov = 50 + (reducedCameraMotion ? 0 : Math.sin(cinematicTime * 0.11) * 2.2);
    const nextFov = THREE.MathUtils.damp(camera.fov, cinematicFov, 1.8, dt);
    if (Math.abs(camera.fov - nextFov) > 0.001) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
    camInit = true;
  }
}

// ---------------- HUD ----------------
const elKn = document.getElementById('kn');
const elThrottle = document.querySelector('#throttle i');
const elRudder = document.querySelector('#rudder i');
function updateHUD() {
  elKn.textContent = boat.speedKn.toFixed(1);
  elThrottle.style.width = `${Math.abs(throttle) * 100}%`;
  elThrottle.classList.toggle('reverse', throttle < 0);
  elRudder.style.width = '4px';
  elRudder.style.marginLeft = `${(0.5 + wheel * 0.5) * 136}px`;
}

// ---------------- boucle ----------------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  queueQuality(currentQuality, true);
});

if (new URLSearchParams(location.search).has('debug')) {
  window.openWater = {
    boat, waveField, camera, ocean, effects, foamTrail, weather, audio, renderer, achievements,
    snapCamera: () => { camInit = false; },
  };
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const frameStart = performance.now();
  performanceManager.beginFrame(frameStart);
  // Toute réallocation arrive avant le premier rendu de la frame. L'appliquer
  // après composer.render() effaçait le canvas juste avant sa composition et
  // produisait un flash noir à chaque ajustement automatique.
  if (pendingQuality) {
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
  updateAtmosphere(dt);
  updateControls(dt);
  boat.update(dt);
  achievements.update(dt, boat, waveField, achievementFauna);
  ocean.update(dt, boat.pos.x, boat.pos.z, boat);
  foamTrail.update(renderer, dt, boat);
  ocean.uniforms.uFoamTrail.value = foamTrail.texture;
  ocean.uniforms.uTrailCenter.value.copy(foamTrail.center);
  effects.update(dt);
  sunHolder.position.set(camera.position.x, 0, camera.position.z);
  updateCamera(dt);
  firstVoyageGuide.update(dt);
  paradiseSky.position.copy(camera.position);
  audio.update(boat, camera, dt);
  weather.update(dt);
  wildlife.update(dt);
  fish.update(dt);
  dolphins.update(dt);
  whales.update(dt);
  seabed.update(dt);
  turtles.update(dt);
  mantas.update(dt);
  birds.update(dt);
  updateHUD();
  // ombre portée qui suit le bateau
  sunLight.position.copy(boat.pos).addScaledVector(sun, 80);
  sunLight.target.position.copy(boat.pos);
  performanceManager.beginGpu();
  renderWaterPasses(frameStart, currentQuality);
  composer.render();
  performanceManager.endGpu();
  performanceManager.endFrame();
  updatePerformanceHud(frameStart);
  renderedFrames++;
  finishInitialLoadingWhenReady();
});
