import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ARENA_EDGE, FINISH_RULES, V5_ATTACKS, V5_RULES, canAttemptAirDash } from '../shared/constants.js';

const input = (room, id, patch = {}) => room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...patch });
function advance(room, seconds, hold = {}) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    for (const [id, patch] of Object.entries(hold)) input(room, id, patch);
    room.step(1 / 60);
  }
}
function fight(distance = 2.15) {
  const room = new CombatRoom({ random: () => 0.8 });
  room.addPlayer('Один'); room.addPlayer('Два'); room.ready('p1'); room.ready('p2');
  advance(room, 3);
  room.player('p1').x = -distance / 2; room.player('p2').x = distance / 2;
  // Collect events beyond the production snapshot's bounded history.
  room.log = [];
  const emit = room.event.bind(room);
  room.event = (...args) => { emit(...args); room.log.push({ ...room.events.at(-1) }); };
  return room;
}
function press(room, action, seconds, extra = {}) { input(room, 'p1', { action, ...extra }); advance(room, seconds); }
function grab(room) { press(room, 'heavy', 0.29, { crouch: true }); assert.equal(room.player('p1').grabTarget, 'p2'); }
function offer(room = fight()) { room.player('p1').wins = 2; room.player('p2').hp = 0; advance(room, 1 / 60); assert.equal(room.phase, 'finishing'); return room; }
const variants = room => room.log.filter(event => event.type === 'hit').map(event => event.variant);

test('real ground inputs branch jab-cross-rake and jab-cross-crusher with distinct physical steps', () => {
  for (const ender of ['light', 'heavy']) {
    const room = fight(); const start = room.player('p1').x;
    press(room, 'light', 0.18);
    assert.equal(room.player('p1').variant, 'jab');
    assert.ok(room.player('p1').cancelWindow > 0);
    press(room, 'light', 0.23);
    assert.equal(room.player('p1').variant, 'cross');
    press(room, ender, 0.40);
    const variant = ender === 'light' ? 'rake' : 'crusher';
    assert.deepEqual(variants(room), ['jab', 'cross', variant]);
    assert.equal(room.player('p2').hp, ender === 'light' ? 74 : 67);
    assert.equal(room.player('p1').comboRoute, `jab-cross-${variant}`);
    assert.equal(room.player('p1').combo, 3);
    assert.ok(room.player('p1').x > start + 0.4, 'steps move authoritative roots without test repositioning');
    assert.equal(room.player('p1').cancelWindow, 0, 'ender has no free cancel');
    const attacks = room.log.filter(event => event.type === 'attack');
    for (const event of attacks) assert.equal(event.active, V5_ATTACKS[event.variant].active);
  }
});

test('missed or blocked jab cannot manufacture a branch or bypass its recovery', () => {
  for (const blocked of [false, true]) {
    const room = fight(blocked ? 2.15 : 4);
    if (blocked) advance(room, 0.2, { p2: { block: true } });
    input(room, 'p1', { action: 'light' }); advance(room, 0.17, blocked ? { p2: { block: true } } : {});
    assert.equal(room.player('p1').cancelWindow, 0);
    input(room, 'p1', { action: 'heavy' }); advance(room, 0.17, blocked ? { p2: { block: true } } : {});
    assert.equal(room.player('p1').variant, 'jab', 'failed jab still recovers');
    advance(room, 0.1, blocked ? { p2: { block: true } } : {});
    assert.equal(room.player('p1').action, 'heavy');
    assert.equal(room.player('p1').variant, 'heavyDrive', 'buffer starts a fresh heavy route after full recovery');
    assert.equal(room.player('p2').hp, 100);
  }
});

test('input buffered before jab contact waits for hit confirm and minimum cancel age', () => {
  const room = fight(); press(room, 'light', 0.07);
  input(room, 'p1', { action: 'light' }); advance(room, 0.07);
  assert.equal(room.player('p1').variant, 'jab');
  advance(room, 0.04);
  assert.equal(room.player('p1').variant, 'cross');
  assert.equal(room.log.filter(event => event.type === 'attack').length, 2);
});

test('launcher pursuit supports the three distinct airborne attacks without resetting gravity', () => {
  const room = fight();
  press(room, 'light', 0.18); press(room, 'heavy', 0.31);
  assert.equal(room.player('p1').variant, 'launcher'); assert.ok(room.player('p2').y > 0);
  press(room, 'jump', 0.10);
  assert.ok(room.player('p1').y > 0.5);
  press(room, 'light', 0.16);
  assert.equal(room.player('p1').variant, 'airJab');
  const afterJabVy = room.player('p2').vy;
  press(room, 'light', 0.18);
  assert.equal(room.player('p1').variant, 'airCross'); assert.ok(room.player('p2').vy < afterJabVy);
  press(room, 'light', 0.20);
  assert.equal(room.player('p1').variant, 'airFinish');
  assert.deepEqual(variants(room), ['jab', 'launcher', 'airJab', 'airCross', 'airFinish']);
  assert.ok(room.player('p2').vy <= -V5_ATTACKS.airFinish.downwardSpeed || room.player('p2').y === 0);
  assert.equal(room.player('p1').airActions, 3);
  advance(room, 0.6);
  assert.ok(room.players.every(player => player.y === 0));
  assert.equal(room.player('p1').airActions, 0);
});

