import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CameraController } from '../site/js/controllers/camera-controller.js';

function createFixture({ storedMode = null, isTouch = false, reducedMotion = false } = {}) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
  camera.position.set(-12, 5, -12);
  const boat = {
    pos: new THREE.Vector3(10, 2, -4),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(3, 0, 4),
    slam: 0,
    slamSpeed: 0,
    spec: {
      length: 20,
      camera: {
        chaseDistance: 14,
        chaseHeight: 2.5,
        helm: new THREE.Vector3(0, 3, 2),
        helmFov: 72,
      },
    },
    worldPoint(point, output) {
      return output.copy(point).applyQuaternion(this.quat).add(this.pos);
    },
  };
  const calls = { camera: [], controls: [], antWorld: 0 };
  const achievements = {
    recordCamera(mode) { calls.camera.push(mode); },
    recordCameraControl(control) { calls.controls.push(control); },
    recordAntWorld() { calls.antWorld++; },
  };
  const values = new Map();
  if (storedMode !== null) values.set('ocean-boat:camera-mode', String(storedMode));
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const classes = new Set();
  const statusElement = {
    textContent: '',
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
    },
  };
  const timers = [];
  const controller = new CameraController({
    camera,
    boat,
    waveField: { heightAt: () => 0 },
    achievements,
    isTouch,
    reducedMotion,
    statusElement,
    storage,
    requestFrame: callback => callback(),
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
  });
  return { controller, camera, boat, calls, storage, statusElement, timers };
}

function assertFiniteVector(vector) {
  assert.equal(Number.isFinite(vector.x), true);
  assert.equal(Number.isFinite(vector.y), true);
  assert.equal(Number.isFinite(vector.z), true);
}

test('restores, cycles, persists and announces all camera modes', () => {
  const fixture = createFixture({ storedMode: 1 });
  const { controller, calls, storage, statusElement, timers } = fixture;
  assert.equal(controller.mode, 1);
  assert.deepEqual(calls.camera, [1]);

  controller.cycle();
  assert.equal(controller.mode, 2);
  assert.equal(storage.getItem('ocean-boat:camera-mode'), '2');
  assert.equal(statusElement.textContent, 'Top camera');
  assert.equal(statusElement.classList.contains('visible'), true);
  assert.equal(timers.at(-1).delay, 1400);
  timers.at(-1).callback();
  assert.equal(statusElement.classList.contains('visible'), false);

  controller.cycle();
  controller.cycle();
  assert.equal(controller.mode, 0);
  assert.deepEqual(calls.camera, [1, 2, 3, 0]);
});

test('camera controls retain mode-specific clamps and achievement semantics', () => {
  const { controller, calls } = createFixture();
  controller.setActiveZoom(1000);
  assert.equal(controller.activeZoom(), 90);
  controller.orbitHoriz(10);
  controller.orbitPitchBy(1000);
  assert.equal(controller.orbitPitch, 1.25);
  assert.deepEqual(calls.controls, ['zoom', 'orbit', 'orbit']);

  controller.cycle();
  calls.controls.length = 0;
  controller.setActiveZoom(1);
  controller.orbitHoriz(10);
  controller.orbitPitchBy(-1000);
  assert.equal(controller.activeZoom(), 2.5);
  assert.equal(controller.orbitPitch, 0.14);
  assert.deepEqual(calls.controls, []);

  controller.cycle();
  controller.setActiveZoom(1000);
  controller.orbitHoriz(10);
  const pitch = controller.orbitPitch;
  controller.orbitPitchBy(50);
  assert.equal(controller.activeZoom(), 320);
  assert.equal(controller.orbitPitch, pitch);
  assert.deepEqual(calls.controls, ['zoom', 'orbit']);
});

test('vessel changes preserve orbit angles while reset restores camera defaults', () => {
  const { controller } = createFixture();
  controller.orbitHoriz(50);
  controller.orbitPitchBy(20);
  const yaw = controller.orbitYaw;
  const spec = {
    length: 30,
    camera: { chaseDistance: 22, chaseHeight: 3, helm: new THREE.Vector3(), helmFov: 65 },
  };
  controller.setVessel(spec);
  assert.equal(controller.orbitDistance, 22);
  assert.equal(controller.topDistance, 164);
  assert.equal(controller.orbitYaw, yaw);
  assert.equal(controller.initialized, false);

  controller.topYaw = 0.8;
  controller.resetVessel(spec);
  assert.equal(controller.orbitYaw, 0);
  assert.equal(controller.orbitPitch, 0.3);
  assert.equal(controller.topYaw, 0);
});

