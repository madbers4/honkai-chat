import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, MAX_HP, ULTIMATE_PULSES } from '../shared/constants.js';
const input = (room, id, patch = {}) => room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...patch });
function step(room, seconds, holds = {}) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { for (const [id, patch] of Object.entries(holds)) input(room, id, patch); room.step(1 / 60); } }
function fight(distance = 4) { const room = new CombatRoom({ random: () => .8 }); room.addPlayer(); room.addPlayer(); room.ready('p1'); room.ready('p2'); step(room, 3); room.player('p1').x = -distance / 2; room.player('p2').x = distance / 2; room.player('p1').energy = 80; return room; }

test('80-energy overload gives a 1.85s interruptible warning before its lethal 220 damage sequence', () => {
  const room = fight(), a = room.player('p1'), b = room.player('p2');
  a.energy = 79; assert.equal(room.beginAction(a, 'ultimate'), false);
  a.energy = 80; assert.equal(room.beginAction(a, 'ultimate'), true); assert.equal(a.energy, 0);
  step(room, 1.83); assert.equal(b.hp, MAX_HP); assert.equal(a.action, 'ultimate');
  step(room, .04); assert.equal(b.hp, MAX_HP - 45); assert.equal(b.variant, 'overloadHit');
  step(room, .22); assert.equal(b.hp, MAX_HP - 100); assert.equal(b.variant, 'overloadHit');
  step(room, .24); assert.equal(b.hp, 0); assert.equal(room.phase, 'roundOver');
  assert.deepEqual(room.events.filter(e => e.type === 'ultimatePulse').map(e => e.pulse), [0, 1, 2]);
  assert.equal(ULTIMATE_PULSES.reduce((total, pulse) => total + pulse.damage, 0), 220);
});

test('full front block survives all pulses and does not get trapped by overload hit stun', () => {
  const room = fight(); room.beginAction(room.player('p1'), 'ultimate');
  step(room, 2.4, { p2: { block: true } });
  const b = room.player('p2'); assert.equal(b.hp, MAX_HP - 28); assert.ok(b.guard > 0);
  assert.equal(room.events.filter(e => e.type === 'block' && e.variant === 'overload').length, 3);
  assert.equal(room.events.filter(e => e.type === 'parry').length, 0);
  assert.equal(room.phase, 'fight');
});

test('leaving marked range, stepping behind or interrupting windup all defeat the overload', () => {
  const retreat = fight(); retreat.beginAction(retreat.player('p1'), 'ultimate');
  step(retreat, .12); input(retreat, 'p2', { action: 'dash', move: 1 }); step(retreat, 2.4, { p2: { move: 1 } });
  assert.equal(retreat.player('p2').hp, MAX_HP);
  const behind = fight(); behind.beginAction(behind.player('p1'), 'ultimate'); behind.player('p2').x = -4.6;
  step(behind, 2.4); assert.equal(behind.player('p2').hp, MAX_HP);
  const interrupted = fight(2.1); interrupted.beginAction(interrupted.player('p1'), 'ultimate');
  step(interrupted, .35); input(interrupted, 'p2', { action: 'heavy', crouch: true }); step(interrupted, .4);
  assert.equal(interrupted.player('p2').hp, MAX_HP); assert.ok(interrupted.events.some(e => e.type === 'grab'), 'a committed close-range grab interrupts the reactor');
  step(interrupted, 1.8);
  assert.equal(interrupted.events.filter(e => e.type === 'ultimatePulse').length, 0);
});

test('a confirmed airborne overload cannot lose damage to old juggle scaling or early knockback', () => {
  const room = fight(4.7), a = room.player('p1'), b = room.player('p2'); room.beginAction(a, 'ultimate');
  step(room, 1.8); b.y = .6; b.vy = 1; b.airHits = 10;
  step(room, .1); assert.equal(b.hp, MAX_HP - 45); assert.equal(b.vx, 0); assert.ok(b.actionDuration >= .25);
  step(room, .6); assert.equal(b.hp, 0);
});

test('disconnect pauses the exact pulse sequence and resume never replays its first strike', () => {
  const room = fight(); room.beginAction(room.player('p1'), 'ultimate'); step(room, 1.93);
  const hp = room.player('p2').hp; room.setConnected('p2', false); step(room, 4); assert.equal(room.player('p2').hp, hp);
  room.setConnected('p2', true); step(room, 3); assert.equal(room.player('p2').hp, hp); step(room, .58);
  assert.equal(room.player('p2').hp, 0); assert.equal(ATTACKS.ultimate.duration, 3.05);
});
