const HELP_VISIBLE_DURATION = 20_000;
const DOCK_REVEAL_DELAY = 4_000;
const CONTROLS_REVEAL_DELAY = DOCK_REVEAL_DELAY + 3_000;
const VOYAGE_INTRO_DELAY = 1_300;
const VOYAGE_INTRO_HOLD = 6_000;
const VOYAGE_INTRO_FADE = 1_400;
const VOYAGE_INTRO_DRIVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

export class ExperienceController {
  constructor({
    achievements,
    performanceManager,
    audio,
    vessels,
    firstVoyageGuide,
    isTouch = false,
    elements = {},
    body = globalThis.document?.body,
    eventTarget = globalThis,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
  }) {
    this.achievements = achievements;
    this.performanceManager = performanceManager;
    this.audio = audio;
    this.vessels = vessels;
    this.firstVoyageGuide = firstVoyageGuide;
    this.isTouch = isTouch;
    this.loader = elements.loader ?? null;
    this.welcome = elements.welcome ?? null;
    this.startButton = elements.startButton ?? null;
    this.helpHint = elements.helpHint ?? null;
    this.waveControls = elements.waveControls ?? null;
    this.voyageIntro = elements.voyageIntro ?? null;
    this.body = body;
    this.eventTarget = eventTarget;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.started = false;
    this.boatReady = false;
    this.skyReady = false;
    this.renderedFrames = 0;
    this.introPlayed = false;
    this.bound = false;
    this.helpTimer = null;
    this.focusTimer = null;
    this.revealTimers = new Set();
    this.introTimers = new Set();

    this._launch = () => this.launch();
    this._rewardUnlocked = event => this.handleRewardUnlocked(event.detail?.reward);
    this._introKeyDismiss = event => {
      if (VOYAGE_INTRO_DRIVE_KEYS.has(event.code)) this.dismissIntro();
    };
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    this.startButton?.addEventListener('click', this._launch);
    this.eventTarget.addEventListener('ocean-boat:reward-unlocked', this._rewardUnlocked);
  }

  destroy() {
    if (!this.bound) return;
    this.bound = false;
    this.startButton?.removeEventListener('click', this._launch);
    this.eventTarget.removeEventListener('ocean-boat:reward-unlocked', this._rewardUnlocked);
    this.eventTarget.removeEventListener('keydown', this._introKeyDismiss, true);
    this._clearTimerSet(this.revealTimers);
    this._clearTimerSet(this.introTimers);
    this.clearTimer(this.helpTimer);
    this.clearTimer(this.focusTimer);
    this.helpTimer = null;
    this.focusTimer = null;
  }

  seaControlsUnlocked() {
    return this.achievements.isRewardUnlocked('azure');
  }

  syncSeaControlAccess() {
    const unlocked = this.seaControlsUnlocked();
    if (this.waveControls) {
      this.waveControls.inert = !unlocked;
      this.waveControls.setAttribute('aria-hidden', String(!unlocked));
    }
    if (!unlocked) this.body.classList.remove('controls-revealed');
  }

  markBoatReady() {
    this.boatReady = true;
    this._finishInitialLoadingWhenReady();
  }

  markSkyReady() {
    this.skyReady = true;
    this._finishInitialLoadingWhenReady();
  }

  frameRendered() {
    this.renderedFrames++;
    this._finishInitialLoadingWhenReady();
  }

  revealAfter(className, delay) {
    this._schedule(this.revealTimers, () => this.body.classList.add(className), delay);
  }

  handleRewardUnlocked(reward) {
    this.vessels.handleRewardUnlocked(reward);
    if (reward === 'azure') {
      this.syncSeaControlAccess();
      if (this.started) this.revealAfter('controls-revealed', 900);
    }
    if (this.helpHint && !this.isTouch
      && !this.helpHint.classList.contains('help-dismissed')) this.buildHelpHint();
  }

