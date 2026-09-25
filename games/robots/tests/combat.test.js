import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, ARENA_EDGE, ROUND_SECONDS, V5_ATTACKS } from '../shared/constants.js';

function fight(mode = 'pvp') {
  const room = new CombatRoom({ mode, random: () => 0.25 });
  room.addPlayer('Первый');
  room.addPlayer('Второй', { bot: mode === 'training' });
  room.ready('p1'); room.ready('p2');
  advance(room, 3.02);
  assert.equal(room.phase, 'fight');
  return room;
}

function input(room, id, values = {}) {
  return room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...values });
}

function advance(room, seconds, held = {}) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    for (const [id, values] of Object.entries(held)) input(room, id, values);
    room.step(1 / 60);
  }
}

function closeRange(room) { room.player('p1').x = -1.07; room.player('p2').x = 1.07; }

test('readiness, countdown and immutable public snapshots define the round lifecycle', () => {
  const room = new CombatRoom();
  room.addPlayer('Один'); room.addPlayer('Два');
  room.ready('p1');
  assert.equal(room.phase, 'waiting');
  room.ready('p2');
  assert.equal(room.phase, 'countdown');
  assert.equal(room.countdown, 3);
  advance(room, 3);
  assert.equal(room.phase, 'fight');
  assert.equal(room.time, ROUND_SECONDS);
  const snapshot = room.snapshot();
  snapshot.players[0].hp = 1;
  snapshot.players[0].cooldowns.special = 100;
  assert.equal(room.player('p1').hp, MAX_HP);
  assert.equal(room.player('p1').cooldowns.special, 0);
  assert.equal(snapshot.players[0].input, undefined);
  assert.equal(snapshot.players[0].lastSeq, undefined);
});

test('stale, non-finite and malformed inputs cannot change authoritative state', () => {
  const room = fight();
  assert.equal(input(room, 'p1', { seq: 10, move: 1 }), true);
  assert.equal(input(room, 'p1', { seq: 9, move: -1 }), false);
  assert.equal(input(room, 'p1', { move: Number.NaN }), false);
  assert.equal(input(room, 'p1', { block: 'true' }), false);
  assert.equal(input(room, 'p1', { action: 'teleport' }), false);
  assert.equal(room.player('p1').input.move, 1);
  assert.equal(room.player('p1').lastSeq, 10);
});

test('held movement stops after missing packets and arena walls constrain both fighters', () => {
  const room = fight();
  input(room, 'p1', { move: -1 });
  advance(room, 0.6);
  const stoppedAt = room.player('p1').x;
  advance(room, 0.5);
  assert.equal(room.player('p1').x, stoppedAt);
  advance(room, 3, { p1: { move: -1 }, p2: { move: 1 } });
  assert.equal(room.player('p1').x, -ARENA_EDGE);
  assert.equal(room.player('p2').x, ARENA_EDGE);
});

test('light attacks respect startup and range, hit once and chain into a stronger third strike', () => {
  const room = fight();
  closeRange(room);
  input(room, 'p1', { action: 'light' });
  advance(room, 0.1);
  assert.equal(room.player('p2').hp, MAX_HP);
  advance(room, 0.18);
  assert.equal(room.player('p2').hp, MAX_HP - 6);
  input(room, 'p1', { action: 'light' });
  advance(room, 0.28);
  assert.equal(room.player('p2').hp, MAX_HP - 14);
  closeRange(room);
  input(room, 'p1', { action: 'light' });
  advance(room, 0.28);
  assert.equal(room.player('p2').hp, MAX_HP - 26);
  assert.equal(room.player('p1').chain, 3);
  assert.equal(room.player('p1').combo, 3);
  assert.equal(room.events.filter(event => event.type === 'hit').length, 3);
  advance(room, 0.4);
  room.player('p2').x = 5;
  input(room, 'p1', { action: 'light' });
  advance(room, 0.4);
  assert.equal(room.player('p2').hp, MAX_HP - 26);
});

