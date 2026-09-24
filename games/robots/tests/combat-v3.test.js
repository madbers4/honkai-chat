import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, V3_RULES, canAttemptBurst, canAttemptFeint } from '../shared/constants.js';

function fight(distance = 2.15) {
  const room = new CombatRoom({ random: () => 0.8 });
  room.addPlayer('Один'); room.addPlayer('Два'); room.ready('p1'); room.ready('p2');
  advance(room, 3);
  room.player('p1').x = -distance / 2; room.player('p2').x = distance / 2;
  return room;
}
function input(room, id, patch = {}) {
  return room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...patch });
}
function advance(room, seconds, hold = {}) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    for (const [id, patch] of Object.entries(hold)) input(room, id, patch);
    room.step(1 / 60);
  }
}
function catchTarget(room) {
  input(room, 'p1', { action: 'heavy', crouch: true }); advance(room, 0.29);
  assert.equal(room.player('p1').grabTarget, 'p2');
  assert.equal(room.player('p2').grabbedBy, 'p1');
}
function assertUnpaired(room) {
  for (const player of room.players) {
    assert.equal(player.grabTarget, null); assert.equal(player.grabbedBy, null); assert.equal(player.grabTechWindow, 0);
  }
}

test('grab overrides grounded launcher, catches block/parry and throws once after its tech window', () => {
  const room = fight();
  room.player('p1').launchWindow = 1;
  input(room, 'p1', { action: 'heavy', crouch: true }); advance(room, 0.21);
  assert.equal(room.player('p1').variant, 'grab');
  input(room, 'p2', { block: true }); advance(room, 0.08, { p2: { block: true } });
  const holder = room.player('p1'); const victim = room.player('p2');
  assert.equal(holder.grabTarget, 'p2'); assert.equal(victim.variant, 'grabbed');
  assert.equal(victim.hp, MAX_HP); assert.equal(victim.guard, 100);
  assert.ok(victim.grabTechWindow > 0.2);
  assert.ok(holder.grabCatchTime >= 0.26);
  assert.equal(holder.grabReleaseTime, null);
  const positions = room.players.map(player => player.x);
  advance(room, 0.15);
  assert.deepEqual(room.players.map(player => player.x), positions, 'holding never drags either root');
  assert.equal(victim.hp, MAX_HP);
  input(room, 'p1', { action: 'heavy' }); advance(room, 0.32);
  assertUnpaired(room);
  assert.equal(victim.hp, MAX_HP - 15);
  assert.equal(victim.variant, 'thrown');
  assert.ok(victim.vy > 0);
  assert.ok(holder.grabReleaseTime > holder.grabCatchTime);
  assert.ok(Math.abs(holder.actionDuration - holder.grabReleaseTime - 0.30) < 1e-8);
  advance(room, 0.65);
  assert.equal(victim.hp, MAX_HP - 15);
  assert.equal(room.events.filter(event => event.type === 'throw').length, 1);
  assert.equal(room.events.filter(event => event.type === 'hit' && event.variant === 'grab').length, 1);
});

test('fresh post-catch light breaks the pair, recoils both and grants regrab immunity without damage', () => {
  const room = fight(); catchTarget(room);
  advance(room, 0.10);
  input(room, 'p2', { action: 'light' });
  assertUnpaired(room);
  assert.equal(room.player('p1').variant, 'grabBreak'); assert.equal(room.player('p2').variant, 'grabBreak');
  assert.equal(room.player('p1').vx < 0, true); assert.equal(room.player('p2').vx > 0, true);
  assert.equal(room.player('p2').grabImmunity, V3_RULES.grabImmunity);
  advance(room, 0.6);
  assert.ok(room.players.every(player => player.hp === MAX_HP));
  assert.equal(room.events.filter(event => event.type === 'throw').length, 0);
  const event = room.events.find(event => event.type === 'grabBreak');
  assert.equal(event.player, 'p2'); assert.equal(event.target, 'p1'); assert.equal(event.reason, 'tech');
});

