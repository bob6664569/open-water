export class DriveController {
  constructor(boat, { isTouch = false, auto = false } = {}) {
    this.boat = boat;
    this.isTouch = isTouch;
    this.isAuto = typeof auto === 'function' ? auto : () => auto;
    this.keys = new Set();
    this.throttle = 0;
    this.wheel = 0;
  }

  press(code) {
    this.keys.add(code);
    if (code === 'Space') this.throttle = 0;
  }

  release(code) {
    this.keys.delete(code);
  }

  clearInput() {
    this.keys.clear();
  }

  reset() {
    this.resetOutput();
    this.clearInput();
  }

  resetOutput() {
    this.throttle = 0;
    this.wheel = 0;
  }

  update(dt, waveTime, gesture) {
    if (this.isAuto()) {
      this.throttle = 1;
      this.wheel = waveTime > 6 && waveTime < 30 ? 0.9 : 0;
      this._apply();
      return;
    }
    if (gesture.active) {
      this.throttle = gesture.throttle;
      this.wheel = gesture.steer;
      this._apply();
      return;
    }

    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    if (up) this.throttle = Math.min(this.throttle + 0.7 * dt, 1);
    if (down) this.throttle = Math.max(this.throttle - 0.9 * dt, -1);
    if (this.isTouch && !up && !down) {
      const returnRate = 4.8 * dt;
      if (this.throttle > returnRate) this.throttle -= returnRate;
      else if (this.throttle < -returnRate) this.throttle += returnRate;
      else this.throttle = 0;
    }

    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    if (right && !left) this.wheel = Math.min(this.wheel + 2.2 * dt, 1);
    else if (left && !right) this.wheel = Math.max(this.wheel - 2.2 * dt, -1);
    else {
      const returnRate = 1.6 * dt;
      if (this.wheel > returnRate) this.wheel -= returnRate;
      else if (this.wheel < -returnRate) this.wheel += returnRate;
      else this.wheel = 0;
    }
    this._apply();
  }

  _apply() {
    this.boat.setControls(this.throttle, this.wheel);
  }
}