test('block absorbs jab, heavy drains guard and a broken guard causes a long stagger', () => {
  const room = fight();
  closeRange(room);
  // Hold guard before the strike: a fresh guard press now deliberately parries a jab.
  advance(room, 0.2, { p2: { block: true } });
  input(room, 'p1', { action: 'light' });
  advance(room, 0.4, { p2: { block: true } });
  assert.equal(room.player('p2').hp, MAX_HP);
  assert.equal(room.player('p2').guard, 90);
  advance(room, .15, { p2: { block: true } }); // Let the jab's optional continuation grace expire.
  room.player('p2').guard = 20;
  closeRange(room);
  input(room, 'p1', { action: 'heavy' });
  advance(room, V5_ATTACKS.heavyDrive.startup - 1 / 60, { p2: { block: true } });
  assert.equal(room.player('p2').guard, 20, 'the longer windup cannot break guard before contact');
  advance(room, 2 / 60, { p2: { block: true } });
  assert.equal(room.player('p2').guard, 0);
  assert.equal(room.player('p2').hp, MAX_HP - 16);
  assert.equal(room.player('p2').action, 'hit');
  assert.equal(room.player('p2').actionDuration, 0.95);
  assert.ok(room.events.some(event => event.type === 'block' && event.guardBreak));
});

test('dash dodge window prevents damage, has a cooldown, and cannot be spammed', () => {
  const room = fight();
  closeRange(room);
  input(room, 'p2', { action: 'dash', move: 1 });
  advance(room, 0.05);
  const target = room.player('p2');
  assert.equal(target.action, 'dash');
  assert.equal(room.damage(room.player('p1'), target, ATTACKS.heavy), false);
  assert.equal(target.hp, MAX_HP);
  advance(room, 0.28);
  input(room, 'p2', { action: 'dash' });
  advance(room, 0.1);
  assert.notEqual(target.action, 'dash');
  assert.ok(target.cooldowns.dash > 0);
});

test('cannon costs energy, travels over time, can be crouched and cannot bypass cooldown', () => {
  const normal = fight();
  normal.player('p1').x = -1.3; normal.player('p2').x = 1.3;
  input(normal, 'p1', { action: 'special' });
  advance(normal, 0.32);
  assert.equal(normal.player('p2').hp, MAX_HP);
  assert.equal(normal.projectiles.length, 1);
  assert.ok(normal.player('p1').energy < 17);
  advance(normal, 0.3);
  assert.equal(normal.player('p2').hp, MAX_HP - 28);
  assert.equal(normal.projectiles.length, 0);
  advance(normal, 0.15);
  input(normal, 'p1', { action: 'special' });
  advance(normal, 0.2);
  assert.notEqual(normal.player('p1').action, 'special');
  const crouched = fight();
  crouched.player('p1').x = -1.3; crouched.player('p2').x = 1.3;
  input(crouched, 'p1', { action: 'special' });
  advance(crouched, 0.8, { p2: { crouch: true } });
  assert.equal(crouched.player('p2').hp, MAX_HP);
});

test('jump leaves the ground, evades low attacks and lands with an event', () => {
  const room = fight();
  closeRange(room);
  input(room, 'p2', { action: 'jump' });
  advance(room, 0.23);
  assert.ok(room.player('p2').y > 1.1);
  input(room, 'p1', { action: 'light' });
  advance(room, 0.25);
  assert.equal(room.player('p2').hp, MAX_HP);
  for (let frame = 0; frame < 90 && room.player('p2').y > 0; frame++) advance(room, 1 / 60);
  assert.equal(room.player('p2').y, 0);
  assert.equal(room.player('p2').vy, 0);
  assert.ok(room.events.some(event => event.type === 'land'));
});

test('ultimate requires 80 energy, has a visible windup and knocks out at long range', () => {
  const room = fight();
  room.player('p1').x = -2; room.player('p2').x = 2;
  input(room, 'p1', { action: 'ultimate' });
  advance(room, 0.3);
  assert.notEqual(room.player('p1').action, 'ultimate');
  room.player('p1').energy = 80;
  input(room, 'p1', { action: 'ultimate' });
  advance(room, 0.9);
  assert.equal(room.player('p1').action, 'ultimate');
  assert.equal(room.player('p2').hp, MAX_HP);
  assert.ok(room.player('p1').energy < 2);
  advance(room, 0.1);
  assert.equal(room.player('p2').hp, MAX_HP - 45);
  advance(room, 0.6);
  assert.equal(room.player('p2').hp, 0);
});