test('one zero-energy air dash shares dash cooldown, preserves gravity, and never grants dodge immunity', () => {
  const room = fight(5); const player = room.player('p1');
  press(room, 'jump', 0.15); player.energy = 0;
  assert.equal(canAttemptAirDash(player), true);
  const beforeY = player.y; const beforeVy = player.vy;
  press(room, 'dash', 0.08, { move: 1 });
  assert.equal(player.variant, 'airDash'); assert.equal(player.airDashUsed, true);
  assert.ok(player.vy < beforeVy); assert.ok(player.y > beforeY); assert.equal(room.isInvulnerable(player), false);
  advance(room, 0.12); player.cooldowns.dash = 0;
  assert.equal(canAttemptAirDash(player), false, 'usage cap remains even when cooldown is cleared');
  press(room, 'dash', 0.05); assert.notEqual(player.variant, 'airDash');
  advance(room, 0.6); assert.equal(player.y, 0); assert.equal(player.airDashUsed, false);
  const cooldown = fight(); press(cooldown, 'jump', 0.1); cooldown.player('p1').cooldowns.dash = 0.7;
  press(cooldown, 'dash', 0.05); assert.equal(cooldown.player('p1').airDashUsed, false);
});

test('air attacks cannot hover, repeated missed lights obey budget, and landing has real recovery', () => {
  const room = fight(5); const player = room.player('p1');
  press(room, 'jump', 0.12);
  for (let i = 0; i < 30; i++) { input(room, 'p1', { action: 'light' }); room.step(1 / 60); }
  assert.ok(player.airActions <= 3);
  while (player.y > 0) room.step(1 / 60);
  assert.equal(player.landingRecovery, V5_RULES.landingRecovery);
  const attacks = room.log.filter(event => event.type === 'attack').length;
  input(room, 'p1', { action: 'heavy' }); advance(room, 0.10);
  assert.equal(room.log.filter(event => event.type === 'attack').length, attacks);
  advance(room, 0.3); assert.equal(player.y, 0);
});

test('two deliberate pummels use distinct impact timestamps followed by a requested throw', () => {
  const room = fight(); grab(room); const attacker = room.player('p1'); const target = room.player('p2');
  const roots = room.players.map(player => player.x);
  input(room, 'p1', { action: 'light' }); advance(room, 0.24);
  assert.equal(attacker.grabStrikes, 0, 'early press cannot buffer through tech window');
  for (let strike = 1; strike <= 2; strike++) {
    input(room, 'p1', { action: 'light' }); advance(room, 0.10);
    assert.equal(target.hp, 100 - (strike - 1) * 4);
    assert.equal(attacker.grabStrikeTime, target.grabStrikeTime);
    advance(room, 0.04); assert.equal(target.hp, 100 - strike * 4);
    input(room, 'p1', { action: 'light' }); advance(room, 0.17);
    assert.equal(attacker.grabStrikes, strike, 'press during strike does not queue another');
  }
  input(room, 'p1', { action: 'light' }); assert.equal(attacker.grabStrikes, 2);
  assert.deepEqual(room.players.map(player => player.x), roots, 'pummels do not drag roots');
  input(room, 'p1', { action: 'heavy' }); advance(room, 0.15);
  assert.equal(target.hp, 92); assert.equal(attacker.grabTarget, 'p2');
  advance(room, 0.09);
  assert.equal(target.hp, 77); assert.equal(target.variant, 'thrown'); assert.equal(attacker.grabTarget, null);
  assert.equal(room.log.filter(event => event.type === 'grabStrike').length, 2);
  assert.equal(room.log.filter(event => event.type === 'throw').length, 1);
  assert.equal(room.log.filter(event => event.type === 'hit').length, 1, 'pummel effects do not duplicate hit effects');
});

test('early fresh tech wins over a throw request, expired tech cannot escape, idle hold is bounded', () => {
  const tech = fight(); grab(tech);
  input(tech, 'p1', { action: 'heavy' }); input(tech, 'p2', { action: 'light' }); advance(tech, 1.8);
  assert.equal(tech.player('p2').hp, 100); assert.equal(tech.log.filter(event => event.type === 'throw').length, 0);
  const idle = fight(); grab(idle); advance(idle, 0.25);
  input(idle, 'p2', { action: 'light' }); advance(idle, 1.3);
  assert.equal(idle.player('p2').hp, 85); assert.equal(idle.player('p1').grabTarget, null);
  assert.equal(idle.log.filter(event => event.type === 'throw').length, 1);
});

