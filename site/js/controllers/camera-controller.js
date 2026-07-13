import * as THREE from 'three';
import {
  cancelTimeout,
  requestNextFrame,
  scheduleTimeout,
} from '../runtime/browser-platform.js';

const CAMERA_MODE_KEY = 'ocean-boat:camera-mode';
const CAMERA_MODE_NAMES = [
  'Chase camera',
  'Helm camera',
  'Top camera',
  'Cinematic camera',
];
const ORBIT_MIN = 2.5;
const ORBIT_MAX = 90;
const TOP_MIN = 12;
const TOP_MAX = 320;
const GRAVITY = 9.81;

function defaultTopDistance(spec) {
  return spec.camera.topDistance
    ?? spec.camera.chaseDistance * 2 + spec.length * 4;
}

export class CameraController {
  constructor({
    camera,
    boat,
    waveField,
    achievements,
    isTouch = false,
    reducedMotion = false,
    statusElement = null,
    storage = globalThis.localStorage,
    requestFrame = requestNextFrame,
    setTimer = scheduleTimeout,
    clearTimer = cancelTimeout,
  }) {
    this.camera = camera;
    this.boat = boat;
    this.waveField = waveField;
    this.achievements = achievements;
    this.isTouch = isTouch;
    this.reducedMotion = reducedMotion;
    this.statusElement = statusElement;
    this.storage = storage;
    this.requestFrame = requestFrame;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.mode = this._storedMode();
    this.orbitYaw = 0;
    this.orbitPitch = 0.3;
    this.orbitDistance = 12;
    this.topDistance = 60;
    this.topYaw = 0;
    this.cinematicAngle = Math.PI * 1.18;
    this.cinematicTime = 0;
    this.statusTimer = null;
    this.initialized = false;

    // Reused by every frame: the camera hot path stays allocation-free.
    this.target = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.stableForward = new THREE.Vector3();
    this.previousVelocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.localAcceleration = new THREE.Vector3();
    this.inertialLocal = new THREE.Vector3();
    this.inertialTarget = new THREE.Vector3();
    this.inertialWorld = new THREE.Vector3();
    this.inverseBoat = new THREE.Quaternion();
    this.impactOffset = 0;
    this.impactVelocity = 0;
    this.lastSlam = 0;

    this.achievements.recordCamera(this.mode);
  }

  activeZoom() {
    return this.mode === 2 ? this.topDistance : this.orbitDistance;
  }

  setActiveZoom(value) {
    const before = this.activeZoom();
    if (this.mode === 2) {
      this.topDistance = THREE.MathUtils.clamp(value, TOP_MIN, TOP_MAX);
    } else {
      this.orbitDistance = THREE.MathUtils.clamp(value, ORBIT_MIN, ORBIT_MAX);
    }
    if ((this.mode === 0 || this.mode === 2)
      && Math.abs(this.activeZoom() - before) > 0.001) {
      this.achievements.recordCameraControl('zoom');
    }
  }

  orbitHoriz(deltaX) {
    if (this.mode === 2) this.topYaw -= deltaX * 0.006;
    else this.orbitYaw -= deltaX * 0.006;
    if ((this.mode === 0 || this.mode === 2) && Math.abs(deltaX) > 0.1) {
      this.achievements.recordCameraControl('orbit');
    }
  }

  orbitPitchBy(deltaY) {
    if (this.mode === 2) return;
    const previousPitch = this.orbitPitch;
    this.orbitPitch = THREE.MathUtils.clamp(
      this.orbitPitch + deltaY * 0.004,
      0.14,
      1.25,
    );
    if (this.mode === 0 && Math.abs(this.orbitPitch - previousPitch) > 0.0001) {
      this.achievements.recordCameraControl('orbit');
    }
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODE_NAMES.length;
    this._rememberMode();
    if (this.mode === 3) this._beginCinematic();
    else this.initialized = false;
    this.achievements.recordCamera(this.mode);
    this._announceMode();
  }

  setVessel(spec) {
    this.orbitDistance = spec.camera.chaseDistance;
    this.topDistance = defaultTopDistance(spec);
    this.snap();
  }

  resetVessel(spec = this.boat.spec) {
    this.orbitYaw = 0;
    this.orbitPitch = 0.3;
    this.topYaw = 0;
    this.setVessel(spec);
  }

  snap() {
    this.initialized = false;
    this._resetPerception();
  }

  update(dt) {
    const { boat, camera } = this;
    const forward = this.forward.set(0, 0, 1).applyQuaternion(boat.quat);
    this._updatePerception(dt);
    if (this.mode !== 2) camera.up.set(0, 1, 0);

    if (this.mode === 0) {
      this._updateChase(dt, forward);
    } else if (this.mode === 1) {
      this._updateHelm(forward);
    } else if (this.mode === 2) {
      this._updateTop(dt);
    } else {
      this._updateCinematic(dt, forward);
    }
  }

