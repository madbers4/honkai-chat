import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { MAX_HP, ARENA_EDGE, V5_ATTACKS, VARIANT_ATTACKS, HEAVY_RULES } from '../shared/constants.js';
import { buildHeavyAdvantageCase } from '../scripts/heavy-advantage-cases.js';

const send = (room, player, action = null, extra = {}) => room.input(player.id, { seq: player.lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
const step = (room, n = 1) => { for (let i = 0; i < n; i++) room.step(1 / 60); };
function setup() { const room = new CombatRoom(), a = room.addPlayer('A'), b = room.addPlayer('B'); room.ready(a.id); room.ready(b.id); step(room, 181); a.x = -1.2; b.x = 1.2; return { room, a, b }; }

for (const facing of [-1, 1]) for (const late of [false, true]) {
  test(`confirmed heavy gives real defense without an offensive interruption, facing ${facing}, late ${late}`, () => {
    for (const type of ['series', 'block', 'jump', 'retreat', 'jab']) {
      const data = buildHeavyAdvantageCase(type, facing, { late });
      const hits = data.events.filter(event => event.type === 'hit' && event.player === 'p1');
      assert.equal(hits[0]?.variant, 'heavyDrive', type);
      if (['series', 'jab'].includes(type)) assert.deepEqual(hits.map(event => event.damage), [24, 28, 36]);
      else {
        assert.ok(!hits.some(event => event.variant === 'heavyHook'), `${type}: the second strike must be avoided`);
        assert.equal(hits.length, 1, `${type}: the high jump or retreat can clear both follow-ups`);
        if (type === 'jump' && !late) assert.deepEqual(data.events.filter(event => event.type === 'attack' && event.player === 'p1').map(event => event.variant),
          ['heavyDrive', 'heavyHook', 'heavyPress'], 'both missed follow-ups still execute while the defender clears them');
      }
      if (type === 'block') {
        assert.ok(data.events.some(event => event.type === 'block' && event.variant === 'heavyHook'));
        assert.ok(!data.events.some(event => event.type === 'parry'), 'recovery block cannot manufacture a staggering counter');
      }
      if (type === 'jump') assert.ok(data.snapshots.some(state => state.players[1].defenseOnly > 0 && state.players[1].y > .8), 'jump must leave the actual heavy collision band');
      if (type === 'retreat') assert.ok(data.snapshots.some(state => state.players[1].action === 'dash' && state.players[1].vx * facing > 0), 'defensive dash moves away from attacker');
      if (type === 'jab') assert.ok(!data.events.some(event => event.type === 'attack' && event.player === 'p2'), 'denied inputs are not buffered until recovery');
      assert.ok(data.snapshots.every(state => state.players.every(player => Number.isFinite(player.y) && Math.abs(player.x) <= ARENA_EDGE)));
      assert.ok(data.snapshots.every(state => Math.abs(state.players[0].y - state.players[1].y) > 1.15 || Math.abs(state.players[0].x - state.players[1].x) >= 1.999));
      const first = data.snapshots[hits[0].frame].players[1];
      assert.equal(first.actionDuration, .18); assert.equal(first.defenseOnly, .62);
      assert.ok(data.snapshots.some(state => state.players[1].defenseOnly > .1 && state.players[1].action !== 'hit'), 'advantage is not one long full stun');
    }
  });
}

test('heavy hop is real bounded physics and stays a ground route, including held packets', () => {
  const data = buildHeavyAdvantageCase('series');
  const attacks = data.events.filter(event => event.type === 'attack');
  assert.deepEqual(attacks.map(event => event.variant), ['heavyDrive', 'heavyHook', 'heavyPress']);
  for (const variant of attacks.map(event => event.variant)) {
    const heights = data.snapshots.filter(state => state.players[0].variant === variant).map(state => state.players[0].y);
    assert.ok(Math.max(...heights) > .06 && Math.max(...heights) < .17, `${variant}: shallow hop`);
    assert.ok(data.snapshots.filter(state => state.players[0].variant === variant).every(state => state.players[0].groundHeavy));
  }
  const { room, a, b } = setup(); send(room, a, 'heavy'); const seq = a.lastSeq;
  for (let frame = 0; frame < 150; frame++) {
    room.input(a.id, { seq, move: 0, block: false, crouch: false, action: 'heavy' }); send(room, a); step(room);
  }
  assert.equal(b.hp, MAX_HP - V5_ATTACKS.heavyDrive.damage);
  assert.equal(a.action, 'idle');
});

test('defense-only discards every attack queue, then requires a fresh press; disconnect freezes it', () => {
  for (const action of ['light', 'heavy', 'special', 'ultimate']) {
    const { room, a, b } = setup(); b.energy = 100;
    room.damage(a, b, V5_ATTACKS.heavyDrive, 'heavy', a.x, { variant: 'heavyDrive' });
    for (let frame = 0; frame < 22; frame++) { send(room, b, action, { crouch: action === 'heavy' }); step(room); }
    assert.equal(b.queued, null); assert.ok(!['light', 'heavy', 'special', 'ultimate'].includes(b.action));
    const remaining = b.defenseOnly; room.setConnected(a.id, false); step(room, 90); assert.equal(b.defenseOnly, remaining);
    room.setConnected(a.id, true); step(room, 181); step(room, 60);
    assert.equal(b.defenseOnly, 0); assert.equal(b.action, 'idle'); assert.equal(b.counterWindow, 0);
    send(room, b, action); step(room); assert.equal(b.action, action, `${action}: control returns on a fresh press`);
  }
});

test('corner defense and terminal recovery prevent a new heavy loop', () => {
  for (const facing of [-1, 1]) for (const type of ['block', 'jump']) {
    const data = buildHeavyAdvantageCase(type, facing, { corner: true });
    assert.ok(!data.events.some(event => event.type === 'hit' && event.variant === 'heavyHook'), type);
    assert.ok(data.events.filter(event => event.type === 'attack' && event.player === 'p1').length <= 3, 'no fourth strike without a new press');
    assert.ok(data.snapshots.at(-1).players.every(player => player.defenseOnly === 0 && ['idle', 'block'].includes(player.action)));
  }
  const whiff = buildHeavyAdvantageCase('whiff');
  assert.ok(!whiff.events.some(event => event.type === 'hit'));
  assert.ok(whiff.snapshots.some(state => state.players[0].cancelWindow > 0));
  assert.ok(whiff.snapshots.every(state => state.players[0].combo === 0));
  const { room, a, b } = setup(); a.x = -3; b.x = 3; send(room, a, 'heavy'); step(room, 37);
  assert.ok(room.isWhiffRecovery(a));
  room.damage(b, a, V5_ATTACKS.jab, 'light', b.x, { variant: 'jab' });
  assert.equal(a.hp, MAX_HP - V5_ATTACKS.jab.damage - 3);
});

test('ground slam gives one shallow physical bounce, never repeated lift in air, and expires with its microstun', () => {
  for (const facing of [-1, 1]) {
    const data = buildHeavyAdvantageCase('slam', facing), hits = data.events.filter(event => event.type === 'hit');
    assert.equal(hits.length, 1); assert.equal(hits[0].damage, 28);
    const start = data.snapshots[hits[0].frame].players[1];
    assert.equal(start.variant, 'slamBounce'); assert.equal(start.actionDuration, .28); assert.equal(start.vy, 3);
    const heights = data.snapshots.map(state => state.players[1].y); assert.ok(Math.max(...heights) > .14 && Math.max(...heights) < .21);
    assert.ok(data.snapshots.every(state => state.players[1].defenseOnly === 0));
    assert.ok(data.snapshots.at(-1).players[1].landingRecovery === 0);
  }
  const { room, a, b } = setup(); room.damage(a, b, VARIANT_ATTACKS.slam, 'heavy', a.x, { variant: 'slam' });
  step(room, 4); const velocity = b.vy;
  room.damage(a, b, VARIANT_ATTACKS.slam, 'heavy', a.x, { variant: 'slam' }); assert.equal(b.vy, velocity, 'no second lift before real ground');
  step(room, 30); assert.equal(b.slamBounceUsed, false); assert.equal(b.action, 'idle');
});

test('a blocked opener and a terminal press both expose recovery; a paid burst remains an explicit escape', () => {
  const blocked = setup(); send(blocked.room, blocked.b, null, { block: true }); step(blocked.room, 13);
  send(blocked.room, blocked.a, 'heavy');
  while (blocked.b.hp === MAX_HP) { send(blocked.room, blocked.b, null, { block: true }); step(blocked.room); }
  assert.equal(blocked.b.defenseOnly, 0); assert.equal(blocked.a.cancelWindow, 0);
  send(blocked.room, blocked.b, 'light'); step(blocked.room, 12);
  assert.equal(blocked.a.action, 'hit'); assert.ok(blocked.a.hp < MAX_HP, 'blocked heavy can be punished with a real input');
  const terminal = setup(); let hook = false, press = false, answer = false;
  send(terminal.room, terminal.a, 'heavy');
  for (let frame = 0; frame < 170; frame++) {
    const { room, a, b } = terminal;
    if (!hook && a.variant === 'heavyDrive' && a.cancelWindow > 0 && a.cancelWindow < HEAVY_RULES.cancelWindow - .12) { send(room, a, 'heavy'); hook = true; }
    if (!press && a.variant === 'heavyHook' && a.cancelWindow > 0 && a.cancelWindow < HEAVY_RULES.cancelWindow - .12) { send(room, a, 'heavy'); press = true; }
    if (!answer && b.hp === MAX_HP - 88 && b.action !== 'hit' && b.defenseOnly === 0) { send(room, b, 'light', { move: -1 }); answer = true; }
    step(room);
  }
  assert.ok(answer, 'terminal press releases victim control during its own long recovery');
  const burst = setup(); burst.b.energy = 60;
  burst.room.damage(burst.a, burst.b, V5_ATTACKS.heavyDrive, 'heavy', burst.a.x, { variant: 'heavyDrive' });
  send(burst.room, burst.b, 'dash'); step(burst.room);
  assert.equal(burst.b.variant, 'burst'); assert.ok(burst.b.energy < 17); assert.equal(burst.a.variant, 'burstRepelled');
});
