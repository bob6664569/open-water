const STORAGE_KEY = 'ocean-boat:achievements:v1';
const SAVE_INTERVAL = 2000;
const UNLOCK_SPACING = 8000;
const STATE_VERSION = 19;

const NM = 1852;
const MIN_JUMP_SPEED_KN = 5;
const MIN_JUMP_HEIGHT = 0.2;
const MIN_AIR_TIME = 0.35;
const WHALE_ENCOUNTER_DISTANCE = 45;
const TURTLE_ENCOUNTER_DISTANCE = 12;
const MANTA_ENCOUNTER_DISTANCE = 18;
const SHARK_ENCOUNTER_DISTANCE = 20;
const FULL_CIRCLE = Math.PI * 2;
const CIRCLE_MIN_SPEED_KN = 1.5;
const CIRCLE_MIN_THROTTLE = 0.18;
const CIRCLE_MIN_STEER = 0.92;

export const ACHIEVEMENTS = Object.freeze([
  {
    id: 'maiden-voyage', title: 'Maiden Voyage',
    description: 'Cast off and begin your first voyage.',
    metric: 'voyages', target: 1,
  },
  {
    id: 'speed-20', title: 'Making Way', series: 'Speed', tier: 1,
    description: 'Break 20 knots in any vessel.',
    metric: 'bestSpeedKn', target: 20,
  },
  {
    id: 'speed-40', title: 'White Knuckles', series: 'Speed', tier: 2,
    description: 'Break 40 knots in any vessel.',
    metric: 'bestSpeedKn', target: 40,
  },
  {
    id: 'speed-50', title: 'Water Rocket', series: 'Speed', tier: 3, reward: 'racer',
    description: 'Break the 50-knot barrier. The Redline Phantom is now available.',
    metric: 'bestSpeedKn', target: 50,
  },
  {
    id: 'distance-1', title: 'Open Water', series: 'Distance', tier: 1, reward: 'azure',
    description: 'Leave half a nautical mile in your wake. The Azure Comet and sea controls are now available.',
    metric: 'distanceMeters', target: 0.5 * NM,
  },
  {
    id: 'distance-3', title: 'Coastal Run', series: 'Distance', tier: 2, reward: 'ivory',
    description: 'Travel a total of three nautical miles. The Ivory Horizon is now available.',
    metric: 'distanceMeters', target: 3 * NM,
  },
  {
    id: 'distance-10', title: 'Beyond the Horizon', series: 'Distance', tier: 3,
    description: 'Travel a total of ten nautical miles.',
    metric: 'distanceMeters', target: 10 * NM,
  },
  {
    id: 'distance-100', title: 'Long Watch', series: 'Distance', tier: 4,
    description: 'Travel a total of one hundred nautical miles.',
    metric: 'distanceMeters', target: 100 * NM,
  },
  {
    id: 'distance-1000', title: 'Oceanic', series: 'Distance', tier: 5,
    description: 'Travel a total of one thousand nautical miles.',
    metric: 'distanceMeters', target: 1000 * NM,
  },
  {
    id: 'storm-watch', title: 'Storm Watch',
    description: 'Hold your course for one minute in Storm seas.',
    metric: 'stormSeconds', target: 60,
  },
  {
    id: 'fleet-review-3', title: 'Fleet Review', series: 'Fleet', tier: 1,
    description: 'Take the helm of three different vessels.',
    metric: 'boats', target: 3,
  },
  {
    id: 'fleet-review', title: 'Harbour Master', series: 'Fleet', tier: 2,
    description: 'Take the helm of five different vessels.',
    metric: 'boats', target: 5,
  },
  {
    id: 'fleet-review-8', title: 'Full Fleet', series: 'Fleet', tier: 3,
    description: 'Take the helm of every vessel in the fleet.',
    metric: 'boats', target: 9,
  },
  {
    id: 'directors-cut', title: "Director's Cut",
    description: 'Discover every angle with all four camera modes.',
    metric: 'cameras', target: 4,
  },
  {
    id: 'camera-apprentice', title: 'Camera Apprentice',
    description: 'Zoom and rotate the camera to frame your vessel.',
    metric: 'cameraControls', target: 2,
  },
  {
    id: 'ant-world', title: 'Ant World',
    description: 'Pull the vertical drone camera all the way back until the boat looks tiny.',
    metric: 'antWorldSeen', target: 1,
  },
  {
    id: 'quality-tuned', title: 'Fine Tuning',
    description: 'Change the display quality setting yourself.',
    metric: 'qualityChanged', target: 1,
  },
  {
    id: 'full-circle', title: 'Full Circle',
    description: 'Complete a full turn under power with the rudder pinned.',
    metric: 'bestCircleRadians', target: FULL_CIRCLE,
  },
  {
    id: 'wave-change', title: 'Sea Change', series: 'Sea states', tier: 1,
    description: 'Change the sea state for the first time.',
    metric: 'waveChanges', target: 1,
  },
  {
    id: 'all-weather', title: 'All Weather', series: 'Sea states', tier: 2,
    description: 'Sail through Calm, Rolling, Rough and Storm seas.',
    metric: 'seas', target: 4,
  },
  {
    id: 'playtime-2m', title: 'Sea Legs', series: 'Play time', tier: 1, reward: 'zodiac',
    description: 'Spend two minutes at sea. The Zodiac is now available.',
    metric: 'totalSeconds', target: 2 * 60,
  },
  {
    id: 'playtime-10m', title: 'Getting Settled', series: 'Play time', tier: 2,
    description: 'Spend ten minutes at sea.',
    metric: 'totalSeconds', target: 10 * 60,
  },
  {
    id: 'playtime-1h', title: 'Seasoned Hand', series: 'Play time', tier: 3,
    description: 'Spend one hour at sea.',
    metric: 'totalSeconds', target: 60 * 60,
  },
  {
    id: 'playtime-5h', title: 'Old Salt', series: 'Play time', tier: 4,
    description: 'Spend five hours at sea.',
    metric: 'totalSeconds', target: 5 * 60 * 60,
  },
  {
    id: 'playtime-20h', title: "Captain's Watch", series: 'Play time', tier: 5,
    description: 'Spend twenty hours at sea.',
    metric: 'totalSeconds', target: 20 * 60 * 60,
  },
  {
    id: 'dolphin-escort', title: 'In Good Company',
    description: 'Trigger a dolphin escort alongside your vessel.',
    metric: 'dolphinEscortTriggered', target: 1,
  },
  {
    id: 'whale-encounter', title: 'Gentle Giant',
    description: 'Approach within forty-five metres of a blue whale.',
    metric: 'whaleEncountered', target: 1,
  },
  {
    id: 'turtle-encounter', title: 'Old Soul',
    description: 'Approach within twelve metres of a sea turtle.',
    metric: 'turtleEncountered', target: 1,
  },
  {
    id: 'manta-encounter', title: 'Silent Wings',
    description: 'Approach within eighteen metres of a manta ray.',
    metric: 'mantaEncountered', target: 1,
  },
  {
    id: 'shark-encounter', title: 'Apex Encounter',
    description: 'Approach within twenty metres of a shark.',
    metric: 'sharkEncountered', target: 1,
  },
  {
    id: 'school-scattered', title: 'Parting Waters', series: 'Fish schools', tier: 1,
    description: 'Drive through a school and make the fish break formation.',
    metric: 'fishSchoolsDispersed', target: 1,
  },
  {
    id: 'school-scattered-3', title: 'School Breaker', series: 'Fish schools', tier: 2,
    description: 'Disperse fish schools five times.',
    metric: 'fishSchoolsDispersed', target: 5,
  },
  {
    id: 'first-jump', title: 'First Flight',
    description: 'Leave the water and land your first proper jump.',
    metric: 'jumpCount', target: 1,
  },
  {
    id: 'jump-height-1', title: 'Wave Hopper', series: 'Jump height', tier: 1,
    description: 'Clear one metre above the local wave surface.',
    metric: 'bestJumpHeight', target: 1,
  },
  {
    id: 'jump-height-3', title: 'Sea Bird', series: 'Jump height', tier: 2,
    description: 'Clear three metres above the local wave surface.',
    metric: 'bestJumpHeight', target: 3,
  },
  {
    id: 'jump-height-5', title: 'Skyline', series: 'Jump height', tier: 3,
    description: 'Clear five metres above the local wave surface.',
    metric: 'bestJumpHeight', target: 5,
  },
  {
    id: 'airtime-075', title: 'Weightless', series: 'Air time', tier: 1,
    description: 'Spend a total of ten seconds fully airborne.',
    metric: 'totalAirTime', target: 10,
  },
  {
    id: 'airtime-15', title: 'Hang Time', series: 'Air time', tier: 2,
    description: 'Accumulate one minute fully airborne.',
    metric: 'totalAirTime', target: 60,
  },
  {
    id: 'airtime-3', title: 'Flying Hull', series: 'Air time', tier: 3,
    description: 'Accumulate five minutes fully airborne.',
    metric: 'totalAirTime', target: 5 * 60,
  },
  {
    id: 'wave-rider', title: 'Wave Rider', reward: 'jetski',
    description: 'Clear six metres above the waves. The Neon Manta is now available.',
    metric: 'bestJumpHeight', target: 6,
  },
  {
    id: 'ivory-horizon-veteran', title: 'Yacht Club Regular', reward: 'megayacht',
    description: "Travel five nautical miles aboard Ivory Horizon. Frickie's Yacht is now available.",
    metric: 'vesselDistanceMeters', vesselId: 'motoryacht', target: 5 * NM,
  },
  {
    id: 'zodiac-veteran', title: 'Outboard Loyalist', reward: 'blackfin',
    description: 'Travel three nautical miles aboard Zodiac. The Blackfin Vanguard is now available.',
    metric: 'vesselDistanceMeters', vesselId: 'zodiac_boat', target: 3 * NM,
  },
  {
    id: 'fishermans-instinct', title: "A Fisherman's Instinct", series: 'Fish schools', tier: 3, reward: 'minnow',
    description: 'Disperse fish schools ten times. The S.S. Minnow III is now available.',
    metric: 'fishSchoolsDispersed', target: 10,
  },
]);

