import test from 'node:test';
import assert from 'node:assert/strict';
import { choreographOverload } from '../src/overload-choreography.js';
import { ATTACKS, ULTIMATE_PULSES } from '../shared/constants.js';

const legs = () => [-1, 1].flatMap(sign => [true, false].map(front => ({ sign, front, desired: { x: sign, y: 0, z: front ? 1 : -1 } })));

for (const reduced of [false, true]) test(`reactor stays braced through the new charge and settles by authoritative duration (reduced=${reduced})`, () => {
  for (const time of [1.40, 1.60, ATTACKS.ultimate.startup - .02]) {
    const feet = legs(), pose = choreographOverload(time, feet, reduced);
    assert.ok(pose.bob <= -.16 && pose.open > .07 && pose.charge > 1.2, 'do not relax before the visible ring reaches the core');
    assert.ok(feet.every(leg => leg.desired.y === 0), 'charging braces on real planted supports');
  }
  const rest = choreographOverload(ATTACKS.ultimate.duration, legs(), reduced);
  assert.equal(Math.abs(rest.bob), 0); assert.equal(rest.charge, 0); assert.equal(rest.open, 0);
  for (const pulse of ULTIMATE_PULSES) {
    const atContact = choreographOverload(pulse.time + .055, legs(), reduced);
    assert.ok(atContact.thrust < -.12, 'each authoritative pulse has a distinct visible recoil');
  }
});
