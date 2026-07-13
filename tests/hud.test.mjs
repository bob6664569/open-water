import assert from 'node:assert/strict';
import test from 'node:test';

import { BoatHud } from '../site/js/ui/hud.js';

function fakeElement() {
  const writes = [];
  let textContent = '';
  let width = '';
  let marginLeft = '';
  return {
    writes,
    get textContent() { return textContent; },
    set textContent(value) { textContent = value; writes.push(['textContent', value]); },
    style: {
      get width() { return width; },
      set width(value) { width = value; writes.push(['width', value]); },
      get marginLeft() { return marginLeft; },
      set marginLeft(value) { marginLeft = value; writes.push(['marginLeft', value]); },
    },
    classList: {
      toggle(name, enabled) { writes.push(['class', name, enabled]); },
    },
  };
}

test('boat HUD preserves output while skipping unchanged DOM writes', () => {
  const speed = fakeElement();
  const throttle = fakeElement();
  const rudder = fakeElement();
  const hud = new BoatHud(speed, throttle, rudder);

  assert.deepEqual(rudder.writes, [['width', '4px']]);
  hud.update(12.34, 0.5, -0.25);
  assert.equal(speed.textContent, '12.3');
  assert.equal(throttle.style.width, '50%');
  assert.equal(rudder.style.marginLeft, '51px');
  const writesAfterFirstUpdate = [
    speed.writes.length, throttle.writes.length, rudder.writes.length,
  ];

  hud.update(12.34, 0.5, -0.25);
  assert.deepEqual(
    [speed.writes.length, throttle.writes.length, rudder.writes.length],
    writesAfterFirstUpdate,
  );

  hud.update(12.36, -0.5, 0.25);
  assert.equal(speed.textContent, '12.4');
  assert.equal(throttle.style.width, '50%');
  assert.equal(rudder.style.marginLeft, '85px');
  assert.deepEqual(throttle.writes.at(-1), ['class', 'reverse', true]);
});
