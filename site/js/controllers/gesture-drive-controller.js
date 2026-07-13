import { cancelTimeout, scheduleTimeout } from '../runtime/browser-platform.js';

const DRIVE_RADIUS = 76;
const DRIVE_DEADZONE = 0.09;
const TUTORIAL_DISMISS_DISTANCE = 14;
const DRIVE_HINT_IDLE_DELAY = 20_000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class GestureDriveController {
  constructor({
    element,
    tutorialElement = null,
    vectorElement = element?.querySelector('.drive-vector') ?? null,
    audio,
    onEngage = () => {},
    navigator = globalThis.navigator,
    eventTarget = globalThis,
    setTimer = scheduleTimeout,
    clearTimer = cancelTimeout,
    radius = DRIVE_RADIUS,
    deadzone = DRIVE_DEADZONE,
    tutorialDismissDistance = TUTORIAL_DISMISS_DISTANCE,
    idleDelay = DRIVE_HINT_IDLE_DELAY,
  }) {
    this.element = element;
    this.tutorialElement = tutorialElement;
    this.vectorElement = vectorElement;
    this.audio = audio;
    this.onEngage = onEngage;
    this.navigator = navigator;
    this.eventTarget = eventTarget;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.radius = radius;
    this.deadzone = deadzone;
    this.tutorialDismissDistance = tutorialDismissDistance;
    this.idleDelay = idleDelay;

    this.state = {
      active: false,
      id: null,
      originX: 0,
      originY: 0,
      throttle: 0,
      steer: 0,
    };
    this.idleTimer = null;
    this.hasBeenUsed = false;
    this.tutorialAvailable = true;
    this.bound = false;

    this._pointerDown = event => this._handlePointerDown(event);
    this._pointerMove = event => this._handlePointerMove(event);
    this._release = event => this._handleRelease(event);
    this._touchEnd = event => this._handleTouchEnd(event);
    this._touchCancel = () => {
      if (this.state.active) this.reset();
    };
    this._pageHide = () => this.reset();
  }

  bind() {
    if (!this.element || this.bound) return;
    this.bound = true;
    this.element.addEventListener('pointerdown', this._pointerDown);
    this.element.addEventListener('pointermove', this._pointerMove);
    this.element.addEventListener('pointerup', this._release);
    this.element.addEventListener('pointercancel', this._release);
    this.element.addEventListener('lostpointercapture', this._release);
    this.eventTarget.addEventListener('pointerup', this._release, true);
    this.eventTarget.addEventListener('pointercancel', this._release, true);
    this.eventTarget.addEventListener('touchend', this._touchEnd, {
      passive: true,
      capture: true,
    });
    this.eventTarget.addEventListener('touchcancel', this._touchCancel, {
      passive: true,
      capture: true,
    });
    this.eventTarget.addEventListener('pagehide', this._pageHide);
  }

  destroy() {
    if (!this.bound) return;
    this.bound = false;
    this.element.removeEventListener('pointerdown', this._pointerDown);
    this.element.removeEventListener('pointermove', this._pointerMove);
    this.element.removeEventListener('pointerup', this._release);
    this.element.removeEventListener('pointercancel', this._release);
    this.element.removeEventListener('lostpointercapture', this._release);
    this.eventTarget.removeEventListener('pointerup', this._release, true);
    this.eventTarget.removeEventListener('pointercancel', this._release, true);
    this.eventTarget.removeEventListener('touchend', this._touchEnd, true);
    this.eventTarget.removeEventListener('touchcancel', this._touchCancel, true);
    this.eventTarget.removeEventListener('pagehide', this._pageHide);
    this.clearTimer(this.idleTimer);
    this.idleTimer = null;
    this.reset({ scheduleHint: false });
  }

  reset({ scheduleHint = true } = {}) {
    this.state.active = false;
    this.state.id = null;
    this.state.throttle = 0;
    this.state.steer = 0;
    this.element?.classList.remove('active');
    this.tutorialElement?.classList.remove('visible');
    this.element?.setAttribute('aria-valuetext', 'Neutral');
    if (scheduleHint) this._waitForHintIdle();
  }

  _axis(delta) {
    const raw = clamp(delta / this.radius, -1, 1);
    if (Math.abs(raw) <= this.deadzone) return 0;
    return Math.sign(raw) * (Math.abs(raw) - this.deadzone) / (1 - this.deadzone);
  }

  _waitForHintIdle() {
    if (!this.hasBeenUsed) return;
    this.clearTimer(this.idleTimer);
    this.element?.classList.add('awaiting-drive-idle');
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      this.tutorialAvailable = true;
      this.element?.classList.remove('awaiting-drive-idle');
    }, this.idleDelay);
  }

  _beginHintCooldown() {
    const showTutorial = this.tutorialAvailable;
    this.hasBeenUsed = true;
    this.tutorialAvailable = false;
    this.clearTimer(this.idleTimer);
    this.idleTimer = null;
    this.element?.classList.add('awaiting-drive-idle');
    return showTutorial;
  }

  _updateVector(clientX, clientY) {
    if (!this.vectorElement) return;
    const dx = clientX - this.state.originX;
    const dy = clientY - this.state.originY;
    const distance = Math.hypot(dx, dy);
    const length = Math.min(distance, this.radius);
    const scale = distance > this.radius ? this.radius / distance : 1;
    this.vectorElement.style.setProperty('--drive-x', `${this.state.originX}px`);
    this.vectorElement.style.setProperty('--drive-y', `${this.state.originY}px`);
    this.vectorElement.style.setProperty('--drive-end-x', `${dx * scale}px`);
    this.vectorElement.style.setProperty('--drive-end-y', `${dy * scale}px`);
    this.vectorElement.style.setProperty('--drive-length', `${length}px`);
    this.vectorElement.style.setProperty(
      '--drive-angle',
      `${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg`,
    );
  }

  _updateFromPointer(event) {
    const dx = event.clientX - this.state.originX;
    const dy = event.clientY - this.state.originY;
    this.state.throttle = this._axis(this.state.originY - event.clientY);
    this.state.steer = this._axis(event.clientX - this.state.originX);
    this._updateVector(event.clientX, event.clientY);
    if (Math.hypot(dx, dy) >= this.tutorialDismissDistance) {
      this.tutorialElement?.classList.remove('visible');
    }

    const power = Math.round(Math.abs(this.state.throttle) * 100);
    const turn = Math.round(Math.abs(this.state.steer) * 100);
    const motion = this.state.throttle > 0 ? `forward ${power}%`
      : this.state.throttle < 0 ? `reverse ${power}%` : 'neutral';
    const heading = this.state.steer > 0 ? `right ${turn}%`
      : this.state.steer < 0 ? `left ${turn}%` : 'centered';
    this.element?.setAttribute('aria-valuetext', `${motion}, ${heading}`);
  }

  _handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (this.state.active) {
      if (event.pointerId === this.state.id) return;
      this.reset();
    }
    event.preventDefault();
    this.audio.start();
    this.onEngage();
    const showTutorial = this._beginHintCooldown();
    this.state.active = true;
    this.state.id = event.pointerId;
    this.state.originX = event.clientX;
    this.state.originY = event.clientY;
    this.element.classList.add('active');
    try { this.element.setPointerCapture(event.pointerId); } catch { }
    this._updateFromPointer(event);
    this.navigator?.vibrate?.(12);
    this.tutorialElement?.classList.toggle('visible', showTutorial);
  }

  _handlePointerMove(event) {
    if (!this.state.active || event.pointerId !== this.state.id) return;
    event.preventDefault();
    this._updateFromPointer(event);
  }

  _handleRelease(event) {
    if (!this.state.active
      || (event.pointerId !== undefined && event.pointerId !== this.state.id)) return;
    this.reset();
    this.navigator?.vibrate?.(8);
  }

  _handleTouchEnd(event) {
    if (!this.state.active) return;
    const endedOnDrive = event.target && this.element.contains(event.target);
    if (endedOnDrive || event.touches.length === 0) this.reset();
  }
}
