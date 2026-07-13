import { getVesselSpec } from '../simulation/vessels.js';
import {
  cancelTimeout,
  fetchResource,
  scheduleTimeout,
} from '../runtime/browser-platform.js';

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
const MOBILE_UNSAFE_STARTUP = /motoryacht|ss_minnow|frickies_yacht/i;

export class VesselController {
  constructor({
    boat,
    achievements,
    cameraController,
    audio,
    elements,
    body,
    isTouch = false,
    storage = globalThis.localStorage,
    fetcher = fetchResource,
    getSpec = getVesselSpec,
    isAppStarted = () => false,
    onInitialReady = () => {},
    revealDock = () => {},
    setTimer = scheduleTimeout,
    clearTimer = cancelTimeout,
  }) {
    this.boat = boat;
    this.achievements = achievements;
    this.cameraController = cameraController;
    this.audio = audio;
    this.elements = elements;
    this.body = body;
    this.isTouch = isTouch;
    this.storage = storage;
    this.fetcher = fetcher;
    this.getSpec = getSpec;
    this.isAppStarted = isAppStarted;
    this.onInitialReady = onInitialReady;
    this.revealDock = revealDock;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.allNames = [];
    this.names = [];
    this.index = 0;
    this.pendingUnlockName = null;
    this.alertShowTimer = null;
    this.alertHideTimer = null;
    this.hornPending = false;
    this.swipe = null;
    this.bound = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    const {
      selector, previousButton, nextButton, unlockAlert, unlockHint,
    } = this.elements;
    if (unlockHint) unlockHint.textContent = this.isTouch ? 'Tap to take the helm' : 'Click to take the helm';
    unlockAlert?.addEventListener('click', () => this.takeHelmOfUnlocked());
    previousButton.addEventListener('click', event => {
      this.previous();
      this._blurAfterPointerClick(event);
    });
    nextButton.addEventListener('click', event => {
      this.next();
      this._blurAfterPointerClick(event);
    });
    selector.addEventListener('pointerdown', event => this._beginSwipe(event));
    selector.addEventListener('pointerup', event => this._endSwipe(event));
    selector.addEventListener('pointercancel', () => { this.swipe = null; });
    selector.addEventListener('lostpointercapture', () => { this.swipe = null; });
    this.syncSelectorAccess();
  }

  selectionUnlocked() {
    return this.names.length >= 2;
  }

  syncSelectorAccess() {
    const unlocked = this.selectionUnlocked();
    const { selector } = this.elements;
    selector.inert = !unlocked;
    selector.setAttribute('aria-hidden', String(!unlocked));
    if (!unlocked) this.body.classList.remove('dock-revealed');
  }

  availableNames() {
    return this.allNames.filter(name => {
      const gate = REWARD_VESSELS.find(entry => entry.file.test(name));
      return !gate || this.achievements.isRewardUnlocked(gate.reward);
    });
  }

  async loadCatalog() {
    let list;
    try {
      const response = await this.fetcher('./assets/boats/index.json');
      list = await response.json();
    } catch {
      await this._loadFallback();
      return;
    }
    this.allNames = list.map(entry => entry.name).filter(name => /\.glb$/i.test(name)).sort();
    this.names = this.availableNames();
    const saved = this._storedBoatName();
    const unsafeMobileStartup = this.isTouch && MOBILE_UNSAFE_STARTUP.test(saved || '');
    const savedIndex = this.names.indexOf(saved);
    const safeDefaultIndex = this.names.findIndex(name => /zefiro/i.test(name));
    const freshDefaultIndex = this.names.findIndex(name => /smolbot/i.test(name));
    const freshFallbackIndex = freshDefaultIndex >= 0
      ? freshDefaultIndex
      : Math.max(safeDefaultIndex, 0);
    const initialIndex = !saved
      ? freshFallbackIndex
      : unsafeMobileStartup
        ? Math.max(safeDefaultIndex, freshFallbackIndex)
        : savedIndex >= 0 ? savedIndex : freshFallbackIndex;
    if (this.names.length) {
      await this.loadByIndex(initialIndex, { initial: true });
    } else {
      await this._loadFallback();
    }
  }

  async loadByIndex(index, { initial = false, direction = 0 } = {}) {
    if (!this.names.length) return;
    if (!initial) this.dismissUnlockAlert();
    const navigationState = initial ? null : {
      position: this.boat.pos.clone(),
      orientation: this.boat.quat.clone(),
      velocity: this.boat.vel.clone(),
      angularVelocity: this.boat.angVelB.clone(),
      rideHeight: this.boat.spec?.rideHeight ?? 0,
    };
    this.index = ((index % this.names.length) + this.names.length) % this.names.length;
    const name = this.names[this.index];
    const modelMetadata = name.match(/_(\d+(?:\.\d+)?)(r)?\.glb$/i);
    const spec = this.getSpec(name);
    this.boat.setSpec(spec);
    this.boat.reset();
    if (navigationState) this._restoreNavigation(navigationState, spec);
    this.achievements.resetFlight();
    this.achievements.resetCircle();

    const { loader, selector } = this.elements;
    if (!initial) loader.classList.add('visible');
    selector.setAttribute('aria-busy', 'true');
    this._updateSelector(spec, direction);
    try {
      await this.boat.loadModel(
        './assets/boats/' + encodeURIComponent(name),
        modelMetadata ? parseFloat(modelMetadata[1]) : spec.length,
        !!(modelMetadata && modelMetadata[2]) || !!spec.reversed,
      );
      this.achievements.recordBoat(spec.id || name);
      void this.playHornOnce(spec);
    } finally {
      this._rememberBoat(name);
      if (initial) this.onInitialReady();
      else loader.classList.remove('visible');
      selector.setAttribute('aria-busy', 'false');
    }
    this.cameraController.setVessel(spec);
  }

