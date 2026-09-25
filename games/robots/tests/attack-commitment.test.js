import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, MAX_HP, V5_ATTACKS, VARIANT_ATTACKS } from '../shared/constants.js';
import { comboCue } from '../src/action-context.js';

const send = (r, id, action, extra = {}) => r.input(id, { seq: r.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action, ...extra });
function step(r, n = 1, hold = false) { for (let i = 0; i < n; i++) { if (hold) send(r, 'p2', null, { block: true }); r.step(1 / 60); } }
function fight(distance = 7) {
  const r = new CombatRoom({ random: () => .8 }); r.addPlayer('A'); r.addPlayer('B'); r.ready('p1'); r.ready('p2'); step(r, 181);
  r.player('p1').x = -distance / 2; r.player('p2').x = distance / 2;
  r.log = []; const emit = r.event.bind(r); r.event = (...args) => { emit(...args); r.log.push({ ...r.events.at(-1) }); };
  return r;
}
const attacks = r => r.log.filter(e => e.type === 'attack' && e.player === 'p1');

for (const [action, expected] of [['light', ['jab', 'cross', 'rake']], ['heavy', ['heavyDrive', 'heavyHook', 'heavyPress']]]) {
  for (const mode of ['whiff', 'block']) test(`${action}: quick double tap plus one follow-up produces a complete ${mode} series`, () => {
    const r = fight(mode === 'whiff' ? 7 : 2.3), a = r.player('p1');
    if (mode === 'block') step(r, 15, true);
    send(r, a.id, action); send(r, a.id, action); // Both packets before the next simulation tick.
    step(r, 1, mode === 'block'); assert.equal(a.variant, expected[0]);
    assert.equal(comboCue(r.snapshot().players[0]).open, true, 'early follow-up is a truthful buffered cue');
    let third = false;
    for (let n = 0; n < 190; n++) {
      if (!third && a.variant === expected[1]) { send(r, a.id, action); third = true; }
      step(r, 1, mode === 'block');
    }
    assert.deepEqual(attacks(r).map(e => e.variant), expected);
    assert.equal(r.log.filter(e => e.type === 'hit').length, 0, 'blocks and misses never count as confirmed hits');
    assert.equal(a.combo, 0); assert.equal(a.queued, null); assert.equal(a.followup, null);
    const events = attacks(r);
    for (let n = 1; n < events.length; n++) assert.ok(events[n].at - events[n - 1].at >= V5_ATTACKS[expected[n - 1]].startup + V5_ATTACKS[expected[n - 1]].active);
    if (mode === 'block') assert.equal(r.log.filter(e => e.type === 'block').length, 3);
  });
  test(`${action}: mashing keeps only one follow-up and cannot cancel the terminal recovery`, () => {
    const r = fight(), a = r.player('p1'); send(r, a.id, action); step(r);
    for (let n = 0; n < 20; n++) send(r, a.id, action);
    step(r, 90); assert.equal(attacks(r).length, 2, 'twenty packets are one follow-up, not a stored full series');
    const mash = fight();
    for (let n = 0; n < 270; n++) { send(mash, 'p1', action); step(mash); }
    const events = attacks(mash);
    assert.ok(events.length >= 4);
    for (let n = 1; n < events.length; n++) if (events[n - 1].variant === expected[2]) {
      assert.equal(events[n].variant, expected[0]);
      assert.ok(events[n].at - events[n - 1].at >= V5_ATTACKS[expected[2]].duration, 'ender recovery is never cancelled');
    }
  });
}

test('missed mixed branch is real, but only actual launcher contact creates jump pursuit', () => {
  const r = fight(); send(r, 'p1', 'light'); send(r, 'p1', 'heavy'); step(r, 19);
  assert.equal(r.player('p1').variant, 'launcher'); assert.equal(r.snapshot().players[0].jumpCancelWindow, 0);
  send(r, 'p1', 'jump'); step(r, 15);
  assert.equal(r.player('p1').y, 0); assert.equal(r.player('p1').combo, 0);
  const hit = fight(2.15); send(hit, 'p1', 'light'); step(hit, 11); send(hit, 'p1', 'heavy'); step(hit, 20);
  assert.ok(hit.snapshot().players[0].jumpCancelWindow > 0);
});