test('a stale queued light or an expired tech press cannot automatically break a grab', () => {
  const stale = fight();
  input(stale, 'p1', { action: 'heavy', crouch: true });
  advance(stale, 0.10);
  input(stale, 'p2', { action: 'heavy' }); advance(stale, 0.15);
  // Start the victim's windup later so the grab catches its planted phase,
  // before the heavy's real hop; the light is already queued before contact.
  input(stale, 'p2', { action: 'light' });
  assert.equal(stale.player('p2').queued?.action, 'light');
  assert.equal(stale.player('p2').grabbedBy, null);
  assert.equal(stale.player('p2').y, 0);
  advance(stale, 0.04);
  assert.equal(stale.player('p2').grabbedBy, 'p1');
  assert.equal(stale.player('p2').queued, null);
  advance(stale, 1.5);
  assert.equal(stale.player('p2').hp, MAX_HP - 15);
  assert.equal(stale.events.filter(event => event.type === 'grabBreak').length, 0);
  const expired = fight(); catchTarget(expired); advance(expired, 0.25);
  assert.equal(expired.player('p2').grabTechWindow, 0);
  input(expired, 'p2', { action: 'light' });
  assert.equal(expired.player('p2').queued, null);
  advance(expired, 1.3);
  assert.equal(expired.player('p2').hp, MAX_HP - 15);
  assert.equal(expired.events.filter(event => event.type === 'grabBreak').length, 0);
});

test('grab can whiff by range, jump or dash and never catches a stunned target at stun recovery', () => {
  for (const escape of ['range', 'jump', 'dash', 'hit']) {
    const room = fight(escape === 'range' ? 3 : 2.15);
    input(room, 'p1', { action: 'heavy', crouch: true });
    if (escape === 'jump') input(room, 'p2', { action: 'jump' });
    if (escape === 'dash') input(room, 'p2', { action: 'dash', move: 1 });
    if (escape === 'hit') room.setAction(room.player('p2'), 'hit', 0.30);
    advance(room, 0.4);
    assertUnpaired(room);
    assert.equal(room.player('p2').hp, MAX_HP, escape);
    assert.equal(room.player('p1').variant, 'grab');
    assert.equal(room.player('p1').actionDuration, 0.95);
    assert.equal(room.events.filter(event => event.type === 'grab').length, 0, escape);
  }
});

test('grab pauses symmetrically on disconnect and resumes without duplicate throw damage', () => {
  const room = fight(); catchTarget(room); advance(room, 0.07);
  const before = room.snapshot();
  room.setConnected('p2', false); advance(room, 5);
  assert.equal(room.player('p2').grabTechWindow.toFixed(3), before.players[1].grabTechWindow.toFixed(3));
  assert.equal(room.player('p1').grabTarget, 'p2'); assert.equal(room.player('p2').grabbedBy, 'p1');
  room.setConnected('p2', true); advance(room, 3);
  assert.equal(room.player('p2').hp, MAX_HP);
  advance(room, 1.5);
  assertUnpaired(room); assert.equal(room.player('p2').hp, MAX_HP - 15);
  assert.equal(room.events.filter(event => event.type === 'throw').length, 1);
  advance(room, 0.3); assert.equal(room.player('p2').hp, MAX_HP - 15);
});

test('a still-open tech window survives reconnect and only a new post-resume input can break it', () => {
  const room = fight(); catchTarget(room);
  room.setConnected('p2', false); advance(room, 2);
  room.setConnected('p2', true);
  input(room, 'p2', { action: 'light' }); // Countdown input is neutralized, not a future tech.
  advance(room, 3);
  assert.equal(room.player('p2').grabbedBy, 'p1');
  input(room, 'p2', { action: 'light' });
  assertUnpaired(room); assert.equal(room.player('p2').hp, MAX_HP);
});

test('interruption, timeout, knockout and round reset clean up both ends of a paired hold', () => {
  const interrupted = fight(); catchTarget(interrupted);
  interrupted.setAction(interrupted.player('p1'), 'hit', 0.4);
  assertUnpaired(interrupted);
  assert.equal(interrupted.player('p2').variant, 'grabBreak');
  advance(interrupted, 0.5); assert.equal(interrupted.player('p2').hp, MAX_HP);
  const timed = fight(); catchTarget(timed); timed.time = 0.001; advance(timed, 0.02);
  assertUnpaired(timed); assert.equal(timed.phase, 'roundOver'); assert.equal(timed.player('p2').hp, MAX_HP);
  const knocked = fight(); catchTarget(knocked); knocked.player('p1').hp = 0; advance(knocked, 0.02);
  assertUnpaired(knocked); assert.equal(knocked.phase, 'roundOver');
  const reset = fight(); catchTarget(reset); reset.startRound();
  assertUnpaired(reset); assert.equal(reset.player('p1').grabHoldTime, 0); assert.equal(reset.player('p1').grabReleaseTime, null);
});

test('grab release and tech at arena walls preserve separation, finite coordinates and ground bounds', () => {
  for (const tech of [true, false]) {
    const room = fight(); room.player('p1').x = 3.50; room.player('p2').x = 5.55;
    catchTarget(room);
    if (tech) input(room, 'p2', { action: 'light' });
    advance(room, 1.8);
    assertUnpaired(room);
    for (const player of room.players) { assert.ok(Number.isFinite(player.x)); assert.ok(Math.abs(player.x) <= 5.55); assert.ok(player.y >= 0); }
    assert.ok(Math.abs(room.player('p2').x - room.player('p1').x) >= 1.999);
  }
});

