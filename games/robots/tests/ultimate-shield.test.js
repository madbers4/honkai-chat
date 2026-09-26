import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ARENA_EDGE, MAX_HP, ULTIMATE_ARMOR, V5_ATTACKS } from '../shared/constants.js';

const step = (room, count) => { for (let i = 0; i < count; i++) room.step(1 / 60); };
function fight() {
  const room = new CombatRoom({ random: () => .8 });
  const a = room.addPlayer(), b = room.addPlayer();
  room.ready(a.id); room.ready(b.id); step(room, 181);
  a.x = -2; b.x = 2; a.energy = 80;
  room.beginAction(a, 'ultimate'); return { room, a, b };
}

test('three normal combo hits consume shield damage; the third cancels all scheduled pulses', () => {
  const { room, a, b } = fight();
  assert.equal(ULTIMATE_ARMOR.capacity, V5_ATTACKS.jab.damage + V5_ATTACKS.cross.damage + V5_ATTACKS.rake.damage);
  for (const [i, variant] of ['jab', 'cross', 'rake'].entries()) {
    room.damage(b, a, V5_ATTACKS[variant], 'light', b.x, { variant });
    assert.equal(a.hp, MAX_HP, 'shield absorbs actual damage');
    assert.equal(a.action, i < 2 ? 'ultimate' : 'hit');
    assert.equal(room.snapshot().players[0].ultimateArmor, i < 2);
    if (i < 2) assert.equal(a.vx, 0, 'shield prevents pushback');
  }
  assert.equal(a.ultimateShield, 0);
  assert.equal(room.events.filter(e => e.type === 'ultimateShield' && e.broken).length, 1);
  step(room, 180); assert.equal(b.hp, MAX_HP);
  assert.ok(!room.events.some(e => e.type === 'ultimatePulse'));
});

test('shield counts damage, suppresses launcher displacement, and resets on a new cast', () => {
  const { room, a, b } = fight();
  room.damage(b, a, V5_ATTACKS.launcher, 'heavy', b.x, { variant: 'launcher' });
  assert.equal(a.action, 'ultimate'); assert.equal(a.vy, 0); assert.equal(a.y, 0);
  assert.equal(a.ultimateShield, ULTIMATE_ARMOR.capacity - V5_ATTACKS.launcher.damage);
  room.damage(b, a, V5_ATTACKS.heavyDrive, 'heavy', b.x, { variant: 'heavyDrive' });
  assert.equal(a.action, 'hit'); assert.equal(a.hp, MAX_HP - 9);
  step(room, 60); room.setAction(a, 'idle'); a.energy = 80; a.cooldowns.ultimate = 0;
  assert.ok(room.beginAction(a, 'ultimate')); assert.equal(a.ultimateShield, ULTIMATE_ARMOR.capacity);
});

test('real three-tap close-range combo shatters shield before the warning ends', () => {
  const { room, a, b } = fight(); a.x = -1.1; b.x = 1.1;
  const sendLight = () => room.input(b.id, { seq: b.lastSeq + 1, move: 0, block: false, crouch: false, action: 'light' });
  sendLight(); sendLight();
  let thirdTap = false;
  for (let n = 0; n < 100; n++) {
    if (!thirdTap && b.variant === 'cross') { sendLight(); thirdTap = true; }
    room.step(1 / 60);
  }
  assert.ok(thirdTap); assert.equal(a.ultimateShield, 0); assert.equal(a.hp, MAX_HP);
  assert.equal(b.hp, MAX_HP); assert.notEqual(a.action, 'ultimate');
  assert.ok(!room.events.some(e => e.type === 'ultimatePulse'));
});

test('shield remains during firing, and expiry or round reset cannot carry it into normal combat', () => {
  const { room, a, b } = fight(); b.y = 4;
  a.actionTime = 2.1;
  room.damage(b, a, V5_ATTACKS.jab, 'light', b.x, { variant: 'jab' });
  assert.equal(a.action, 'ultimate'); assert.equal(a.hp, MAX_HP);
  room.setAction(a, 'idle'); assert.equal(a.ultimateShield, 0);
  room.damage(b, a, V5_ATTACKS.jab, 'light', b.x, { variant: 'jab' });
  assert.equal(a.hp, MAX_HP - V5_ATTACKS.jab.damage);
  room.startRound(); assert.equal(a.ultimateShield, 0);
});

for (const side of [-1, 1]) test(`opposite arena edges: standing and crouching lose; a timed jump evades all pulses (${side})`, () => {
  for (const defense of ['stand', 'crouch', 'jump']) {
    const { room, a, b } = fight();
    a.x = -side * (ARENA_EDGE - 1); b.x = side * (ARENA_EDGE - 1);
    a.facing = -side; // Deliberately point away: still hits the entire map.
    step(room, 85);
    if (defense === 'jump') assert.ok(room.beginAction(b, 'jump'));
    for (let n = 0; n < 65; n++) {
      room.input(b.id, { seq: b.lastSeq + 1, move: 0, block: false, crouch: defense === 'crouch' });
      room.step(1 / 60);
    }
    assert.equal(b.hp, defense === 'jump' ? MAX_HP : 0, defense);
  }
});
