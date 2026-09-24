import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, VARIANT_ATTACKS, MAX_HP } from '../shared/constants.js';
import { actionResource } from '../src/action-context.js';
import { buildSpecialCase } from '../scripts/special-review.js';
import { specialChoreography, electricalReaction } from '../src/special-choreography.js';

function fight(distance = 3) {
  const room = new CombatRoom(); const a = room.addPlayer('A'), b = room.addPlayer('B');
  room.ready(a.id); room.ready(b.id); for (let i = 0; i < 181; i++) room.step(1 / 60);
  a.x = -distance / 2; b.x = distance / 2; a.energy = 100;
  return { room, a, b };
}
const input = (room, p, values) => room.input(p.id, { seq: p.lastSeq + 1, move: 0, block: false, crouch: false, ...values });
const step = (room, frames, fn = () => {}) => { for (let i = 0; i < frames; i++) { fn(i); room.step(1 / 60); } };

test('bolt trades 25 energy for one 28 damage short electrical stun', () => {
  const { room, a, b } = fight(); input(room, a, { action: 'special' }); room.step(1 / 60);
  assert.equal(a.energy, 75); assert.equal(a.cooldowns.special, 2.6);
  for (let i = 0; i < 60 && b.hp === MAX_HP; i++) room.step(1 / 60);
  assert.equal(b.hp, MAX_HP - 28); assert.equal(b.variant, 'electrified'); assert.equal(b.actionDuration, .38);
  assert.equal(b.y, 0); assert.equal(b.vy, 0);
  const hp = b.hp; step(room, 120); assert.equal(b.hp, hp); assert.equal(room.projectiles.length, 0);
});

test('EMP mine stays planted, detonates once, lifts and stuns for .55s', () => {
  const { room, a, b } = fight(); input(room, a, { action: 'special', crouch: true }); room.step(1 / 60);
  assert.equal(a.energy, 65); assert.equal(a.cooldowns.special, 4);
  let x, peak = 0, impacts = 0; const seen = new Set();
  step(room, 100, () => {
    for (const p of room.projectiles) { x ??= p.x; assert.equal(p.x, x); }
    peak = Math.max(peak, b.y);
    for (const event of room.events) if (event.type === 'hit' && !seen.has(event.id)) {
      seen.add(event.id); impacts++; assert.equal(event.damage, 42); assert.equal(b.actionDuration, .55);
      assert.equal(b.variant, 'empLift'); assert.ok(b.vy > 5.0);
    }
  });
  assert.equal(b.hp, MAX_HP - 42); assert.equal(impacts, 1); assert.ok(peak > .55 && peak < .8, `bounded launch peak ${peak}`);
  assert.equal(b.y, 0); assert.equal(room.projectiles.length, 0);
});

test('EMP can be jumped before detonation, outranged or blocked with chip', () => {
  for (const defense of ['jump', 'retreat', 'block']) {
    const data = buildSpecialCase({ variant: 'shockwave', defense });
    const final = data.snapshots.at(-1).players[1];
    assert.equal(final.hp, MAX_HP - (defense === 'block' ? 6 : 0), defense);
    if (defense === 'block') assert.equal(data.events.filter(e => e.type === 'block').length, 1);
    assert.equal(data.events.filter(e => e.type === 'launch').length, 0);
  }
});

test('mine reaches its full advertised radius even when detonation falls between server ticks', () => {
  const { room, a, b } = fight(4.4); input(room, a, { action: 'special', crouch: true });
  step(room, 65); assert.equal(b.hp, MAX_HP - 42);
  const outside = fight(4.7); input(outside.room, outside.a, { action: 'special', crouch: true });
  step(outside.room, 65); assert.equal(outside.b.hp, MAX_HP);
});

test('bolt and mine are both parryable without recoil on their remote caster', () => {
  for (const variant of ['bolt','shockwave']) {
    const { room, a, b } = fight(); input(room, a, { action: 'special', crouch: variant === 'shockwave' });
    let parried = false;
    step(room, 60, () => {
      if (room.projectiles.length) { b.input.block = true; b.inputAge = 0; b.parryWindow = .14; }
      if (room.events.some(e => e.type === 'parry')) parried = true;
    });
    assert.ok(parried, variant); assert.equal(b.hp, MAX_HP); assert.notEqual(a.variant, 'parried');
    assert.equal(b.y, 0);
  }
});

test('EMP never resets an existing launch and one field never hits twice', () => {
  const { room, a, b } = fight(); b.airLaunchUsed = true; b.y = .3; b.vy = 1;
  room.damage(a, b, VARIANT_ATTACKS.shockwave, 'special', a.x, { projectile: true, variant: 'shockwave' });
  assert.equal(b.vy, 1); assert.notEqual(b.variant, 'empLift');
  const fresh = fight(); input(fresh.room, fresh.a, { action: 'special', crouch: true });
  step(fresh.room, 42); const hp = fresh.b.hp;
  fresh.b.y = 0; fresh.b.vy = 0; fresh.b.airLaunchUsed = false; fresh.b.x = fresh.a.x + 2;
  step(fresh.room, 30); assert.equal(fresh.b.hp, hp);
});

test('special UI costs agree with server and stale duplicate input cannot repeat spending', () => {
  assert.equal(actionResource('special', { y: 0 }, { crouch: true }).cost, 35);
  assert.equal(actionResource('special', { y: 0 }, { crouch: false }).cost, 25);
  const { room, a } = fight(); a.energy = 34;
  input(room, a, { action: 'special', crouch: true }); assert.notEqual(a.action, 'special'); assert.equal(a.energy, 34);
  a.energy = 100; input(room, a, { action: 'special', crouch: true }); room.step(1 / 60); assert.equal(a.energy, 65);
  const seq = a.lastSeq; room.input(a.id, { seq, action: 'special', crouch: true, move: 0 }); assert.equal(a.energy, 65);
  step(room, 70); const before = a.energy; input(room, a, { action: 'special' }); assert.equal(a.energy, before); assert.notEqual(a.action, 'special');
  assert.ok(a.cooldowns.special > 2.5);
});

test('late buffered input executes the right crouch variant once after recovery', () => {
  const { room, a } = fight(); room.setAction(a, 'hit', .2); input(room, a, { action: 'special', crouch: true });
  step(room, 15); assert.equal(a.variant, 'shockwave'); assert.equal(a.action, 'special');
  assert.ok(a.energy >= 65 && a.energy < 66); assert.ok(a.cooldowns.special > 3.9);
});

test('special phases are continuous, supported, finish at rest and distinct at release', () => {
  for (const variant of ['bolt','shockwave']) {
    const attack = variant === 'bolt' ? ATTACKS.special : VARIANT_ATTACKS.shockwave;
    let previous;
    for (let t = 0; t <= attack.duration + .1; t += 1 / 240) {
      const pose = specialChoreography(variant, t);
      assert.ok(pose.bob > -.14 && pose.bob < .05);
      assert.equal(pose.rear.lift, 0); if (variant === 'bolt') assert.equal(pose.front.lift, 0);
      if (previous) for (const field of ['bob','lean','thrust','headPitch']) assert.ok(Math.abs(pose[field] - previous[field]) < .04, `${variant}/${field}`);
      previous = pose;
    }
    const rest = specialChoreography(variant, attack.duration);
    assert.equal(rest.charge, 0); assert.equal(rest.bob, 0);
  }
  const charge = specialChoreography('shockwave', .25); assert.ok(charge.front.lift > .2);
  const calm = electricalReaction('empLift', .1, .55, .6, true); assert.equal(calm.headYaw, 0); assert.ok(calm.tuck > .2);
});