test('back throw travels over the holder without root teleport and both wall cases remain bounded', () => {
  for (const edge of [0, ARENA_EDGE - 2.15, -ARENA_EDGE]) {
    const room = fight(); const attacker = room.player('p1'); const target = room.player('p2');
    attacker.x = edge; target.x = edge + 2.15;
    grab(room); advance(room, 0.25);
    input(room, 'p1', { action: 'heavy', move: -1 }); advance(room, 0.24);
    assert.equal(target.throwStyle, 'back'); assert.equal(target.vx, 0, 'initial lift clears the holder before horizontal travel');
    let previousX = target.x;
    let crossed = false;
    for (let frame = 0; frame < 90; frame++) {
      room.step(1 / 60);
      assert.ok(Math.abs(target.x - previousX) < 0.6, 'ballistic travel has no side-swap teleport'); previousX = target.x;
      assert.ok(room.players.every(player => Math.abs(player.x) <= ARENA_EDGE && Number.isFinite(player.y)));
      if (!crossed && target.x < attacker.x) {
        crossed = true; assert.ok(target.y > 2.4, 'the real beetle clears the holder when crossing overhead');
      }
    }
    assert.equal(crossed, true);
    assert.equal(target.y, 0); assert.ok(target.x < attacker.x, 'back throw changes sides');
    assert.ok(attacker.x - target.x >= 1.999);
  }
});

test('pummel impact and throw windup both freeze across disconnect and resume exactly once', () => {
  for (const during of ['strike', 'throw']) {
    const room = fight(); grab(room); advance(room, 0.25);
    input(room, 'p1', { action: during === 'strike' ? 'light' : 'heavy' }); advance(room, 0.08);
    const before = room.snapshot().players;
    room.setConnected('p2', false); advance(room, 4); room.setConnected('p2', true); advance(room, 3);
    assert.equal(room.player('p1').grabStrikeTime, before[0].grabStrikeTime);
    assert.equal(room.player('p1').grabThrowTime, before[0].grabThrowTime);
    advance(room, 1.8);
    assert.equal(room.player('p2').hp, during === 'strike' ? 81 : 85);
    assert.equal(room.log.filter(event => event.type === 'throw').length, 1);
    assert.equal(room.log.filter(event => event.type === 'grabStrike').length, during === 'strike' ? 1 : 0);
  }
});

test('ordinary knockout shuts down then visibly recovers next countdown; reconnect does not reboot', () => {
  const room = fight(); room.player('p2').hp = 0; advance(room, 0.02);
  assert.equal(room.player('p2').action, 'ko'); assert.equal(room.player('p1').wins, 1);
  advance(room, 3.42); assert.equal(room.phase, 'countdown'); assert.equal(room.player('p2').action, 'recover');
  assert.equal(room.player('p2').actionDuration, 1.6); assert.equal(room.player('p2').hp, 100);
  advance(room, 0.7); assert.ok(room.player('p2').actionTime > 0.65);
  room.setConnected('p2', false); const age = room.player('p2').actionTime; advance(room, 2);
  assert.equal(room.player('p2').actionTime, age); room.setConnected('p2', true); advance(room, 2.5);
  assert.equal(room.phase, 'fight'); press(room, 'heavy', 0.1);
  room.setConnected('p2', false); const actionAge = room.player('p1').actionTime;
  room.setConnected('p2', true); advance(room, 3);
  assert.equal(room.player('p1').action, 'heavy'); assert.equal(room.player('p1').actionTime, actionAge);
});

