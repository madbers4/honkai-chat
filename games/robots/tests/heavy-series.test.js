import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { MAX_HP, ARENA_EDGE, HEAVY_RULES, V5_ATTACKS, canAttemptFeint } from '../shared/constants.js';
import { buildHeavyCase } from '../scripts/heavy-review.js';
import { actionContext } from '../src/action-context.js';

const send = (room, id, action = null, extra = {}) => room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
const advance = (room, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) room.step(1 / 60); };
function fight(distance = 2.5) {
  const room = new CombatRoom(); room.addPlayer('A'); room.addPlayer('B'); room.ready('p1'); room.ready('p2'); advance(room, 3);
  room.players[0].x = -distance / 2; room.players[1].x = distance / 2;
  return room;
}

test('three separate presses produce three different heavy contacts and physical advance in both facings', () => {
  for (const facing of [1, -1]) {
    const { snapshots, events } = buildHeavyCase('series', facing);
    const hits = events.filter(e => e.type === 'hit');
    assert.deepEqual(hits.map(e => e.variant), ['heavyDrive', 'heavyHook', 'heavyPress']);
    assert.deepEqual(hits.map(e => e.damage), [24, 28, 36]);
    assert.equal(snapshots.at(-1).players[1].hp, MAX_HP - 88);
    const attacks = events.filter(e => e.type === 'attack');
    assert.equal(attacks.length, 3);
    for (let n = 0; n < 3; n++) {
      assert.ok((hits[n].frame - attacks[n].frame) / 60 >= attacks[n].startup - 1e-7);
      assert.ok((hits[n].frame - attacks[n].frame) / 60 <= attacks[n].startup + 1 / 60 + 1e-7);
      assert.equal(attacks[n].chain, n + 1);
    }
    const start = snapshots[0].players[0].x, end = snapshots.at(-1).players[0].x;
    assert.ok((end - start) * facing > .65, 'server moves the fighter, without post-start repositioning');
    assert.ok((end - start) * facing < 1.4, 'the chain cannot teleport across the arena');
    for (const state of snapshots) assert.ok(Math.abs(state.players[0].x - state.players[1].x) >= 1.999);
    assert.ok(snapshots.at(-1).players.every(p => p.action === 'idle' && p.cancelWindow === 0));
    assert.equal(JSON.parse(JSON.stringify(snapshots[hits[1].frame])).players[0].comboRoute, 'heavyDrive-heavyHook');
  }
});

test('a held or repeated neutral packet never invents follow-ups; stopping after two remains possible', () => {
  for (const [type, expected] of [['single', 1], ['stop', 2]]) {
    const result = buildHeavyCase(type);
    assert.equal(result.events.filter(e => e.type === 'hit').length, expected);
    assert.equal(result.events.filter(e => e.type === 'attack').length, expected);
    assert.equal(result.snapshots.at(-1).players[0].action, 'idle');
  }
  assert.ok(V5_ATTACKS.heavyDrive.duration < V5_ATTACKS.heavyPress.duration - .2);
  assert.ok(V5_ATTACKS.heavyHook.duration < V5_ATTACKS.heavyPress.duration - .2);
  const held = fight(); send(held, 'p1', 'heavy');
  const sequence = held.player('p1').lastSeq;
  for (let frame = 0; frame < 120; frame++) {
    assert.equal(held.input('p1', { seq: sequence, move: 0, block: false, crouch: false, action: 'heavy' }), false);
    send(held, 'p1'); held.step(1 / 60);
  }
  assert.equal(held.player('p2').hp, MAX_HP - 24, 'one press plus 30Hz held-input packets deals one hit');
});

test('holding block after the first hit breaks the earliest confirmed heavy route even at a wall', () => {
  for (const facing of [1, -1]) {
    const room = fight(), a = room.player('p1'), b = room.player('p2');
    a.x = (ARENA_EDGE - 2.05) * facing; b.x = ARENA_EDGE * facing; a.facing = facing; b.facing = -facing;
    send(room, 'p1', 'heavy');
    let hook = false, press = false, restart = false; const variants = [];
    const emit = room.event.bind(room);
    room.event = (...args) => { emit(...args); if (args[0] === 'hit' && args[1] === a) variants.push(args[2].variant); };
    for (let frame = 0; frame < 180; frame++) {
      if (b.hp < MAX_HP) send(room, 'p2', null, { block: true });
      if (!hook && a.variant === 'heavyDrive' && a.cancelWindow > 0 && a.actionTime >= .42) { send(room, 'p1', 'heavy'); hook = true; }
      if (!press && a.variant === 'heavyHook' && a.cancelWindow > 0 && a.actionTime >= .36) { send(room, 'p1', 'heavy'); press = true; }
      if (!restart && a.variant === 'heavyPress' && a.actionTime >= .85) { send(room, 'p1', 'heavy'); restart = true; }
      room.step(1 / 60);
      assert.ok(room.players.every(p => Math.abs(p.x) <= ARENA_EDGE));
    }
    assert.deepEqual(variants, ['heavyDrive']);
    assert.equal(b.hp, MAX_HP - 24 - Math.ceil(28 * .12), 'hook is blocked for chip and cannot confirm a press');
  }
});