test('burst escapes normal hitstun for 50 energy, repels without damage and clears nearby enemy projectiles once', () => {
  const room = fight(); const defender = room.player('p2');
  room.setAction(defender, 'hit', 0.6); defender.energy = 80;
  room.player('p1').combo = 3;
  room.projectiles = [
    { id: 10, x: 0, y: 1.35, owner: 'p1', direction: 1, life: 1, speed: 10.5, variant: 'bolt' },
    { id: 11, x: -5, y: 1.35, owner: 'p1', direction: 1, life: 1, speed: 10.5, variant: 'bolt' },
    { id: 12, x: 1, y: 1.35, owner: 'p2', direction: -1, life: 1, speed: 10.5, variant: 'bolt' },
  ];
  input(room, 'p2', { action: 'dash' }); advance(room, 1 / 60);
  assert.equal(defender.variant, 'burst'); assert.equal(defender.action, 'special');
  assert.ok(defender.energy > 30 && defender.energy < 31); assert.equal(defender.cooldowns.burst, 12);
  assert.equal(defender.burstInvulnerable, 0.22);
  assert.equal(room.player('p1').variant, 'burstRepelled'); assert.equal(room.player('p1').hp, MAX_HP);
  assert.equal(room.player('p1').combo, 0);
  assert.deepEqual(room.projectiles.map(projectile => projectile.id), [11, 12]);
  assert.equal(room.damage(room.player('p1'), defender, ATTACKS.light, 'light'), false);
  advance(room, 0.24);
  assert.equal(defender.burstInvulnerable, 0);
  assert.equal(room.damage(room.player('p1'), defender, ATTACKS.light, 'light'), true);
  const before = defender.energy; input(room, 'p2', { action: 'dash' }); advance(room, 0.02);
  assert.notEqual(defender.variant, 'burst'); assert.ok(defender.energy >= before);
  assert.equal(room.events.filter(event => event.type === 'burst').length, 1);
});

test('air burst preserves height/vertical momentum and cannot be used in non-damage recoil or grabbed states', () => {
  const room = fight(); const player = room.player('p2');
  player.y = 1.1; player.vy = 3; player.energy = 75; room.setAction(player, 'hit', 0.5, 'launched');
  input(room, 'p2', { action: 'dash' }); advance(room, 1 / 60);
  assert.equal(player.variant, 'burst'); assert.ok(player.y > 1.1); assert.ok(player.vy > 2);
  for (const variant of ['grabbed', 'grabBreak', 'parried', 'burstRepelled']) {
    assert.equal(canAttemptBurst({ hp: 100, action: 'hit', variant, y: 0 }), false, variant);
  }
  for (const variant of ['', 'launched', 'thrown']) assert.equal(canAttemptBurst({ hp: 100, action: 'hit', variant }), true);
  const held = fight(); catchTarget(held); held.player('p2').energy = 100;
  input(held, 'p2', { action: 'dash' }); advance(held, 0.02);
  assert.equal(held.player('p2').variant, 'grabbed'); assert.equal(held.player('p2').energy, 100);
});

test('insufficient burst resources never grant its immunity, and its cooldown freezes during pause/reset lifecycle', () => {
  const room = fight(); const player = room.player('p2');
  room.setAction(player, 'hit', 0.6); player.energy = 49;
  input(room, 'p2', { action: 'dash' }); advance(room, 0.1);
  assert.equal(player.variant, ''); assert.equal(player.burstInvulnerable, 0); assert.equal(player.cooldowns.burst, 0);
  player.energy = 70; input(room, 'p2', { action: 'dash' }); advance(room, 0.02);
  const cooldown = player.cooldowns.burst; const immune = player.burstInvulnerable;
  room.setConnected('p1', false); advance(room, 2);
  assert.equal(player.cooldowns.burst, cooldown); assert.equal(player.burstInvulnerable, immune);
  room.setConnected('p1', true); advance(room, 3); assert.equal(player.cooldowns.burst, cooldown);
  room.startRound(); assert.equal(player.cooldowns.burst, 0); assert.equal(player.burstInvulnerable, 0);
});