export const ACHIEVEMENT_ENTRIES = Object.freeze((() => {
  const entries = [];
  const seriesEntries = new Map();
  ACHIEVEMENTS.forEach(definition => {
    if (!definition.series) {
      entries.push({ id: definition.id, series: null, definitions: [definition] });
      return;
    }
    let entry = seriesEntries.get(definition.series);
    if (!entry) {
      entry = { id: `series:${definition.series}`, series: definition.series, definitions: [] };
      seriesEntries.set(definition.series, entry);
      entries.push(entry);
    }
    entry.definitions.push(definition);
  });
  return entries.map(entry => Object.freeze({
    ...entry,
    definitions: Object.freeze([...entry.definitions].sort((a, b) => (a.tier || 0) - (b.tier || 0))),
  }));
})());

function uniqueNumbers(values, min, max) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => Number.isInteger(value) && value >= min && value <= max))];
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))];
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function headingFromQuaternion(quaternion) {
  if (!quaternion) return 0;
  const { x = 0, y = 0, z = 0, w = 1 } = quaternion;
  const forwardX = 2 * (x * z + w * y);
  const forwardZ = 1 - 2 * (x * x + y * y);
  return Math.atan2(forwardX, forwardZ);
}

function positiveRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([key, amount]) => {
    if (/^[a-z0-9_-]+$/i.test(key) && Number.isFinite(amount) && amount > 0) result[key] = amount;
  });
  return result;
}