test('pre-contact buffer waits for real hit and the heavy-only cancel delay', () => {
  const room = fight(), a = room.player('p1');
  send(room, a.id, 'heavy'); advance(room, .31); send(room, a.id, 'heavy'); advance(room, .18);
  assert.equal(a.variant, 'heavyDrive'); assert.ok(a.cancelWindow > 0);
  advance(room, .10); assert.equal(a.variant, 'heavyHook');
  const attack = room.events.find(e => e.variant === 'heavyHook' && e.type === 'attack');
  const hit = room.events.find(e => e.variant === 'heavyDrive' && e.type === 'hit');
  assert.ok(attack.at - hit.at >= HEAVY_RULES.cancelAfterContact);
});

test('block, whiff and parry never open a heavy route, including guard break', () => {
  for (const type of ['block', 'whiff', 'parry']) {
    const { snapshots, events } = buildHeavyCase(type);
    assert.equal(events.filter(e => e.type === 'hit').length, 0, type);
    assert.equal(events.filter(e => e.type === 'attack').length, 1, type);
    assert.ok(snapshots.every(s => s.players[0].cancelWindow === 0), type);
    if (type !== 'whiff') assert.equal(events.filter(e => e.type === type).length, 1, type);
  }
  const room = fight(); send(room, 'p2', null, { block: true }); advance(room, .2); room.player('p2').guard = 10;
  send(room, 'p1', 'heavy');
  for (let i = 0; i < 30; i++) { send(room, 'p2', null, { block: true }); room.step(1 / 60); }
  assert.equal(room.player('p1').cancelWindow, 0);
});

test('late confirmation has a defendable gap; burst interrupts a correctly linked series', () => {
  const late = buildHeavyCase('late'), burst = buildHeavyCase('burst');
  assert.ok(late.events.some(e => e.type === 'block' && e.variant === 'heavyHook'));
  assert.ok(!late.events.some(e => e.variant === 'heavyPress'));
  assert.ok(burst.events.some(e => e.type === 'burst'));
  assert.ok(!burst.events.some(e => e.type === 'hit' && e.variant === 'heavyPress'));
});

test('incoming strike erases the route; heavy confirm cannot manufacture a light cross or launcher', () => {
  const room = fight(), a = room.player('p1'), b = room.player('p2');
  send(room, a.id, 'heavy'); advance(room, .5);
  assert.ok(a.cancelWindow > 0);
  assert.equal(room.beginAction(a, 'light'), false);
  assert.equal(room.beginAction(a, 'heavy', true), false, 'cannot cancel directly into a grab');
  room.damage(b, a, V5_ATTACKS.jab, 'light', b.x, { variant: 'jab' });
  assert.equal(a.cancelWindow, 0); assert.equal(a.comboRoute, '');
  advance(room, .4); send(room, a.id, 'heavy'); advance(room, .02);
  assert.equal(a.variant, 'heavyDrive');
});

test('heavy contextual buttons describe the actual route while light, grab, air and feint retain priority', () => {
  const base = { hp: 100, action: 'heavy', variant: 'heavyDrive', y: 0, cancelWindow: .20, actionTime: .44, energy: 40 };
  assert.equal(actionContext(base).heavy, 'КРЮК');
  const hook = { ...base, variant: 'heavyHook' };
  assert.equal(actionContext(hook).heavy, 'ПРЕСС'); assert.equal(actionContext(hook).crusher, false);
  assert.equal(actionContext(hook, { crouch: true }).heavy, 'ЗАХВАТ');
  assert.equal(actionContext({ ...hook, y: .3 }).heavy, 'ПИКЕ');
  assert.equal(actionContext({ ...hook, y: .12, groundHeavy: true }).heavy, 'ПРЕСС', 'the authored ground hop never relabels the confirmed ground route as a slam');
  assert.equal(actionContext({ ...base, variant: 'cross', action: 'light', launchWindow: .2 }).heavy, 'ДРОБИТЕЛЬ');
  assert.equal(canAttemptFeint({ ...base, actionTime: .15 }), true);
  assert.equal(canAttemptFeint({ ...hook, actionTime: .15 }), false);
});