  _updateChase(dt, forward) {
    const { boat, camera } = this;
    const speed = boat.vel.length();
    const cameraSpec = boat.spec.camera;
    const heading = Math.atan2(forward.x, forward.z);
    const angle = heading + Math.PI + this.orbitYaw;
    const distance = this.orbitDistance + speed * 0.06;
    const horizontalDistance = distance * Math.cos(this.orbitPitch);
    this.desired.set(
      boat.pos.x + Math.sin(angle) * horizontalDistance,
      boat.pos.y + distance * Math.sin(this.orbitPitch) + cameraSpec.chaseHeight,
      boat.pos.z + Math.cos(angle) * horizontalDistance,
    ).addScaledVector(this.inertialWorld, 0.72);
    const minY = this.waveField.heightAt(this.desired.x, this.desired.z)
      + Math.max(1.35, cameraSpec.chaseHeight + 0.55);
    if (this.desired.y < minY) this.desired.y = minY;
    const positionEase = this.initialized
      ? 1 - Math.exp(-dt * (3.2 + speed * 0.12))
      : 1;
    camera.position.lerp(this.desired, positionEase);
    const ahead = 5 * Math.max(Math.cos(this.orbitYaw), 0);
    const mobileFramingDrop = this.isTouch ? cameraSpec.chaseDistance * 0.065 : 0;
    this.look.copy(boat.pos).addScaledVector(forward, ahead).y += 1.1 - mobileFramingDrop;
    this.target.lerp(this.look, this.initialized ? 1 - Math.exp(-dt * 8) : 1);
    camera.lookAt(this.target);
    const froude = speed / Math.sqrt(GRAVITY * Math.max(boat.spec.length, 1));
    const speedCue = THREE.MathUtils.smoothstep(froude, 0.1, 0.95);
    this._setFov(58 + speedCue * 6, dt, 3.4);
    this.initialized = true;
  }

  _updateHelm(forward) {
    const { boat, camera } = this;
    const cameraSpec = boat.spec.camera;
    boat.worldPoint(cameraSpec.helm, camera.position);
    camera.position.addScaledVector(this.inertialWorld, 0.38);
    this.stableForward.set(forward.x, 0, forward.z);
    if (this.stableForward.lengthSq() < 0.0001) this.stableForward.set(0, 0, 1);
    this.stableForward.normalize().lerp(forward, this.reducedMotion ? 0.08 : 0.22).normalize();
    this.look.copy(camera.position)
      .addScaledVector(this.stableForward, Math.max(10, boat.spec.length * 1.6)).y -= 0.25;
    camera.lookAt(this.look);
    if (camera.fov !== cameraSpec.helmFov) {
      camera.fov = cameraSpec.helmFov;
      camera.updateProjectionMatrix();
    }
    this.initialized = true;
  }

  _updateTop(dt) {
    const { boat, camera } = this;
    this.desired.set(boat.pos.x, boat.pos.y + this.topDistance, boat.pos.z);
    camera.position.lerp(
      this.desired,
      this.initialized ? 1 - Math.exp(-dt * 3.5) : 1,
    );
    camera.up.set(Math.sin(this.topYaw), 0, -Math.cos(this.topYaw));
    this.look.lerp(boat.pos, this.initialized ? 1 - Math.exp(-dt * 8) : 1);
    camera.lookAt(this.look);
    if (Math.abs(camera.fov - 55) > 0.1) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    if (this.topDistance >= TOP_MAX) this.achievements.recordAntWorld();
    this.initialized = true;
  }

  _updateCinematic(dt, forward) {
    const { boat, camera } = this;
    this.cinematicTime += dt;
    const cameraSpec = boat.spec.camera;
    const heading = Math.atan2(forward.x, forward.z);
    const turnRate = this.reducedMotion ? 0.018 : 0.055;
    this.cinematicAngle += dt * turnRate;

    const baseDistance = Math.max(cameraSpec.chaseDistance * 1.35, boat.spec.length * 0.38);
    const distance = baseDistance;
    const height = Math.max(
      cameraSpec.chaseHeight + 1.25,
      distance * 0.26,
    );
    const worldAngle = heading + this.cinematicAngle;
    this.desired.set(
      boat.pos.x + Math.sin(worldAngle) * distance,
      boat.pos.y + height,
      boat.pos.z + Math.cos(worldAngle) * distance,
    ).addScaledVector(this.inertialWorld, 0.55);
    const minY = this.waveField.heightAt(this.desired.x, this.desired.z)
      + Math.max(1.25, cameraSpec.chaseHeight + 0.5);
    if (this.desired.y < minY) this.desired.y = minY;

    camera.position.lerp(
      this.desired,
      this.initialized ? 1 - Math.exp(-dt * 0.82) : 1,
    );
    const speed = boat.vel.length();
    const ahead = Math.max(1.5, Math.min(boat.spec.length * 0.16, 9) + speed * 0.35);
    this.look.copy(boat.pos);
    this.look.x += Math.sin(heading) * ahead;
    this.look.z += Math.cos(heading) * ahead;
    this.look.y += Math.max(0.7, boat.spec.length * 0.025);
    this.target.lerp(this.look, this.initialized ? 1 - Math.exp(-dt * 2.4) : 1);
    camera.lookAt(this.target);

    const froude = speed / Math.sqrt(GRAVITY * Math.max(boat.spec.length, 1));
    const speedCue = THREE.MathUtils.smoothstep(froude, 0.12, 1);
    this._setFov(50 + speedCue * 2, dt, 1.8);
    this.initialized = true;
  }

