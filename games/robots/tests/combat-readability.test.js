import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, COMBAT_WINDOWS, MAX_HP, ULTIMATE_PULSES, V5_ATTACKS, VARIANT_ATTACKS } from '../shared/constants.js';

const send = (room, player, action = null, extra = {}) => room.input(player.id, { seq: player.lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
const frames = (room, count, update = () => {}) => { for (let i = 0; i < count; i++) { update(i); room.step(1 / 60); } };
function fight(distance = 4, facing = 1) {
  const room = new CombatRoom({ random: () => .8 });
  const a = room.addPlayer('A'), b = room.addPlayer('B');
  room.ready(a.id); room.ready(b.id); frames(room, 181);
  a.x = -distance / 2 * facing; b.x = distance / 2 * facing;
  a.facing = facing; b.facing = -facing; a.energy = 80; b.energy = 0;
  const log = [], emit = room.event.bind(room);
  room.event = (...args) => { emit(...args); log.push({ ...room.events.at(-1) }); };
  return { room, a, b, log };
}

test('the warning lasts 111 server ticks; jump has a half-second timing window that clears all three pulses', () => {
  assert.equal(ATTACKS.ultimate.startup, 1.85);
  assert.deepEqual(ULTIMATE_PULSES.map(p => p.time), [1.85, 2.07, 2.31]);
  for (const facing of [-1, 1]) for (const jumpFrame of [74, 80, 86, 92, 98, 104]) {
    const { room, a, b, log } = fight(3.8, facing);
    send(room, a, 'ultimate'); frames(room, jumpFrame);
    assert.equal(b.hp, MAX_HP, 'no damage during the warning');
    send(room, b, 'jump'); frames(room, 185 - jumpFrame);
    assert.equal(log.filter(e => e.type === 'ultimatePulse').length, 3);
    assert.equal(b.hp, MAX_HP, `jump at ${jumpFrame / 60}s facing ${facing} clears the WHOLE discharge`);
    assert.equal(b.y, 0);
    assert.ok(!log.some(e => e.type === 'hit' && e.variant === 'overload'));
  }
});

test('jumping immediately at the warning is too early, while all three unavoided pulses still defeat full HP', () => {
  const { room, a, b, log } = fight();
  send(room, a, 'ultimate'); send(room, b, 'jump'); frames(room, 145);
  assert.equal(b.hp, 0);
  assert.deepEqual(log.filter(e => e.type === 'hit').map(e => e.damage), [45, 55, 120]);
  assert.equal(room.phase, 'roundOver');
});

test('a delayed incoming bolt interrupts the visible charge, while a missed jab does not', () => {
  for (const attack of ['special']) for (const facing of [-1, 1]) {
    const { room, a, b, log } = fight(attack === 'light' ? 2.2 : 4, facing);
    b.energy = 100; send(room, a, 'ultimate'); frames(room, 60);
    send(room, b, attack); frames(room, 95);
    assert.ok(a.hp < MAX_HP, attack);
    assert.equal(log.filter(e => e.type === 'ultimatePulse').length, 0, `${attack} cancels all pending pulses`);
    assert.equal(b.hp, MAX_HP); assert.notEqual(a.action, 'ultimate');
  }
  const miss = fight(4); send(miss.room, miss.a, 'ultimate'); frames(miss.room, 60);
  send(miss.room, miss.b, 'light'); frames(miss.room, 85);
  assert.equal(miss.a.hp, MAX_HP); assert.equal(miss.b.hp, 0);
  assert.equal(miss.log.filter(e => e.type === 'ultimatePulse').length, 3);
});

test('front guard remains a fallback, but retreat cannot evade the arena-wide discharge', () => {
  for (const facing of [-1, 1]) for (const response of ['dash', 'block']) {
    const { room, a, b, log } = fight(4, facing);
    send(room, a, 'ultimate'); frames(room, 85);
    send(room, b, response === 'dash' ? 'dash' : null, { move: response === 'dash' ? facing : 0, block: response === 'block' });
    frames(room, 70, () => send(room, b, null, { move: response === 'dash' ? facing : 0, block: response === 'block' }));
    assert.equal(b.hp, response === 'block' ? MAX_HP - 28 : 0);
    assert.equal(log.filter(e => e.type === 'ultimatePulse').length, 3);
  }
});

test('heavy jump advances into range, has actual height at contact, and remains interruptible during startup', () => {
  for (const facing of [-1, 1]) {
    const { room, a, b, log } = fight(3.4, facing), startX = a.x;
    send(room, a, 'heavy');
    let peak = 0, contactHeight = 0;
    frames(room, 90, () => { peak = Math.max(peak, a.y); if (b.hp < MAX_HP && !contactHeight) contactHeight = a.y; });
    assert.equal(b.hp, MAX_HP - 24); assert.ok(peak > .65 && peak < .82);
    assert.ok(contactHeight > .50, 'the authoritative fighter is visibly airborne at impact');
    assert.ok((a.x - startX) * facing > .7);
    assert.equal(log.filter(e => e.type === 'hit').length, 1); assert.equal(a.y, 0);
    const interrupted = fight(2.2, facing);
    send(interrupted.room, interrupted.a, 'heavy'); frames(interrupted.room, 9);
    send(interrupted.room, interrupted.b, 'light'); frames(interrupted.room, 65);
    assert.ok(interrupted.a.hp < MAX_HP); assert.equal(interrupted.b.hp, MAX_HP);
  }
});

test('a recent jump or dash survives a renewed hit, keeps its original expiry, and executes once on recovery', () => {
  for (const action of ['jump', 'dash']) {
    const { room, a, b, log } = fight(3);
    room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' });
    frames(room, 5); send(room, b, action, { move: 1 });
    const expiry = b.queued.expires;
    frames(room, 1); room.damage(a, b, V5_ATTACKS.cross, 'light', a.x, { variant: 'cross' });
    assert.equal(b.queued?.expires, expiry, 'second contact does not swallow or extend the defensive tap');
    frames(room, 13);
    assert.equal(b.action, action); assert.equal(b.queued, null);
    if (action === 'jump') assert.ok(b.y > 0);
    else assert.equal(log.filter(e => e.type === 'dash').length, 1);
    frames(room, 100); assert.equal(b.action, 'idle');
    assert.equal(log.filter(e => e.type === 'dash').length, action === 'dash' ? 1 : 0);
  }
});

test('a defensive tap can still expire during a long lock and offensive follow-ups are erased by contact', () => {
  const { room, a, b } = fight();
  room.setAction(b, 'hit', .6); send(room, b, 'jump'); frames(room, 38);
  assert.equal(b.y, 0); assert.equal(b.queued, null);
  room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' });
  send(room, b, 'light');
  room.damage(a, b, V5_ATTACKS.cross, 'light', a.x, { variant: 'cross' });
  assert.equal(b.queued, null);
});

test('shortened ordinary stuns permit a buffered defense between chain attacks without diminishing their damage', () => {
  for (const defense of ['block', 'dash']) {
    const { room, a, b, log } = fight(2.15);
    send(room, a, 'light'); send(room, a, 'light');
    let reacted = false;
    frames(room, 70, () => {
      if (!reacted && b.hp < MAX_HP) { reacted = true; send(room, b, defense === 'block' ? null : defense, { block: defense === 'block', move: defense === 'dash' ? 1 : 0 }); }
      if (reacted && defense === 'block') send(room, b, null, { block: true });
    });
    assert.equal(b.hp, MAX_HP - V5_ATTACKS.jab.damage, `${defense} answers the follow-up instead of remaining stunlocked`);
    assert.deepEqual(log.filter(e => e.type === 'attack' && e.player === a.id).map(e => e.variant), ['jab', 'cross']);
  }
  assert.equal(COMBAT_WINDOWS.guardBreakStun, .48);
  assert.equal(ATTACKS.special.damage, 28); assert.equal(ATTACKS.special.stun, .24);
  assert.equal(VARIANT_ATTACKS.shockwave.damage, 42); assert.equal(VARIANT_ATTACKS.shockwave.stun, .30);
});
