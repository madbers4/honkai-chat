import test from 'node:test';
import assert from 'node:assert/strict';
import { planActionCue, overloadThreat } from '../src/action-cues.js';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, V5_ATTACKS } from '../shared/constants.js';
import { continuation } from '../shared/attack-commitment.js';

function match() {
  const room = new CombatRoom('CUES');
  const a = room.addPlayer('Латунный'), b = room.addPlayer('Искра');
  room.ready(a.id); room.ready(b.id); for (let i = 0; i < 181; i++) room.step(1 / 60);
  a.x = -1; b.x = 1; return { room, a, b };
}
const step = (room, frames) => { for (let i = 0; i < frames; i++) room.step(1 / 60); };
const current = (room, player) => planActionCue(room.snapshot(), player.id);

test('actual heavy contact: no early chain, legal continuation, microstun and then available defense', () => {
  const { room, a, b } = match();
  room.beginAction(a, 'heavy'); step(room, 27);
  assert.equal(b.variant, 'heavyStagger');
  assert.equal(current(room, b), null, 'no fake free block during actual stun');
  assert.notEqual(current(room, a)?.key, 'heavy-chain', 'contact alone does not yet enable cancellation');
  step(room, 8);
  assert.equal(current(room, a)?.target, 'heavy');
  assert.equal(room.beginAction(a, 'heavy'), true, 'highlighted continuation actually executes');
  step(room, 4);
  assert.equal(current(room, b)?.target, 'block');
  b.energy = 100; b.action = 'hit'; b.variant = 'heavyStagger';
  assert.equal(current(room, b)?.key, 'burst', 'paid, available escape takes precedence');
  b.cooldowns.burst = 1; assert.equal(current(room, b), null, 'cooldown never lights the escape button');
});

for (const facing of [-1, 1]) test(`ultimate jump cue corresponds to a real escape across the complete visible window, facing ${facing}`, () => {
  // Exercise both boundaries and intermediate inputs against real gravity and
  // all three pulses. A beautiful cue is useless if the promised jump dies.
  for (const remaining of [.59, .45, .30, .16]) {
    const { room, a, b } = match(); a.x = -2 * facing; b.x = 2 * facing; a.facing = facing; b.facing = -facing; a.energy = 80;
    assert.ok(room.beginAction(a, 'ultimate'));
    while (a.actionTime < ATTACKS.ultimate.startup - remaining) room.step(1 / 60);
    const cue = current(room, b); assert.equal(cue?.key, 'overload-jump'); assert.equal(cue.target, 'jump');
    const hp = b.hp; assert.ok(room.beginAction(b, cue.target));
    for (let i = 0; i < 105; i++) room.step(1 / 60);
    assert.equal(b.hp, hp, `jump at ${remaining}s must clear every pulse`);
  }
});

test('ultimate prompts cover both arena ends but never tell a stunned or airborne player to jump', () => {
  const { room, a, b } = match(); a.action = 'ultimate'; a.actionTime = ATTACKS.ultimate.startup - .40;
  const snapshot = () => room.snapshot();
  assert.equal(current(room, b)?.key, 'overload-jump');
  for (const remaining of [.80, .10, 0]) { a.actionTime = ATTACKS.ultimate.startup - remaining; assert.notEqual(current(room, b)?.key, 'overload-jump'); }
  a.actionTime = ATTACKS.ultimate.startup - .40;
  for (const x of [-10.8, 10.8]) { const state = snapshot(); state.players[1].x = x; assert.equal(planActionCue(state, b.id)?.key, 'overload-jump'); }
  for (const patch of [{ y: .5 }, { action: 'hit' }, { landingRecovery: .1 }, { grabbedBy: a.id }]) {
    const state = snapshot(); Object.assign(state.players[1], patch); assert.notEqual(planActionCue(state, b.id)?.key, 'overload-jump');
  }
  a.action = 'hit'; assert.equal(overloadThreat(snapshot(), b.id), null);
});

test('actual jab contact yields one actionable continuation; expiration and cooldown do not linger', () => {
  const { room, a, b } = match(); room.beginAction(a, 'light'); step(room, 8);
  assert.notEqual(current(room, a)?.key, 'light-chain');
  step(room, 3); const cue = current(room, a);
  assert.deepEqual(cue, current(room, a), 'duplicate packet does not change cue identity');
  assert.equal(cue.target, 'light'); assert.equal(room.beginAction(a, cue.target), true);
  step(room, 120); assert.equal(current(room, a), null);
  b.energy = 49; room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' });
  b.energy = 49; assert.equal(current(room, b), null);
});

test('actual grapple: tech first, two legal pummels then real throw; no button while waiting on a pummel', () => {
  const { room, a, b } = match(); room.beginAction(a, 'heavy', true); step(room, 17);
  assert.equal(b.variant, 'grabbed'); assert.equal(current(room, b)?.key, 'tech');
  assert.equal(current(room, a), null);
  step(room, 15); assert.equal(current(room, b), null);
  assert.equal(current(room, a)?.key, 'pummel');
  assert.equal(room.grabInput(a, 'light'), true); assert.equal(current(room, a), null);
  step(room, 19); assert.equal(current(room, a)?.key, 'pummel');
  assert.equal(room.grabInput(a, 'light'), true);
  assert.equal(current(room, a)?.key, 'throw'); assert.equal(room.grabInput(a, 'heavy'), true);
});