test('five wins and final destruction end the match, timeouts compare health, draws award no point, rematch requires both players', () => {
  const room = fight();
  room.time = 0.01;
  advance(room, 0.02);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.roundWinner, null);
  assert.equal(room.player('p1').wins, 0);
  advance(room, 6.5);
  assert.equal(room.phase, 'fight');
  room.player('p2').hp = 20;
  room.time = 0.01;
  advance(room, 0.02);
  assert.equal(room.player('p1').wins, 1);
  assert.equal(room.phase, 'roundOver');
  advance(room, 6.5);
  room.player('p2').hp = 0;
  advance(room, 0.02);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.player('p1').wins, 2);
  for (let win = 3; win <= WINS_TO_MATCH; win++) {
    advance(room, 6.5);
    room.player('p2').hp = 0; advance(room, 0.02);
    assert.equal(room.player('p1').wins, win);
    if (win < WINS_TO_MATCH) assert.equal(room.phase, 'roundOver');
  }
  assert.equal(room.phase, 'finishing');
  advance(room, 7);
  assert.equal(room.phase, 'matchOver');
  assert.equal(room.winner, 'p1');
  assert.equal(room.player('p1').wins, WINS_TO_MATCH);
  room.requestRematch('p1');
  assert.equal(room.phase, 'matchOver');
  room.requestRematch('p2');
  assert.equal(room.phase, 'countdown');
  assert.equal(room.winner, null);
  assert.equal(room.round, 1);
  assert.equal(room.player('p1').wins, 0);
});

test('disconnect freezes combat, clears controls and reconnect resumes after countdown', () => {
  const room = fight();
  input(room, 'p1', { move: 1 });
  advance(room, 0.2);
  room.setConnected('p2', false);
  assert.equal(room.phase, 'paused');
  const before = room.snapshot();
  advance(room, 4);
  assert.equal(room.snapshot().time, before.time);
  assert.equal(room.snapshot().players[0].x, before.players[0].x);
  room.setConnected('p2', true);
  assert.equal(room.phase, 'countdown');
  advance(room, 3.05);
  assert.equal(room.phase, 'fight');
  assert.ok(room.time <= before.time);
  assert.equal(room.player('p2').input.move, 0);
});

test('deterministic training AI readies itself and meaningfully engages a passive opponent', () => {
  const room = fight('training');
  assert.equal(room.player('p2').ready, true);
  const initialX = room.player('p2').x;
  advance(room, 4);
  assert.ok(room.player('p2').x < initialX);
  assert.ok(room.player('p1').hp < MAX_HP);
  assert.ok(room.player('p2').energy >= 0 && room.player('p2').energy <= 100);
  advance(room, 16);
  assert.ok(room.player('p2').wins > 0, 'the bot can finish a 180 HP passive opponent within twenty seconds');
});

test('an airborne knockout falls to the floor while KO and victory animations continue', () => {
  const room = fight();
  room.player('p2').y = 1.2;
  room.player('p2').hp = 0;
  advance(room, 0.02);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.player('p2').action, 'ko');
  advance(room, 0.6);
  assert.equal(room.player('p2').y, 0);
  assert.ok(room.player('p2').actionTime >= 0.6);
  assert.ok(room.player('p1').actionTime >= 0.6);
});

test('reconnecting a ready player starts an otherwise ready waiting room', () => {
  const room = new CombatRoom();
  room.addPlayer('Один'); room.addPlayer('Два');
  room.ready('p1');
  room.setConnected('p1', false);
  room.ready('p2');
  assert.equal(room.phase, 'waiting');
  room.setConnected('p1', true);
  assert.equal(room.phase, 'countdown');
});