function roman(value) {
  const numerals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = Math.max(1, Math.floor(value));
  let result = '';
  for (const [amount, symbol] of numerals) {
    while (remaining >= amount) { result += symbol; remaining -= amount; }
  }
  return result;
}

function formatDistance(meters) {
  const nauticalMiles = finitePositive(meters) / NM;
  if (nauticalMiles < 10) return `${nauticalMiles.toFixed(2)} NM`;
  if (nauticalMiles < 1000) return `${nauticalMiles.toFixed(1)} NM`;
  return `${Math.round(nauticalMiles).toLocaleString()} NM`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(finitePositive(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export class AchievementManager {
  constructor() {
    this.button = document.getElementById('achievements-button');
    this.count = document.getElementById('achievements-count');
    this.panel = document.getElementById('achievements-panel');
    this.closeButton = document.getElementById('achievements-close');
    this.summary = document.getElementById('achievements-summary');
    this.list = document.getElementById('achievements-list');
    this.distanceRecord = document.getElementById('achievement-distance-record');
    this.timeRecord = document.getElementById('achievement-time-record');
    this.jumpRecord = document.getElementById('achievement-jump-record');
    this.airRecord = document.getElementById('achievement-air-record');
    this.toastRegion = document.getElementById('achievement-toast-region');
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.state = this._load();
    this.active = false;
    this.dirty = false;
    this.lastSave = performance.now();
    this.lastRender = 0;
    this.nextUnlockAt = 0;
    this.dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
    this.toastQueue = [];
    this.toastActive = false;
    this.lastFishDispersedObserved = 0;
    this.resetFlight();
    this.resetCircle();

    this._bindUI();
    this.render();

    addEventListener('pagehide', () => this._save(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._save(true);
    });
  }

  _emptyState() {
    return {
      version: STATE_VERSION,
      unlocked: {},
      seenAchievements: [],
      voyages: 0,
      bestSpeedKn: 0,
      distanceMeters: 0,
      vesselDistanceMeters: {},
      totalSeconds: 0,
      stormSeconds: 0,
      boats: [],
      cameras: [],
      cameraControls: [],
      antWorldSeen: 0,
      bestCircleRadians: 0,
      waveChanges: 0,
      qualityChanged: 0,
      seas: [],
      dolphinEscortTriggered: 0,
      whaleEncountered: 0,
      turtleEncountered: 0,
      mantaEncountered: 0,
      sharkEncountered: 0,
      fishSchoolsDispersed: 0,
      jumpCount: 0,
      bestJumpHeight: 0,
      bestAirTime: 0,
      totalAirTime: 0,
    };
  }

  _load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored || typeof stored !== 'object') return this._emptyState();
      const validIds = new Set(ACHIEVEMENTS.map(item => item.id));
      const unlocked = {};
      if (stored.unlocked && typeof stored.unlocked === 'object') {
        Object.entries(stored.unlocked).forEach(([id, timestamp]) => {
          if (validIds.has(id) && Number.isFinite(timestamp)) unlocked[id] = timestamp;
        });
        if (!unlocked['distance-1'] && Number.isFinite(stored.unlocked['open-water'])) {
          unlocked['distance-1'] = stored.unlocked['open-water'];
        }
      }
      // Preserve historical unlocks while mapping older save schemas to current tiers.
      const preTierState = !Number.isFinite(stored.version) || stored.version < 3;
      const boats = uniqueStrings(stored.boats);
      const obsoleteJumpReward = stored.version === 4
        && unlocked['wave-rider']
        && finitePositive(stored.bestJumpHeight) < 6
        && !boats.includes('seadoo-gti');
      if (obsoleteJumpReward) delete unlocked['wave-rider'];
      if (boats.includes('seadoo-gti') && !unlocked['wave-rider']) {
        unlocked['wave-rider'] = Date.now();
      }
      if (boats.includes('frickies_yacht') && !unlocked['ivory-horizon-veteran']) {
        unlocked['ivory-horizon-veteran'] = Date.now();
      }
      if (boats.includes('zefiro') && !unlocked['distance-1']) {
        unlocked['distance-1'] = Date.now();
      }
      if (boats.includes('motoryacht') && !unlocked['distance-3']) {
        unlocked['distance-3'] = Date.now();
      }
      if (unlocked['distance-1000'] && !unlocked['distance-100']) {
        unlocked['distance-100'] = unlocked['distance-1000'];
      }
      if (unlocked['distance-100'] && !unlocked['distance-10']) {
        unlocked['distance-10'] = unlocked['distance-100'];
      }
      if (unlocked['distance-10'] && !unlocked['distance-3']) {
        unlocked['distance-3'] = unlocked['distance-10'];
      }
      if (unlocked['distance-3'] && !unlocked['distance-1']) {
        unlocked['distance-1'] = unlocked['distance-3'];
      }
      if (boats.includes('zodiac_boat') && !unlocked['playtime-2m']) {
        unlocked['playtime-2m'] = Date.now();
      }
      if (unlocked['playtime-20h'] && !unlocked['playtime-5h']) {
        unlocked['playtime-5h'] = unlocked['playtime-20h'];
      }
      if (unlocked['playtime-5h'] && !unlocked['playtime-1h']) {
        unlocked['playtime-1h'] = unlocked['playtime-5h'];
      }
      if (unlocked['playtime-1h'] && !unlocked['playtime-10m']) {
        unlocked['playtime-10m'] = unlocked['playtime-1h'];
      }
      if (unlocked['playtime-10m'] && !unlocked['playtime-2m']) {
        unlocked['playtime-2m'] = unlocked['playtime-10m'];
      }
      if (boats.includes('assault-boat') && !unlocked['zodiac-veteran']) {
        unlocked['zodiac-veteran'] = Date.now();
      }
      if (boats.includes('ss_minnow_iii') && !unlocked['fishermans-instinct']) {
        unlocked['fishermans-instinct'] = Date.now();
      }
      if (unlocked['fleet-review'] && !unlocked['fleet-review-3']) {
        unlocked['fleet-review-3'] = unlocked['fleet-review'];
      }
      if (unlocked['all-weather'] && !unlocked['wave-change']) {
        unlocked['wave-change'] = unlocked['all-weather'];
      }
      if (unlocked['fishermans-instinct'] && !unlocked['school-scattered-3']) {
        unlocked['school-scattered-3'] = unlocked['fishermans-instinct'];
      }
      const seenAchievements = Array.isArray(stored.seenAchievements)
        ? uniqueStrings(stored.seenAchievements).filter(id => validIds.has(id) && unlocked[id])
        : Object.keys(unlocked);
      return {
        version: STATE_VERSION,
        unlocked,
        seenAchievements,
        voyages: finitePositive(stored.voyages),
        bestSpeedKn: preTierState ? 0 : finitePositive(stored.bestSpeedKn),
        distanceMeters: finitePositive(stored.distanceMeters),
        vesselDistanceMeters: positiveRecord(stored.vesselDistanceMeters),
        totalSeconds: finitePositive(stored.totalSeconds),
        stormSeconds: finitePositive(stored.stormSeconds),
        boats,
        cameras: uniqueNumbers(stored.cameras, 0, 3),
        cameraControls: uniqueStrings(stored.cameraControls)
          .filter(action => action === 'zoom' || action === 'orbit'),
        antWorldSeen: finitePositive(stored.antWorldSeen),
        bestCircleRadians: finitePositive(stored.bestCircleRadians),
        waveChanges: finitePositive(stored.waveChanges),
        qualityChanged: finitePositive(stored.qualityChanged),
        seas: uniqueNumbers(stored.seas, 1, 4),
        dolphinEscortTriggered: finitePositive(stored.dolphinEscortTriggered),
        whaleEncountered: finitePositive(stored.whaleEncountered),
        turtleEncountered: finitePositive(stored.turtleEncountered),
        mantaEncountered: finitePositive(stored.mantaEncountered),
        sharkEncountered: finitePositive(stored.sharkEncountered),
        fishSchoolsDispersed: finitePositive(stored.fishSchoolsDispersed),
        jumpCount: preTierState ? 0 : finitePositive(stored.jumpCount),
        bestJumpHeight: preTierState ? 0 : finitePositive(stored.bestJumpHeight),
        bestAirTime: preTierState ? 0 : finitePositive(stored.bestAirTime),
        // Older saves only knew the longest flight. Use it as a conservative
        // starting point so an existing air-time record is not discarded.
        totalAirTime: preTierState ? 0 : Math.max(
          finitePositive(stored.totalAirTime),
          finitePositive(stored.bestAirTime),
        ),
      };
    } catch {
      return this._emptyState();
    }
  }

  _save(force = false) {
    if (!this.dirty) return;
    const now = performance.now();
    if (!force && now - this.lastSave < SAVE_INTERVAL) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.dirty = false;
      this.lastSave = now;
    } catch {  }
  }

  _bindUI() {
    this.button?.addEventListener('click', event => {
      this.togglePanel(event.detail === 0);
      if (event.detail > 0) event.currentTarget.blur();
    });
    this.closeButton?.addEventListener('click', event => {
      this.setPanelOpen(false, event.detail === 0);
      if (event.detail > 0) event.currentTarget.blur();
    });
    [this.button, this.closeButton].forEach(control => {
      control?.addEventListener('keydown', event => {
        if (event.code === 'Space') event.preventDefault();
      });
    });
    addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.panel?.getAttribute('aria-hidden') === 'false') {
        this.setPanelOpen(false, true);
      }
    });
  }

  togglePanel(restoreFocus = false) {
    const shouldOpen = this.panel?.getAttribute('aria-hidden') !== 'false';
    this.setPanelOpen(shouldOpen, restoreFocus);
  }

  setPanelOpen(open, restoreFocus = false) {
    if (!this.panel || !this.button) return;
    this.panel.setAttribute('aria-hidden', String(!open));
    this.panel.inert = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      this._markUnlockedSeen();
      this.render();
      if (restoreFocus) this.closeButton?.focus({ preventScroll: true });
    } else if (restoreFocus) {
      this.button.focus({ preventScroll: true });
    }
  }

  _markUnlockedSeen() {
    const seen = new Set(this.state.seenAchievements);
    let changed = false;
    Object.keys(this.state.unlocked).forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      changed = true;
    });
    if (!changed) return;
    this.state.seenAchievements = [...seen];
    this.dirty = true;
    this._save(true);
  }

  startVoyage() {
    this.active = true;
    this.state.voyages = Math.max(1, this.state.voyages);
    this.dirty = true;
    this._evaluatePending();
  }

  recordBoat(id) {
    if (!id || this.state.boats.includes(id)) return;
    this.state.boats.push(id);
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  recordCamera(mode) {
    if (!Number.isInteger(mode) || this.state.cameras.includes(mode)) return;
    this.state.cameras.push(mode);
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  recordCameraControl(action) {
    if ((action !== 'zoom' && action !== 'orbit') || this.state.cameraControls.includes(action)) return;
    this.state.cameraControls.push(action);
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  recordAntWorld() {
    if (this.state.antWorldSeen) return;
    this.state.antWorldSeen = 1;
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  recordSea(level) {
    if (!Number.isInteger(level) || this.state.seas.includes(level)) return;
    this.state.seas.push(level);
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  recordWaveChange() {
    if (this.state.waveChanges) return;
    this.state.waveChanges = 1;
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  recordQualityChange() {
    if (this.state.qualityChanged) return;
    this.state.qualityChanged = 1;
    this.dirty = true;
    this._evaluatePending();
    this.render();
  }

  resetFlight() {
    this.flight = {
      airborne: false,
      airTime: 0,
      creditedAirTime: 0,
      maxHeight: 0,
      launchSpeedKn: 0,
    };
  }

  resetCircle() {
    this.circle = { active: false, steerDirection: 0, yawDirection: 0, lastHeading: 0, angle: 0 };
  }

  update(dt, boat, waveField, fauna = null) {
    if (!this.active || dt <= 0 || !boat || !waveField) return;
    this.state.totalSeconds += dt;
    this.dirty = true;
    const speedKn = finitePositive(boat.speedKn);
    if (speedKn > this.state.bestSpeedKn) {
      this.state.bestSpeedKn = speedKn;
      this.dirty = true;
    }

    if (speedKn > 0.35) {
      const distance = speedKn / 1.94384 * dt;
      this.state.distanceMeters += distance;
      const vesselId = boat.spec?.id;
      if (vesselId) {
        this.state.vesselDistanceMeters[vesselId] = finitePositive(this.state.vesselDistanceMeters[vesselId]) + distance;
      }
      this.dirty = true;
    }

    if (waveField.preset === 4 && speedKn >= 3) {
      this.state.stormSeconds += dt;
      this.dirty = true;
    }

    this._updateFlight(dt, boat, waveField);
    this._updateCircle(boat);
    this._updateWildlife(dt, boat, fauna);
    this._evaluatePending();

    const now = performance.now();
    if (this.panel?.getAttribute('aria-hidden') === 'false' && now - this.lastRender >= 1000) {
      this.render();
    }
    this._save();
  }

  _updateFlight(dt, boat, waveField) {
    const wet = finitePositive(boat.wet);
    const waterY = waveField.heightAt(boat.pos.x, boat.pos.z);
    const rideHeight = finitePositive(boat.spec?.rideHeight);
    const clearance = Math.max(boat.pos.y - waterY - rideHeight, 0);

    if (!this.flight.airborne) {
      if (wet <= 0.015 && boat.speedKn >= MIN_JUMP_SPEED_KN) {
        this.flight.airborne = true;
        this.flight.airTime = 0;
        this.flight.maxHeight = clearance;
        this.flight.launchSpeedKn = boat.speedKn;
      }
      return;
    }

    this.flight.airTime += dt;
    this.flight.maxHeight = Math.max(this.flight.maxHeight, clearance);
    // Credit every part of a genuine flight once it passes the short anti-jitter
    // threshold. This keeps cumulative air time independent of jump height and
    // does not require the boat to land before an achievement can unlock.
    if (this.flight.airTime >= MIN_AIR_TIME) {
      const uncreditedAirTime = this.flight.airTime - this.flight.creditedAirTime;
      this.state.totalAirTime += Math.max(uncreditedAirTime, 0);
      this.flight.creditedAirTime = this.flight.airTime;
      this.state.bestAirTime = Math.max(this.state.bestAirTime, this.flight.airTime);
      this.dirty = true;
    }
    if (wet < 0.08) return;

    const qualifies = this.flight.launchSpeedKn >= MIN_JUMP_SPEED_KN
      && this.flight.airTime >= MIN_AIR_TIME
      && this.flight.maxHeight >= MIN_JUMP_HEIGHT;
    if (qualifies) {
      this.state.jumpCount += 1;
      this.state.bestJumpHeight = Math.max(this.state.bestJumpHeight, this.flight.maxHeight);
      this.dirty = true;
      this.render();
    }
    this.resetFlight();
  }

  _updateCircle(boat) {
    const steerDirection = Math.sign(boat.steer);
    const qualifies = boat.throttle >= CIRCLE_MIN_THROTTLE
      && Math.abs(boat.steer) >= CIRCLE_MIN_STEER
      && finitePositive(boat.speedKn) >= CIRCLE_MIN_SPEED_KN
      && (finitePositive(boat.wet) > 0.02 || finitePositive(boat.propWet) > 0.25);
    if (!qualifies) {
      if (this.circle.active) this.resetCircle();
      return;
    }

    const heading = headingFromQuaternion(boat.quat);
    if (!this.circle.active || this.circle.steerDirection !== steerDirection) {
      this.circle = {
        active: true,
        steerDirection,
        yawDirection: 0,
        lastHeading: heading,
        angle: 0,
      };
      return;
    }

    const delta = Math.atan2(
      Math.sin(heading - this.circle.lastHeading),
      Math.cos(heading - this.circle.lastHeading),
    );
    this.circle.lastHeading = heading;
    if (Math.abs(delta) > 0.2) {
      this.resetCircle();
      return;
    }
    if (!this.circle.yawDirection && Math.abs(delta) > 0.0005) {
      this.circle.yawDirection = Math.sign(delta);
    }
    if (!this.circle.yawDirection) return;

    this.circle.angle = Math.max(
      0,
      this.circle.angle + delta * this.circle.yawDirection,
    );
    if (this.circle.angle > this.state.bestCircleRadians) {
      this.state.bestCircleRadians = Math.min(this.circle.angle, FULL_CIRCLE);
      this.dirty = true;
    }
  }

  _updateWildlife(dt, boat, fauna) {
    if (!fauna) return;
    if (!this.state.dolphinEscortTriggered) {
      const pod = fauna.dolphins?.pod;
      if (pod && !pod.leaving) {
        this.state.dolphinEscortTriggered = 1;
        this.dirty = true;
      }
    }

    if (!this.state.whaleEncountered) {
      const whale = fauna.whales?.whale;
      if (whale) {
        const dx = whale.pos.x - boat.pos.x;
        const dz = whale.pos.z - boat.pos.z;
        if (dx * dx + dz * dz <= WHALE_ENCOUNTER_DISTANCE ** 2) {
          this.state.whaleEncountered = 1;
          this.dirty = true;
        }
      }
    }

    if (!this.state.turtleEncountered) {
      const maxD2 = TURTLE_ENCOUNTER_DISTANCE * TURTLE_ENCOUNTER_DISTANCE;
      const nearby = fauna.turtles?.turtles?.some(turtle => {
        const dx = turtle.pos.x - boat.pos.x;
        const dz = turtle.pos.z - boat.pos.z;
        return dx * dx + dz * dz <= maxD2;
      });
      if (nearby) {
        this.state.turtleEncountered = 1;
        this.dirty = true;
      }
    }

    if (!this.state.mantaEncountered) {
      const maxD2 = MANTA_ENCOUNTER_DISTANCE * MANTA_ENCOUNTER_DISTANCE;
      const nearby = fauna.mantas?.mantas?.some(manta => {
        const dx = manta.pos.x - boat.pos.x;
        const dz = manta.pos.z - boat.pos.z;
        return dx * dx + dz * dz <= maxD2;
      });
      if (nearby) {
        this.state.mantaEncountered = 1;
        this.dirty = true;
      }
    }

    if (!this.state.sharkEncountered) {
      const maxD2 = SHARK_ENCOUNTER_DISTANCE * SHARK_ENCOUNTER_DISTANCE;
      const nearby = fauna.fish?.solos?.some(fish => {
        if (fish.key !== 'shark') return false;
        const dx = fish.pos.x - boat.pos.x;
        const dz = fish.pos.z - boat.pos.z;
        return dx * dx + dz * dz <= maxD2;
      });
      if (nearby) {
        this.state.sharkEncountered = 1;
        this.dirty = true;
      }
    }

    const dispersed = finitePositive(fauna.fish?.dispersedSchools);
    if (dispersed > this.lastFishDispersedObserved) {
      this.state.fishSchoolsDispersed += dispersed - this.lastFishDispersedObserved;
      this.lastFishDispersedObserved = dispersed;
      this.dirty = true;
    }
  }

  _metricValue(definition) {
    if (definition.metric === 'vesselDistanceMeters') {
      return finitePositive(this.state.vesselDistanceMeters[definition.vesselId]);
    }
    const value = this.state[definition.metric];
    return Array.isArray(value) ? value.length : finitePositive(value);
  }

  _evaluatePending() {
    if (this.active && performance.now() < this.nextUnlockAt) return;
    const definition = ACHIEVEMENTS.find(item => (
      !this.state.unlocked[item.id] && this._metricValue(item) >= item.target
    ));
    if (definition) this.unlock(definition.id, this.active);
  }

  unlock(id, notify = this.active) {
    const definition = ACHIEVEMENTS.find(item => item.id === id);
    if (!definition || this.state.unlocked[id]) return false;
    this.state.unlocked[id] = Date.now();
    this.dirty = true;
    if (notify) this.nextUnlockAt = performance.now() + UNLOCK_SPACING;
    this._save(true);
    this.render();
    if (notify) this._enqueueToast(definition);
    if (definition.reward) {
      dispatchEvent(new CustomEvent('ocean-boat:reward-unlocked', {
        detail: { reward: definition.reward, achievement: definition.id },
      }));
    }
    return true;
  }

  isRewardUnlocked(reward) {
    return ACHIEVEMENTS.some(item => item.reward === reward && this.state.unlocked[item.id]);
  }

  render() {
    this.lastRender = performance.now();
    const listScrollTop = this.list?.scrollTop || 0;
    const unlockedIds = Object.keys(this.state.unlocked);
    const milestoneCount = unlockedIds.length;
    const discoveredCount = ACHIEVEMENT_ENTRIES.filter(entry => (
      entry.definitions.some(definition => this.state.unlocked[definition.id])
    )).length;
    const seen = new Set(this.state.seenAchievements);
    const unseenCount = unlockedIds.filter(id => !seen.has(id)).length;
    if (this.count) this.count.textContent = `${discoveredCount}/${ACHIEVEMENT_ENTRIES.length}`;
    if (this.button) {
      this.button.classList.toggle('has-unseen', unseenCount > 0);
      this.button.setAttribute('aria-label', `Captain's log, ${discoveredCount} of ${ACHIEVEMENT_ENTRIES.length} achievements discovered${unseenCount ? `, ${unseenCount} new milestones` : ''}`);
    }
    if (this.summary) this.summary.textContent = `${discoveredCount} of ${ACHIEVEMENT_ENTRIES.length} achievements · ${milestoneCount} milestones`;
    if (this.distanceRecord) this.distanceRecord.textContent = formatDistance(this.state.distanceMeters);
    if (this.timeRecord) this.timeRecord.textContent = formatDuration(this.state.totalSeconds);
    if (this.jumpRecord) this.jumpRecord.textContent = `${this.state.bestJumpHeight.toFixed(1)} m`;
    if (this.airRecord) this.airRecord.textContent = formatDuration(this.state.totalAirTime);
    if (!this.list) return;

    const fragment = document.createDocumentFragment();
    ACHIEVEMENT_ENTRIES.forEach((entry, index) => {
      const { definitions } = entry;
      const baseDefinition = definitions[0];
      const isSeries = definitions.length > 1;
      let currentDefinition = null;
      definitions.forEach(definition => {
        if (this.state.unlocked[definition.id]) currentDefinition = definition;
      });
      const nextDefinition = isSeries
        ? definitions.find(definition => !currentDefinition || definition.tier > currentDefinition.tier)
        : null;
      const unlockedAt = currentDefinition ? this.state.unlocked[currentDefinition.id] : 0;
      let progress;
      if (isSeries && nextDefinition) {
        const previousTarget = currentDefinition?.target || 0;
        const interval = Math.max(nextDefinition.target - previousTarget, Number.EPSILON);
        progress = (this._metricValue(nextDefinition) - previousTarget) / interval;
      } else if (unlockedAt) {
        progress = 1;
      } else {
        progress = this._metricValue(baseDefinition) / baseDefinition.target;
      }
      progress = Math.min(Math.max(progress, 0), 1);
      const percent = progress * 100;
      const percentLabel = percent > 0 && percent < 10
        ? percent.toFixed(1)
        : String(Math.floor(percent));
      const item = document.createElement('li');
      const isReward = definitions.some(definition => definition.reward);
      item.className = `achievement-entry ${unlockedAt ? 'unlocked' : 'secret'}${isReward ? ' reward' : ''}`;
      item.style.setProperty('--achievement-progress', String(progress));

      const mark = document.createElement('span');
      mark.className = 'achievement-mark';
      mark.textContent = unlockedAt
        ? (currentDefinition.tier ? roman(currentDefinition.tier) : String(index + 1).padStart(2, '0'))
        : '??';
      mark.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('span');
      copy.className = 'achievement-copy';
      const heading = document.createElement('span');
      heading.className = 'achievement-heading';
      const title = document.createElement('strong');
      title.textContent = baseDefinition.title;
      heading.append(title);
      if (unlockedAt && currentDefinition.tier) {
        const levelBadge = document.createElement('b');
        levelBadge.className = 'achievement-level';
        const tierName = currentDefinition.title === baseDefinition.title
          ? ''
          : ` · ${currentDefinition.title}`;
        levelBadge.textContent = `Level ${roman(currentDefinition.tier)}${tierName}`;
        heading.append(levelBadge);
      }
      const description = document.createElement('span');
      description.textContent = unlockedAt
        ? currentDefinition.description
        : 'A hidden entry is waiting to be found.';
      const progressText = document.createElement('small');
      if (isSeries && currentDefinition) {
        progressText.textContent = nextDefinition
          ? `Level ${roman(currentDefinition.tier)} · Next level ${percentLabel}%`
          : `Level ${roman(currentDefinition.tier)} · Completed ${this.dateFormatter.format(unlockedAt)}`;
      } else {
        progressText.textContent = unlockedAt
          ? `Unlocked ${this.dateFormatter.format(unlockedAt)}`
          : `Progress ${percentLabel}% · Condition hidden`;
      }
      const progressBar = document.createElement('i');
      progressBar.className = 'achievement-progress';
      progressBar.setAttribute('role', 'progressbar');
      progressBar.setAttribute('aria-label', `${baseDefinition.title} progress`);
      progressBar.setAttribute('aria-valuemin', '0');
      progressBar.setAttribute('aria-valuemax', '100');
      progressBar.setAttribute('aria-valuenow', percent.toFixed(1));
      copy.append(heading, description, progressText, progressBar);
      item.append(mark, copy);
      fragment.append(item);
    });
    this.list.replaceChildren(fragment);
    // Replacing every entry can make browser scroll anchoring nudge an open
    // journal a few pixels on each live progress refresh.
    this.list.scrollTop = listScrollTop;
  }

  _enqueueToast(definition) {
    this.toastQueue.push(definition);
    if (!this.toastActive) this._showNextToast();
  }

  _showNextToast() {
    const definition = this.toastQueue.shift();
    if (!definition || !this.toastRegion) {
      this.toastActive = false;
      return;
    }
    this.toastActive = true;
    const entry = ACHIEVEMENT_ENTRIES.find(candidate => candidate.definitions.includes(definition));
    const index = ACHIEVEMENT_ENTRIES.indexOf(entry) + 1;
    const kicker = definition.reward
      ? definition.series
        ? `${definition.series} · Level ${roman(definition.tier)} · Reward unlocked`
        : 'Special reward'
      : definition.series ? `${definition.series} · Level ${roman(definition.tier)}` : 'Log entry completed';
    const toast = document.createElement('div');
    toast.className = `achievement-toast${definition.reward ? ' reward' : ''}`;
    toast.innerHTML = `<span class="achievement-toast-mark" aria-hidden="true"></span><span><small></small><strong></strong><em></em></span>`;
    toast.querySelector('.achievement-toast-mark').textContent = definition.tier
      ? roman(definition.tier) : String(index).padStart(2, '0');
    toast.querySelector('small').textContent = kicker;
    toast.querySelector('strong').textContent = definition.title;
    toast.querySelector('em').textContent = definition.description;
    this.toastRegion.replaceChildren(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));

    const visibleFor = this.reducedMotion ? 2200 : 4000;
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        toast.remove();
        this.toastActive = false;
        this._showNextToast();
      }, this.reducedMotion ? 20 : 350);
    }, visibleFor);
  }
}