  buildHelpHint() {
    if (!this.helpHint) return;
    const segments = [
      'W / ↑ throttle',
      'S / ↓ reverse',
      'A D / ← → rudder',
      'Space stop',
      'C camera / cinema',
    ];
    if (this.vessels.selectionUnlocked()) segments.push('B boat');
    segments.push('Mouse orbit', 'Wheel zoom');
    if (this.seaControlsUnlocked()) segments.push('1–4 sea');
    segments.push('R reset', 'L log');
    this.helpHint.textContent = segments.join(' · ');
  }

  launch() {
    if (this.started) return false;
    this.started = true;
    this.performanceManager.setActive(true);
    this.startButton?.setAttribute('aria-busy', 'true');
    this.body.classList.remove('awaiting-start');
    this.body.classList.add('started');
    this.achievements.startVoyage();
    this.welcome?.setAttribute('aria-hidden', 'true');
    if (this.welcome) this.welcome.inert = true;
    try { this.audio.start(); } catch { }
    void this.vessels.playActiveHornOnce();
    this._scheduleHelpDismiss();
    this._scheduleControlReveals();
    this._playIntro();
    this.firstVoyageGuide.start();
    return true;
  }

  dismissIntro() {
    if (!this.voyageIntro?.classList.contains('playing')) return;
    this._clearTimerSet(this.introTimers);
    this.eventTarget.removeEventListener('keydown', this._introKeyDismiss, true);
    this.voyageIntro.classList.remove('playing');
    this.voyageIntro.classList.add('leaving');
    this._schedule(this.introTimers, () => {
      this.voyageIntro.classList.remove('leaving');
      this.voyageIntro.hidden = true;
    }, VOYAGE_INTRO_FADE);
  }

  _finishInitialLoadingWhenReady() {
    if (!this.loader || this.loader.classList.contains('done')) return;
    if (!this.boatReady || !this.skyReady || this.renderedFrames < 3) return;
    this.loader.classList.add('done');
    this.welcome?.classList.add('ready');
    this.clearTimer(this.focusTimer);
    this.focusTimer = this.setTimer(() => {
      this.focusTimer = null;
      if (!this.started) this.startButton?.focus({ preventScroll: true });
    }, 620);
  }

  _scheduleHelpDismiss() {
    if (this.isTouch || !this.helpHint) return;
    this.buildHelpHint();
    this.clearTimer(this.helpTimer);
    this.helpTimer = this.setTimer(() => {
      this.helpTimer = null;
      this.helpHint.classList.add('help-dismissed');
      this.helpHint.setAttribute('aria-hidden', 'true');
    }, HELP_VISIBLE_DURATION);
  }

  _scheduleControlReveals() {
    this._clearTimerSet(this.revealTimers);
    if (this.vessels.selectionUnlocked()) {
      this.revealAfter('dock-revealed', DOCK_REVEAL_DELAY);
    }
    if (this.seaControlsUnlocked()) {
      this.revealAfter('controls-revealed', CONTROLS_REVEAL_DELAY);
    }
  }

  _playIntro() {
    if (this.introPlayed || !this.voyageIntro || this.vessels.selectionUnlocked()) return;
    this.introPlayed = true;
    this._schedule(this.introTimers, () => {
      this.voyageIntro.hidden = false;
      void this.voyageIntro.offsetWidth;
      this.voyageIntro.classList.add('playing');
      this.eventTarget.addEventListener('keydown', this._introKeyDismiss, true);
      this._schedule(this.introTimers, () => this.dismissIntro(), VOYAGE_INTRO_HOLD);
    }, VOYAGE_INTRO_DELAY);
  }

  _schedule(timerSet, callback, delay) {
    let timer;
    timer = this.setTimer(() => {
      timerSet.delete(timer);
      callback();
    }, delay);
    timerSet.add(timer);
    return timer;
  }

  _clearTimerSet(timerSet) {
    for (const timer of timerSet) this.clearTimer(timer);
    timerSet.clear();
  }
}