test('phase, pause, missing fighter, KO, disconnected and terminal states suppress all opportunities', () => {
  const { room, a } = match(); a.counterWindow = 1;
  const state = room.snapshot(); assert.equal(planActionCue(state, a.id)?.key, 'counter');
  for (const phase of ['waiting', 'story', 'paused', 'countdown', 'roundEnd', 'finished'])
    assert.equal(planActionCue({ ...state, phase }, a.id), null, phase);
  assert.equal(planActionCue({ ...state, story: { paused: true } }, a.id), null);
  assert.equal(planActionCue(state, 'absent'), null);
  for (const change of [{ hp: 0 }, { connected: false }, { action: 'ko' }, { action: 'recover' }])
    assert.equal(planActionCue({ ...state, players: [{ ...state.players[0], ...change }] }, a.id), null);
});

test('only the eligible winner receives the one finisher target, never the defeated opponent', () => {
  const { room, a, b } = match();
  const state = { ...room.snapshot(), phase: 'finishing', finish: { winner: a.id, stage: 'offer', canTrigger: true, time: 2 } };
  assert.equal(planActionCue(state, a.id)?.key, 'finish'); assert.equal(planActionCue(state, b.id), null);
  state.finish.stage = 'execute'; assert.equal(planActionCue(state, a.id), null);
});

test('pursuit highlights the actual joystick top only at legal grounded launcher cancellation', () => {
  const { room, a } = match();
  const state = room.snapshot(), p = state.players[0];
  Object.assign(p, { action: 'heavy', variant: 'launcher', jumpCancelWindow: .3, actionTime: .25 });
  assert.equal(planActionCue(state, a.id), null);
  p.actionTime = .3; assert.equal(planActionCue(state, a.id)?.target, 'jump');
  p.y = .3; assert.equal(planActionCue(state, a.id), null);
  p.y = 0; p.jumpCancelWindow = 0; assert.equal(planActionCue(state, a.id), null);
});

test('actual launcher exposes a usable pursuit gesture; air-light exhaustion never offers a fake counter', () => {
  const { room, a } = match();
  room.beginAction(a, 'light'); step(room, 11); room.beginAction(a, 'heavy'); step(room, 18);
  assert.ok(room.snapshot().players[0].jumpCancelWindow > 0);
  assert.equal(current(room, a)?.target, 'jump'); assert.equal(room.beginAction(a, 'jump'), true);
  step(room, 6); a.counterWindow = .5; a.airActions = 3;
  assert.equal(current(room, a), null);
});

test('dash first offers the real ram, then dashStrike can continue through its own attack timing', () => {
  const { room, a, b } = match(); a.x = -3.5; b.x = 3.5;
  room.beginAction(a, 'dash'); step(room, 5);
  assert.equal(current(room, a)?.key, 'ram');
  assert.equal(room.beginAction(a, 'light'), true); assert.equal(a.variant, 'dashStrike');
  step(room, 19); assert.equal(current(room, a)?.key, 'light-chain');
  assert.equal(room.beginAction(a, 'light'), true); assert.equal(a.variant, 'cross');
});

for (const action of ['light', 'heavy']) for (const mode of ['whiff', 'block']) {
  test(`${action} ${mode}: cue follows the actual natural link and highlighted button starts the second then terminal move`, () => {
    const { room, a, b } = match();
    if (mode === 'whiff') { a.x = -3.5; b.x = 3.5; }
    const tick = () => {
      if (mode === 'block') room.input(b.id, { seq: b.lastSeq + 1, move: 0, crouch: false, block: true });
      room.step(1 / 60);
    };
    for (let i = 0; i < 15; i++) tick();
    room.beginAction(a, action);
    const chainKey = `${action}-chain`;
    for (let stage = 0; stage < 2; stage++) {
      const open = continuation(a).open;
      let found = false;
      for (let i = 0; i < 80; i++) {
        tick(); const cue = current(room, a);
        if (a.actionTime + .001 < open) assert.notEqual(cue?.key, chainKey, 'buffer advice must not masquerade as immediate execution');
        if (cue?.key === chainKey) {
          assert.equal(cue.target, action);
          assert.equal(room.beginAction(a, cue.target), true, 'cue matches authoritative transition');
          found = true; break;
        }
      }
      assert.ok(found, `stage ${stage + 1}: natural window must be visible`);
    }
    assert.equal(a.variant, action === 'heavy' ? 'heavyPress' : 'rake');
    for (let i = 0; i < 90; i++) { tick(); assert.notEqual(current(room, a)?.key, chainKey, 'terminal recovery never promises a fourth cancellation'); }
    assert.equal(a.combo, 0, 'whiff or block is not a confirmed hit');
  });
}