  _resetPerception() {
    this.previousVelocity.copy(this.boat.vel);
    this.acceleration.set(0, 0, 0);
    this.localAcceleration.set(0, 0, 0);
    this.inertialLocal.set(0, 0, 0);
    this.inertialTarget.set(0, 0, 0);
    this.inertialWorld.set(0, 0, 0);
    this.impactOffset = 0;
    this.impactVelocity = 0;
    this.lastSlam = this.boat.slam ?? 0;
  }

  _updatePerception(dt) {
    const { boat } = this;
    if (!this.initialized || dt <= 0 || this.reducedMotion) {
      this._resetPerception();
      return;
    }

    const sampleDt = Math.max(dt, 1 / 240);
    this.acceleration.copy(boat.vel).sub(this.previousVelocity)
      .multiplyScalar(1 / sampleDt).clampLength(0, 24);
    this.previousVelocity.copy(boat.vel);
    this.inverseBoat.copy(boat.quat).invert();
    this.localAcceleration.copy(this.acceleration).applyQuaternion(this.inverseBoat);

    const vesselScale = THREE.MathUtils.clamp(boat.spec.length / 20, 0.65, 1.45);
    this.inertialTarget.set(
      THREE.MathUtils.clamp(-this.localAcceleration.x * 0.018, -0.2, 0.2),
      THREE.MathUtils.clamp(-this.localAcceleration.y * 0.012, -0.12, 0.12),
      THREE.MathUtils.clamp(-this.localAcceleration.z * 0.026, -0.34, 0.34),
    ).multiplyScalar(vesselScale);
    this.inertialLocal.set(
      THREE.MathUtils.damp(this.inertialLocal.x, this.inertialTarget.x, 5.8, dt),
      THREE.MathUtils.damp(this.inertialLocal.y, this.inertialTarget.y, 6.8, dt),
      THREE.MathUtils.damp(this.inertialLocal.z, this.inertialTarget.z, 5.2, dt),
    );

    const slam = boat.slam ?? 0;
    if (slam > this.lastSlam + 0.12) {
      const slamSpeed = Math.max(0, boat.slamSpeed ?? 0);
      this.impactVelocity -= THREE.MathUtils.clamp(
        0.025 + slam * 0.025 + Math.max(0, slamSpeed - 2.4) * 0.012,
        0.025,
        0.16,
      );
    }
    this.lastSlam = slam;
    this.impactVelocity += (-this.impactOffset * 72 - this.impactVelocity * 13) * dt;
    this.impactOffset = THREE.MathUtils.clamp(
      this.impactOffset + this.impactVelocity * dt,
      -0.18,
      0.08,
    );

    this.inertialWorld.copy(this.inertialLocal).applyQuaternion(boat.quat);
    this.inertialWorld.y += this.impactOffset;
  }

  _setFov(target, dt, damping) {
    const next = this.initialized
      ? THREE.MathUtils.damp(this.camera.fov, target, damping, dt)
      : target;
    if (Math.abs(this.camera.fov - next) <= 0.001) return;
    this.camera.fov = next;
    this.camera.updateProjectionMatrix();
  }

  _beginCinematic() {
    const forward = this.forward.set(0, 0, 1).applyQuaternion(this.boat.quat);
    const heading = Math.atan2(forward.x, forward.z);
    this.desired.copy(this.camera.position).sub(this.boat.pos);
    this.cinematicAngle = Math.atan2(this.desired.x, this.desired.z) - heading;
    this.camera.getWorldDirection(this.direction);
    this.target.copy(this.camera.position).addScaledVector(
      this.direction,
      Math.max(this.boat.spec.camera.chaseDistance, 10),
    );
    this.cinematicTime = 0;
    this.initialized = true;
  }

  _announceMode() {
    if (!this.statusElement) return;
    this.statusElement.textContent = CAMERA_MODE_NAMES[this.mode];
    this.statusElement.classList.remove('visible');
    this.requestFrame(() => this.statusElement.classList.add('visible'));
    this.clearTimer(this.statusTimer);
    this.statusTimer = this.setTimer(
      () => this.statusElement.classList.remove('visible'),
      1400,
    );
  }

  _storedMode() {
    try {
      const mode = Number(this.storage?.getItem(CAMERA_MODE_KEY));
      return Number.isInteger(mode) && mode >= 0 && mode < CAMERA_MODE_NAMES.length
        ? mode
        : 0;
    } catch {
      return 0;
    }
  }

  _rememberMode() {
    try {
      this.storage?.setItem(CAMERA_MODE_KEY, String(this.mode));
    } catch { /* Persistence is optional in privacy-restricted contexts. */ }
  }
}
