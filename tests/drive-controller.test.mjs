import assert from 'node:assert/strict';
import test from 'node:test';
import { DriveController } from '../site/js/drive-controller.js';

function createBoat() {
  return {
    calls: [],
    setControls(throttle, wheel) {
      this.calls.push([throttle, wheel]);
    },
  };
}

const neutralGesture = { active: false, throttle: 0, steer: 0 };

test('keyboard driving preserves throttle ramps, steering and recentering', () => {
  const boat = createBoat();
  const drive = new DriveController(boat);
  drive.press('KeyW');
  drive.press('KeyD');
  drive.update(0.5, 0, neutralGesture);
  assert.deepEqual(boat.calls.at(-1), [0.35, 1]);

  drive.release('KeyW');
  drive.release('KeyD');
  drive.update(0.25, 0, neutralGesture);
  assert.deepEqual(boat.calls.at(-1), [0.35, 0.6]);

  drive.press('Space');
  assert.equal(drive.throttle, 0);
});

test('touch keyboard input returns both axes to neutral', () => {
  const boat = createBoat();
  const drive = new DriveController(boat, { isTouch: true });
  drive.throttle = -0.8;
  drive.wheel = -0.5;

  drive.update(0.1, 0, neutralGesture);
  assert.ok(Math.abs(drive.throttle - -0.32) < 1e-12);
  assert.ok(Math.abs(drive.wheel - -0.34) < 1e-12);
  drive.update(1, 0, neutralGesture);
  assert.deepEqual(boat.calls.at(-1), [0, 0]);
});

test('active gesture and auto mode retain their input priority', () => {
  const gestureBoat = createBoat();
  const gestureDrive = new DriveController(gestureBoat);
  gestureDrive.press('KeyW');
  gestureDrive.update(1, 12, { active: true, throttle: -0.4, steer: 0.7 });
  assert.deepEqual(gestureBoat.calls.at(-1), [-0.4, 0.7]);

  const autoBoat = createBoat();
  let autoEnabled = true;
  const autoDrive = new DriveController(autoBoat, { auto: () => autoEnabled });
  autoDrive.update(1, 12, { active: true, throttle: -1, steer: -1 });
  assert.deepEqual(autoBoat.calls.at(-1), [1, 0.9]);
  autoEnabled = false;
  autoDrive.clearInput();
  autoDrive.update(0, 31, neutralGesture);
  assert.deepEqual(autoBoat.calls.at(-1), [1, 0.9]);
  autoEnabled = true;
  autoDrive.update(1, 31, neutralGesture);
  assert.deepEqual(autoBoat.calls.at(-1), [1, 0]);
});

test('output can reset without dropping held input', () => {
  const drive = new DriveController(createBoat());
  drive.press('KeyW');
  drive.throttle = 0.8;
  drive.wheel = -0.5;
  drive.resetOutput();
  assert.equal(drive.keys.has('KeyW'), true);
  assert.equal(drive.throttle, 0);
  assert.equal(drive.wheel, 0);
});

test('reset clears held keys and output state', () => {
  const drive = new DriveController(createBoat());
  drive.press('KeyW');
  drive.throttle = 0.8;
  drive.wheel = -0.5;
  drive.reset();
  assert.equal(drive.keys.size, 0);
  assert.equal(drive.throttle, 0);
  assert.equal(drive.wheel, 0);
});