test('holding down does not consume two light taps as one or turn them into a grab', () => {
  const r = fight(); send(r, 'p1', 'light', { crouch: true }); send(r, 'p1', 'light', { crouch: true }); step(r, 35);
  assert.deepEqual(attacks(r).map(e => e.variant), ['jab', 'cross']);
  assert.equal(r.player('p1').grabTarget, null);
});

test('parry, interruption and disconnect discard the one pending follow-up', () => {
  for (const reason of ['parry', 'hit', 'disconnect']) {
    const r = fight(2.15), a = r.player('p1'); send(r, a.id, 'heavy'); send(r, a.id, 'heavy'); step(r, 20);
    if (reason === 'parry') { send(r, 'p2', null, { block: true }); step(r, 10, true); assert.equal(a.variant, 'parried'); }
    if (reason === 'hit') r.damage(r.player('p2'), a, V5_ATTACKS.jab, 'light', r.player('p2').x, { variant: 'jab' });
    if (reason === 'disconnect') { r.setConnected('p2', false); step(r, 90); r.setConnected('p2', true); step(r, 181); }
    step(r, 90); assert.equal(attacks(r).length, 1, reason); assert.equal(a.followup, null); assert.equal(a.queued, null);
  }
});

test('paid ultimate takes full jab, heavy and bolt damage without rewinding charge or losing root commitment', () => {
  for (const [kind, variant, attack] of [['light', 'jab', V5_ATTACKS.jab], ['heavy', 'heavyDrive', V5_ATTACKS.heavyDrive], ['special', 'bolt', ATTACKS.special]]) {
    const r = fight(), a = r.player('p1'), b = r.player('p2'); a.energy = 80;
    send(r, a.id, 'ultimate'); step(r, 20); const age = a.actionTime, x = a.x;
    r.damage(b, a, attack, kind, b.x, { variant, projectile: kind === 'special' });
    assert.equal(a.hp, MAX_HP - attack.damage); assert.equal(a.action, 'ultimate'); assert.equal(a.actionTime, age);
    assert.equal(a.defenseOnly, 0); assert.equal(a.vx, 0); assert.equal(a.x, x);
    assert.equal(r.snapshot().players[0].ultimateArmor, true); assert.equal(r.log.at(-1).armored, true);
    step(r, 80); assert.equal(r.log.filter(e => e.type === 'ultimatePulse').length, 3);
    assert.equal(r.snapshot().players[0].ultimateArmor, false, 'post-discharge recovery is vulnerable');
  }
});

test('launch, mine, slam, grab, lethal damage and a late recovery jab interrupt ultimate', () => {
  for (const variant of ['launcher', 'shockwave', 'slam', 'grab', 'lethal', 'recovery']) {
    const r = fight(2.15), a = r.player('p1'), b = r.player('p2'); a.energy = 80;
    send(r, a.id, 'ultimate'); step(r, variant === 'recovery' ? 96 : 15);
    const pulses = r.log.filter(e => e.type === 'ultimatePulse').length;
    if (variant === 'grab') assert.equal(r.tryGrab(b, a), true);
    else {
      if (variant === 'lethal') a.hp = 1;
      const attack = V5_ATTACKS[variant] || VARIANT_ATTACKS[variant] || V5_ATTACKS.jab;
      r.damage(b, a, attack, variant === 'shockwave' ? 'special' : 'heavy', b.x, { variant });
    }
    assert.notEqual(a.action, 'ultimate', variant);
    step(r, 120); assert.equal(r.log.filter(e => e.type === 'ultimatePulse').length, pulses, variant);
    if (variant === 'lethal') { assert.equal(a.hp, 0); assert.equal(r.phase, 'roundOver'); }
  }
});