  change(direction) {
    if (this.names.length > 1 && !this.elements.loader.classList.contains('visible')) {
      return this.loadByIndex(this.index + direction, { direction });
    }
    return undefined;
  }

  next() {
    return this.change(1);
  }

  previous() {
    return this.change(-1);
  }

  handleRewardUnlocked(reward) {
    if (!REWARD_VESSELS.some(entry => entry.reward === reward)) return false;
    const previousNames = new Set(this.names);
    const selectorWasUnlocked = this.selectionUnlocked();
    this._refreshAvailableNames();
    if (this.isAppStarted() && this.selectionUnlocked()) this.revealDock(900);
    const unlockedName = this.names.find(name => !previousNames.has(name));
    if (unlockedName) this.announceNewVessel(unlockedName, selectorWasUnlocked ? 250 : 1650);
    return true;
  }

  announceNewVessel(name, delay = 0) {
    this.dismissUnlockAlert();
    this.alertShowTimer = this.setTimer(() => {
      this.alertShowTimer = null;
      const { unlockAlert, unlockName, selector } = this.elements;
      if (!unlockAlert || !unlockName) return;
      this.pendingUnlockName = name;
      unlockName.textContent = this.getSpec(name).label;
      unlockAlert.setAttribute('aria-hidden', 'false');
      unlockAlert.classList.add('visible');
      selector.classList.add('new-vessel');
      this.alertHideTimer = this.setTimer(() => this.dismissUnlockAlert(), 5200);
    }, delay);
  }

  dismissUnlockAlert() {
    this.clearTimer(this.alertShowTimer);
    this.clearTimer(this.alertHideTimer);
    this.alertShowTimer = null;
    this.alertHideTimer = null;
    this.elements.unlockAlert?.classList.remove('visible');
    this.elements.unlockAlert?.setAttribute('aria-hidden', 'true');
    this.elements.selector.classList.remove('new-vessel');
    this.pendingUnlockName = null;
  }

  takeHelmOfUnlocked() {
    const name = this.pendingUnlockName;
    if (!name) return;
    const index = this.names.indexOf(name);
    if (index < 0 || index === this.index) {
      this.dismissUnlockAlert();
      return;
    }
    void this.loadByIndex(index);
  }

  playActiveHornOnce() {
    return this.playHornOnce(this.boat.spec);
  }

  async playHornOnce(spec) {
    if (!this.isAppStarted() || spec?.id !== 'frickies_yacht'
      || this.hornPending || this._hornPlayed()) return;
    this.hornPending = true;
    try {
      if (await this.audio.megayachtHorn()) this._rememberHorn();
    } finally {
      this.hornPending = false;
    }
  }

  _refreshAvailableNames() {
    const currentName = this.names[this.index];
    this.names = this.availableNames();
    const currentIndex = currentName ? this.names.indexOf(currentName) : -1;
    this.index = currentIndex >= 0 ? currentIndex : 0;
    if (this.names.length && currentName) this._updateSelector(this.boat.spec);
    else this.syncSelectorAccess();
  }

  _updateSelector(spec, direction = 0) {
    const { name, position, previousButton, nextButton, selector } = this.elements;
    name.textContent = spec.label;
    position.textContent = `${String(this.index + 1).padStart(2, '0')} / ${String(this.names.length).padStart(2, '0')}`;
    previousButton.disabled = this.names.length < 2;
    nextButton.disabled = this.names.length < 2;
    selector.classList.toggle('single-vessel', this.names.length < 2);
    this.syncSelectorAccess();
    if (!direction) return;
    const animationClass = direction > 0 ? 'changing-next' : 'changing-prev';
    selector.classList.remove('changing-next', 'changing-prev');
    void selector.offsetWidth;
    selector.classList.add(animationClass);
  }

  _restoreNavigation(navigationState, spec) {
    this.boat.pos.copy(navigationState.position);
    this.boat.pos.y += (spec.rideHeight ?? 0) - navigationState.rideHeight;
    this.boat.quat.copy(navigationState.orientation);
    this.boat.vel.copy(navigationState.velocity);
    this.boat.angVelB.copy(navigationState.angularVelocity);
  }

  _beginSwipe(event) {
    if (event.button !== 0 || event.target.closest('.vessel-arrow')) return;
    this.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { this.elements.selector.setPointerCapture(event.pointerId); } catch {}
  }

  _endSwipe(event) {
    if (!this.swipe || this.swipe.id !== event.pointerId) return;
    const deltaX = event.clientX - this.swipe.x;
    const deltaY = event.clientY - this.swipe.y;
    this.swipe = null;
    if (Math.abs(deltaX) >= 46 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      this.audio.start();
      void this.change(deltaX < 0 ? 1 : -1);
    }
  }

  _blurAfterPointerClick(event) {
    if (event.detail > 0) event.currentTarget.blur();
  }

  async _loadFallback() {
    try {
      await this.boat.loadModel('./assets/boat.glb');
    } finally {
      this.onInitialReady();
    }
  }

  _storedBoatName() {
    try { return this.storage?.getItem(LAST_BOAT_KEY); } catch { return null; }
  }

  _rememberBoat(name) {
    try { this.storage?.setItem(LAST_BOAT_KEY, name); } catch { /* Optional persistence. */ }
  }

  _hornPlayed() {
    try { return this.storage?.getItem(MEGAYACHT_HORN_KEY) === '1'; } catch { return false; }
  }

  _rememberHorn() {
    try { this.storage?.setItem(MEGAYACHT_HORN_KEY, '1'); } catch { /* Optional persistence. */ }
  }
}
