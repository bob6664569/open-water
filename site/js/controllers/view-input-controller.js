const VIEW_TAP_MAX_DURATION = 280;
const VIEW_TAP_MAX_MOVEMENT = 18;
const VIEW_DOUBLE_TAP_DELAY = 340;
const VIEW_DOUBLE_TAP_DISTANCE = 48;

export class ViewInputController {
  constructor({
    element,
    cameraController,
    audio,
    isTouch = false,
    isAppStarted = () => true,
    isGestureActive = () => false,
    cycleCamera = () => cameraController.cycle(),
    eventTarget = globalThis,
    now = () => performance.now(),
  }) {
    this.element = element;
    this.cameraController = cameraController;
    this.audio = audio;
    this.isTouch = isTouch;
    this.isAppStarted = isAppStarted;
    this.isGestureActive = isGestureActive;
    this.cycleCamera = cycleCamera;
    this.eventTarget = eventTarget;
    this.now = now;

    this.pointers = new Map();
    this.pinchStartDistance = 0;
    this.pinchStartZoom = 0;
    this.lastTap = null;
    this.bound = false;

    this._pointerDown = event => this._handlePointerDown(event);
    this._pointerMove = event => this._handlePointerMove(event);
    this._pointerEnd = event => this._handlePointerEnd(event);
    this._wheel = event => this._handleWheel(event);
  }

  bind() {
    if (!this.element || this.bound) return;
    this.bound = true;
    this.element.addEventListener('pointerdown', this._pointerDown);
    this.eventTarget.addEventListener('pointermove', this._pointerMove);
    this.eventTarget.addEventListener('pointerup', this._pointerEnd);
    this.eventTarget.addEventListener('pointercancel', this._pointerEnd);
    this.eventTarget.addEventListener('wheel', this._wheel, { passive: true });
  }

  destroy() {
    if (!this.bound) return;
    this.bound = false;
    this.element.removeEventListener('pointerdown', this._pointerDown);
    this.eventTarget.removeEventListener('pointermove', this._pointerMove);
    this.eventTarget.removeEventListener('pointerup', this._pointerEnd);
    this.eventTarget.removeEventListener('pointercancel', this._pointerEnd);
    this.eventTarget.removeEventListener('wheel', this._wheel);
    this.pointers.clear();
    this.pinchStartDistance = 0;
    this.lastTap = null;
  }

  _registerTap(event, pointer) {
    if (!this.isTouch || event.pointerType !== 'touch'
      || !this.isAppStarted() || this.isGestureActive()) return;
    const time = this.now();
    const moved = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    if (pointer.multiTouch || moved > VIEW_TAP_MAX_MOVEMENT
      || time - pointer.startTime > VIEW_TAP_MAX_DURATION) {
      this.lastTap = null;
      return;
    }
    if (this.lastTap && time - this.lastTap.time <= VIEW_DOUBLE_TAP_DELAY
      && Math.hypot(event.clientX - this.lastTap.x, event.clientY - this.lastTap.y)
        <= VIEW_DOUBLE_TAP_DISTANCE) {
      this.lastTap = null;
      this.cycleCamera();
      return;
    }
    this.lastTap = { time, x: event.clientX, y: event.clientY };
  }

  _handlePointerDown(event) {
    this.audio.start();
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startTime: this.now(),
      multiTouch: false,
    });
    if (this.pointers.size === 2) {
      this.pointers.forEach(pointer => { pointer.multiTouch = true; });
      const [a, b] = this.pointers.values();
      this.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStartZoom = this.cameraController.activeZoom();
    }
  }

  _handlePointerMove(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const previousX = pointer.x;
    const previousY = pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (this.pointers.size >= 2) {
      const [a, b] = this.pointers.values();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStartDistance > 0 && distance > 0) {
        this.cameraController.setActiveZoom(
          this.pinchStartZoom * this.pinchStartDistance / distance,
        );
      }
    } else if (this.isGestureActive() && this.isTouch) {
      this.cameraController.orbitHoriz(event.clientX - previousX);
      this.cameraController.setActiveZoom(
        this.cameraController.activeZoom() * Math.exp((event.clientY - previousY) * 0.008),
      );
    } else {
      this.cameraController.orbitHoriz(event.clientX - previousX);
      this.cameraController.orbitPitchBy(event.clientY - previousY);
    }
  }

  _handlePointerEnd(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (pointer && event.type === 'pointerup') this._registerTap(event, pointer);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStartDistance = 0;
  }

  _handleWheel(event) {
    if (event.target?.closest?.('#achievements-panel')) return;
    this.cameraController.setActiveZoom(
      this.cameraController.activeZoom() * Math.exp(event.deltaY * 0.0012),
    );
  }
}