test('updates chase, helm, top and cinematic modes without replacing scratch vectors', () => {
  const { controller, camera, boat, calls } = createFixture({ reducedMotion: true });
  const scratch = [
    controller.target,
    controller.desired,
    controller.look,
    controller.forward,
    controller.direction,
    controller.stableForward,
    controller.previousVelocity,
    controller.acceleration,
    controller.localAcceleration,
    controller.inertialLocal,
    controller.inertialTarget,
    controller.inertialWorld,
    controller.inverseBoat,
  ];

  controller.setVessel(boat.spec);
  controller.update(1 / 60);
  assertFiniteVector(camera.position);
  assert.ok(camera.fov > 59 && camera.fov < 60);

  controller.cycle();
  controller.update(1 / 60);
  assert.deepEqual(camera.position.toArray(), [10, 5, -2]);
  assert.equal(camera.fov, 72);

  controller.cycle();
  controller.setActiveZoom(320);
  controller.update(1 / 60);
  assert.deepEqual(camera.position.toArray(), [10, 322, -4]);
  assert.equal(camera.fov, 55);
  assert.equal(calls.antWorld, 1);

  controller.cycle();
  const previousAngle = controller.cinematicAngle;
  controller.update(1);
  assertFiniteVector(camera.position);
  assert.ok(controller.cinematicAngle > previousAngle);
  assert.equal(controller.cinematicTime, 1);
  assert.equal(controller.initialized, true);
  assert.deepEqual(
    [
      controller.target, controller.desired, controller.look, controller.forward,
      controller.direction, controller.stableForward, controller.previousVelocity,
      controller.acceleration, controller.localAcceleration, controller.inertialLocal,
      controller.inertialTarget, controller.inertialWorld, controller.inverseBoat,
    ],
    scratch,
  );
});

test('camera inertia and impact response come from physical acceleration', () => {
  const { controller, boat } = createFixture();
  controller.setVessel(boat.spec);
  controller.update(1 / 60);

  boat.vel.set(3, 0, 13);
  controller.update(1 / 60);
  assert.ok(controller.inertialLocal.z < 0, 'forward acceleration should make the camera lag');
  assert.ok(controller.inertialWorld.length() > 0);

  boat.slam = 1.2;
  boat.slamSpeed = 8;
  controller.update(1 / 60);
  assert.ok(controller.impactVelocity < 0, 'a hull impact should create a bounded downward lag');
  assert.ok(controller.impactOffset < 0);
});

test('reduced-motion mode removes inertial camera offsets', () => {
  const { controller, boat } = createFixture({ reducedMotion: true });
  controller.setVessel(boat.spec);
  controller.update(1 / 60);
  boat.vel.set(15, 3, 30);
  boat.slam = 2;
  boat.slamSpeed = 12;
  controller.update(1 / 60);

  assert.equal(controller.inertialWorld.lengthSq(), 0);
  assert.equal(controller.impactOffset, 0);
  assert.equal(controller.impactVelocity, 0);
});

test('helm gaze retains the horizon while the hull pitches', () => {
  const { controller, camera, boat } = createFixture({ storedMode: 1 });
  boat.quat.setFromEuler(new THREE.Euler(0.42, 0, 0.22));
  controller.update(1 / 60);
  const hullForward = new THREE.Vector3(0, 0, 1).applyQuaternion(boat.quat);
  const gaze = camera.getWorldDirection(new THREE.Vector3());

  assert.ok(Math.abs(gaze.y) < Math.abs(hullForward.y) * 0.45);
  assert.deepEqual(camera.up.toArray(), [0, 1, 0]);
});

test('storage failures fall back safely without blocking camera use', () => {
  const camera = new THREE.PerspectiveCamera();
  const boat = {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(),
    spec: {
      length: 10,
      camera: {
        chaseDistance: 10,
        chaseHeight: 2,
        helm: new THREE.Vector3(),
        helmFov: 60,
      },
    },
  };
  const controller = new CameraController({
    camera,
    boat,
    waveField: { heightAt: () => 0 },
    achievements: {
      recordCamera() {},
      recordCameraControl() {},
      recordAntWorld() {},
    },
    storage: {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    },
  });
  assert.equal(controller.mode, 0);
  assert.doesNotThrow(() => controller.cycle());
});