test('manual finisher stages real roots, emits exactly-once impacts, delays results and resets on rematch', () => {
  const room = offer(fight(8));
  assert.equal(room.player('p1').wins, 3); assert.equal(room.finish.stage, 'offer');
  input(room, 'p2', { action: 'heavy' }); assert.equal(room.finish.stage, 'offer');
  input(room, 'p1', { action: 'ultimate' }); assert.equal(room.finish.type, 'coreRip');
  assert.equal(room.log.at(-1).type, 'finisherStart');
  advance(room, 0.5); assert.ok(Math.abs(Math.abs(room.player('p1').x - room.player('p2').x) - 2.1) < 1e-8);
  assert.equal(room.player('p1').action, 'finisher'); assert.equal(room.player('p2').action, 'defeated');
  advance(room, 0.70); assert.equal(room.log.filter(event => event.type === 'finisherImpact').length, 0);
  advance(room, 0.10); assert.equal(room.log.filter(event => event.type === 'finisherImpact').length, 1);
  advance(room, 0.9); assert.equal(room.player('p2').action, 'destroyed'); assert.equal(room.phase, 'finishing');
  assert.ok(room.player('p2').destructionTime >= 0);
  advance(room, 1.6); assert.equal(room.phase, 'matchOver');
  for (const type of ['finisherStart', 'finisherImpact', 'destruction']) {
    const events = room.log.filter(event => event.type === type); assert.equal(events.length, 1);
    assert.equal(events[0].player, 'p1'); assert.equal(events[0].target, 'p2'); assert.equal(events[0].variant, 'coreRip');
  }
  room.requestRematch('p1'); room.requestRematch('p2');
  assert.equal(room.finish, null); assert.equal(room.finishMotion, null); assert.equal(room.phase, 'countdown');
  assert.ok(room.players.every(player => player.destructionTime === null && player.wins === 0 && player.action === 'recover'));
});

test('offer timeout chooses overload, a killing actual three-hit route earns brutality, bot accepts deliberately', () => {
  const automatic = offer(); advance(automatic, FINISH_RULES.offerDuration);
  assert.equal(automatic.finish.stage, 'execute'); assert.equal(automatic.finish.type, 'overload');
  const earned = fight(); earned.player('p1').wins = 2; earned.player('p2').hp = 26;
  press(earned, 'light', 0.18); press(earned, 'light', 0.23); press(earned, 'light', 0.30);
  assert.equal(earned.phase, 'finishing'); assert.equal(earned.finish.type, 'brutality'); assert.equal(earned.finish.stage, 'execute');
  const bot = offer(); bot.player('p1').bot = true; advance(bot, 0.80); assert.equal(bot.finish.stage, 'offer');
  advance(bot, 0.1); assert.equal(bot.finish.stage, 'execute'); assert.equal(bot.finish.type, 'coreRip');
});

test('offer, seize, impact and post-destruction pause resume without duplicated final events', () => {
  for (const pauseAt of [0, 0.9, 1.5, 2.4]) {
    const room = offer();
    if (pauseAt > 0) { input(room, 'p1', { action: 'heavy' }); advance(room, pauseAt); }
    room.setConnected('p2', false); const before = room.snapshot(); advance(room, 5);
    const frozen = room.snapshot();
    assert.deepEqual(frozen.finish, before.finish); assert.deepEqual(frozen.players, before.players);
    room.setConnected('p2', true); assert.equal(room.phase, 'finishing'); advance(room, 8);
    assert.equal(room.phase, 'matchOver');
    for (const type of ['finisherStart', 'finisherImpact', 'destruction']) assert.equal(room.log.filter(event => event.type === type).length, 1, `${pauseAt}: ${type}`);
  }
});

test('bots demonstrate every real ground route and the pursuit string from their own hit confirm', () => {
  for (const [choice, expected] of [
    [0.25, ['jab', 'launcher', 'airJab', 'airCross', 'airFinish']],
    [0.4, ['jab', 'cross', 'crusher']],
    [0.65, ['jab', 'cross', 'rake']],
  ]) {
    const room = fight(); room.random = () => choice;
    press(room, 'light', 0.18);
    room.player('p1').bot = true; room.player('p1').brainTimer = 0;
    advance(room, 1.5);
    assert.deepEqual(variants(room).slice(0, expected.length), expected);
  }
  const holder = fight(); grab(holder); holder.player('p1').bot = true;
  advance(holder, 1.4);
  assert.equal(holder.log.filter(event => event.type === 'grabStrike').length, 2);
  assert.equal(holder.log.filter(event => event.type === 'throw').length, 1);
});

test('confirmed heavy branches can still miss, incur full recovery and be punished', () => {
  for (const variant of ['launcher', 'crusher']) {
    const room = fight(); press(room, 'light', 0.18);
    if (variant === 'crusher') press(room, 'light', 0.23);
    input(room, 'p1', { action: 'heavy' });
    // A confirmed branch is not an unavoidable scripted hit: the defender leaves range.
    room.player('p2').x = 5;
    advance(room, V5_ATTACKS[variant].startup + V5_ATTACKS[variant].active + 0.08);
    assert.equal(room.player('p1').variant, variant);
    assert.equal(room.isWhiffRecovery(room.player('p1')), true);
    room.player('p2').x = room.player('p1').x + 2.1;
    input(room, 'p2', { action: 'light' }); advance(room, 0.15);
    assert.equal(room.player('p1').hp, 91);
    assert.equal(room.log.filter(event => event.type === 'hit' && event.punish).length, 1);
    assert.equal(room.player('p1').cancelWindow, 0);
  }
});