test('early ordinary heavy feints backward for 12 energy and dash cooldown, with no dodge or dash-strike cancel', () => {
  const room = fight(); const player = room.player('p1'); player.energy = 60;
  input(room, 'p1', { action: 'heavy' }); advance(room, 0.12);
  assert.equal(canAttemptFeint(player), true);
  const beforeX = player.x; const beforeEnergy = player.energy;
  input(room, 'p1', { action: 'dash', move: 1 }); advance(room, 0.05);
  assert.equal(player.action, 'dash'); assert.equal(player.variant, 'feint');
  assert.ok(player.x < beforeX); assert.ok(player.energy < beforeEnergy - 11.5);
  assert.ok(player.cooldowns.dash > 1); assert.equal(player.dashFollowWindow, 0);
  input(room, 'p1', { action: 'light' }); advance(room, 0.05);
  assert.equal(player.variant, 'feint', 'cannot use the normal dash-light cancel');
  assert.equal(room.damage(room.player('p2'), player, ATTACKS.light, 'light'), true);
  assert.equal(player.hp, MAX_HP - 7, 'feint has no invulnerability');
});

test('feint denies late startup, insufficient energy/cooldown and every nonordinary heavy variant', () => {
  for (const variant of ['grab', 'launcher', 'slam']) assert.equal(canAttemptFeint({ hp: 100, y: 0, action: 'heavy', variant, actionTime: 0.15 }), false);
  for (const time of [0.05, 0.29, 0.55]) assert.equal(canAttemptFeint({ hp: 100, y: 0, action: 'heavy', variant: '', actionTime: time }), false);
  for (const reason of ['late', 'energy', 'cooldown']) {
    const room = fight(); const player = room.player('p1');
    input(room, 'p1', { action: 'heavy' }); advance(room, reason === 'late' ? 0.31 : 0.12);
    if (reason === 'energy') player.energy = 1;
    if (reason === 'cooldown') player.cooldowns.dash = 1;
    input(room, 'p1', { action: 'dash' }); advance(room, 0.06);
    assert.equal(player.action, 'heavy', reason); assert.equal(player.variant, 'heavyDrive', reason);
  }
});

test('direct hits punish actual missed heavy/grab recovery once, never startup, successful contact, projectile or throw', () => {
  for (const grab of [false, true]) {
    const room = fight(4); const whiffer = room.player('p1'); const defender = room.player('p2');
    input(room, 'p1', { action: 'heavy', crouch: grab }); advance(room, grab ? 0.42 : 0.58);
    assert.equal(room.isWhiffRecovery(whiffer), true);
    whiffer.x = -1.03; defender.x = 1.03;
    input(room, 'p2', { action: 'light' }); advance(room, 0.15);
    assert.equal(whiffer.hp, MAX_HP - 9);
    assert.equal(room.events.filter(event => event.type === 'hit' && event.punish).length, 1);
    room.damage(defender, whiffer, ATTACKS.light, 'light');
    assert.equal(whiffer.hp, MAX_HP - 16); assert.equal(room.events.filter(event => event.type === 'hit' && event.punish).length, 1);
  }
  const startup = fight(); roomDamageInHeavy(startup, 0.10, false); assert.equal(startup.player('p1').hp, MAX_HP - 7);
  const projectile = fight(4); roomDamageInHeavy(projectile, 0.58, true); assert.equal(projectile.player('p1').hp, MAX_HP - 7);
  const blocked = fight(); advance(blocked, 0.2, { p2: { block: true } });
  input(blocked, 'p1', { action: 'heavy' }); advance(blocked, 0.59, { p2: { block: true } });
  assert.equal(blocked.player('p1').attackConnected, true);
  assert.equal(blocked.isWhiffRecovery(blocked.player('p1')), false);
  function roomDamageInHeavy(room, wait, projectile) {
    input(room, 'p1', { action: 'heavy' }); advance(room, wait);
    room.damage(room.player('p2'), room.player('p1'), ATTACKS.light, 'light', room.player('p2').x, { projectile });
  }
});

test('bots occasionally tech after seeing catch, use burst under pressure and choose grabs against held guard', () => {
  const room = fight(); room.random = () => 0.25; room.player('p2').bot = true; room.player('p2').brainTimer = 10;
  catchTarget(room); advance(room, 0.2);
  assertUnpaired(room); assert.ok(room.events.some(event => event.type === 'grabBreak' && event.reason === 'tech'));
  const pressure = fight(); pressure.random = () => 0.25;
  const bot = pressure.player('p2'); bot.bot = true; bot.brainTimer = 0; bot.hp = 50; bot.energy = 80;
  pressure.setAction(bot, 'hit', 0.5); advance(pressure, 0.02); assert.equal(bot.variant, 'burst');
  const blocking = fight(); blocking.random = () => 0.25;
  input(blocking, 'p1', { block: true });
  blocking.player('p2').bot = true; blocking.player('p2').brainTimer = 0;
  advance(blocking, 0.02); assert.equal(blocking.player('p2').variant, 'grab');
});
