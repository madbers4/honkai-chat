import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { ARENA_EDGE, ATTACKS, COMBAT_WINDOWS, VARIANT_ATTACKS } from '../shared/constants.js';

function roomAt(distance = 2.14) {
  const room = new CombatRoom({ random: () => 0.25 });
  room.addPlayer('Один'); room.addPlayer('Два');
  room.ready('p1'); room.ready('p2');
  advance(room, 3);
  room.player('p1').x = -distance / 2;
  room.player('p2').x = distance / 2;
  return room;
}

function input(room, id, patch = {}) {
  room.input(id, { seq: room.player(id).lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...patch });
}

function advance(room, seconds, hold = {}) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    for (const [id, patch] of Object.entries(hold)) input(room, id, patch);
    room.step(1 / 60);
  }
}

test('dash cancels into an advancing, vulnerable claw strike and the follow-up window expires', () => {
  const room = roomAt(4);
  input(room, 'p1', { action: 'dash', move: 1 });
  advance(room, 0.10);
  const beforeX = room.player('p1').x;
  input(room, 'p1', { action: 'light' });
  advance(room, 0.18);
  const attacker = room.player('p1');
  assert.equal(attacker.variant, 'dashStrike');
  assert.ok(attacker.x > beforeX + 0.45);
  assert.equal(room.player('p2').hp, MAX_HP - 11);
  assert.ok(room.damage(room.player('p2'), attacker, ATTACKS.light, 'light'));
  assert.equal(attacker.hp, MAX_HP - 7, 'dash invulnerability ends at the attack cancel');
  const late = roomAt(4);
  input(late, 'p1', { action: 'dash', move: -1 });
  advance(late, 0.53);
  input(late, 'p1', { action: 'light' });
  advance(late, 0.02);
  assert.equal(late.player('p1').variant, 'jab');
  assert.equal(late.player('p1').action, 'light');
});

test('a very early buffered dash follow-up waits for the cancel opening', () => {
  const room = roomAt(4);
  input(room, 'p1', { action: 'dash' });
  advance(room, 1 / 60);
  input(room, 'p1', { action: 'light' });
  advance(room, 0.04);
  assert.equal(room.player('p1').action, 'dash');
  advance(room, 0.05);
  assert.equal(room.player('p1').variant, 'dashStrike');
});

test('a light series opens launcher, but only its real contact supports jump pursuit', () => {
  const room = roomAt();
  input(room, 'p1', { action: 'light' });
  advance(room, 0.14);
  assert.ok(room.player('p1').launchWindow > 0.35);
  input(room, 'p1', { action: 'heavy' });
  advance(room, 0.32);
  assert.equal(room.player('p1').variant, 'launcher');
  assert.equal(room.player('p1').launchWindow, 0);
  assert.equal(room.player('p2').hp, MAX_HP - 17);
  assert.ok(room.player('p2').vy > 7.5);
  input(room, 'p1', { action: 'jump' });
  advance(room, 0.15);
  assert.ok(room.player('p1').y > 0.5);
  input(room, 'p1', { action: 'light' });
  advance(room, 0.18);
  assert.ok(room.player('p2').hp < MAX_HP - 17, 'air follow-up really connects');
  assert.equal(room.events.filter(event => event.type === 'launch').length, 1);
  assert.ok(room.events.some(event => event.type === 'hit' && event.airborne && event.action === 'light'));
  const miss = roomAt(5);
  input(miss, 'p1', { action: 'light' }); advance(miss, 0.4);
  assert.ok(miss.player('p1').launchWindow > 0);
  assert.equal(miss.snapshot().players[0].jumpCancelWindow, 0);
  input(miss, 'p1', { action: 'heavy' }); advance(miss, 0.02);
  assert.equal(miss.player('p1').variant, 'launcher');
  assert.equal(miss.player('p1').jumpCancelWindow, 0);
});

test('air hits scale down and repeated launchers cannot restart gravity within one airborne cycle', () => {
  const room = roomAt();
  const attacker = room.player('p1');
  const target = room.player('p2');
  room.damage(attacker, target, VARIANT_ATTACKS.launcher, 'heavy', attacker.x, { variant: 'launcher' });
  const firstVy = target.vy;
  advance(room, 0.1);
  for (let i = 0; i < 5; i++) {
    const beforeVy = target.vy;
    room.damage(attacker, target, VARIANT_ATTACKS.launcher, 'heavy', attacker.x, { variant: 'launcher' });
    assert.equal(target.vy, beforeVy, 'aerial hit cannot add vertical velocity');
    advance(room, 0.1);
  }
  assert.ok(target.vy < firstVy);
  assert.ok(room.events.filter(event => event.type === 'hit').at(-1).damage < 13);
  assert.equal(room.events.filter(event => event.type === 'launch').length, 1);
  advance(room, 0.3);
  assert.equal(target.y, 0);
  assert.equal(target.airLaunchUsed, false);
  assert.equal(target.airHits, 0);
});

test('air heavy dives and hits exactly once on real landing, exposing landing-relative recovery', () => {
  const room = roomAt();
  input(room, 'p1', { action: 'jump' }); advance(room, 0.24);
  input(room, 'p1', { action: 'heavy' }); advance(room, 0.05);
  assert.equal(room.player('p1').variant, 'slam');
  assert.equal(room.player('p2').hp, MAX_HP);
  assert.equal(room.player('p1').landedTime, null);
  // A higher voluntary jump extends the dive; damage still belongs to actual
  // contact, never an elapsed-time substitute for touching the floor.
  for (let frame = 0; frame < 90 && room.player('p1').y > 0; frame++) {
    assert.equal(room.player('p2').hp, MAX_HP);
    advance(room, 1 / 60);
  }
  const player = room.player('p1');
  assert.equal(player.y, 0);
  assert.equal(room.player('p2').hp, MAX_HP - 28);
  assert.ok(player.landedTime > 0.1);
  assert.ok(Math.abs(player.actionDuration - player.landedTime - VARIANT_ATTACKS.slam.recovery) < 1e-8);
  assert.equal(room.events.filter(event => event.type === 'slam').length, 1);
  advance(room, 0.5);
  assert.equal(room.player('p2').hp, MAX_HP - 28);
  assert.equal(room.events.filter(event => event.type === 'hit' && event.variant === 'slam').length, 1);
});

test('a target above the ground wave of a slam avoids the landing impact', () => {
  const room = roomAt();
  input(room, 'p1', { action: 'jump' }); advance(room, 0.25);
  input(room, 'p1', { action: 'heavy' });
  input(room, 'p2', { action: 'jump' });
  for (let frame = 0; frame < 90 && room.player('p1').y > 0; frame++) advance(room, 1 / 60);
  assert.equal(room.player('p1').y, 0);
  assert.ok(room.player('p2').y > .65, 'the target really is above the ground impact');
  assert.equal(room.player('p2').hp, MAX_HP);
  assert.ok(room.events.some(event => event.type === 'slam'));
});

test('crouch-special latches its mine variant, cannot be ducked, and a jump clears the detonation', () => {
  const crouched = roomAt(2.6);
  input(crouched, 'p1', { action: 'special', crouch: true });
  input(crouched, 'p1', { crouch: false });
  advance(crouched, 0.45, { p2: { crouch: true } });
  assert.equal(crouched.player('p1').variant, 'shockwave');
  const wave = crouched.snapshot().projectiles[0];
  assert.equal(wave.variant, 'shockwave');
  assert.equal(wave.y, VARIANT_ATTACKS.shockwave.height);
  assert.equal(wave.speed, 0, 'the mine stays at its placement point');
  assert.equal(wave.radius, VARIANT_ATTACKS.shockwave.radius);
  assert.ok(wave.age < VARIANT_ATTACKS.shockwave.detonationDelay, 'placement precedes the detonation');
  advance(crouched, 0.4, { p2: { crouch: true } });
  assert.equal(crouched.player('p2').hp, MAX_HP - 42);
  assert.equal(crouched.snapshot().projectiles[0].x, wave.x);
  assert.equal(crouched.player('p2').variant, 'empLift');
  const jumped = roomAt(2.6);
  input(jumped, 'p1', { action: 'special', crouch: true }); advance(jumped, 0.33);
  input(jumped, 'p2', { action: 'jump' }); advance(jumped, 0.48);
  assert.equal(jumped.player('p2').hp, MAX_HP);
});

test('held block protects against an EMP mine after the perfect-parry window has passed', () => {
  const room = roomAt(2.6);
  advance(room, 0.2, { p2: { block: true } });
  input(room, 'p1', { action: 'special', crouch: true });
  advance(room, 0.8, { p2: { block: true } });
  assert.equal(room.player('p2').hp, MAX_HP - 6);
  assert.equal(room.player('p2').guard, 61);
  assert.equal(room.player('p2').y, 0, 'an intact block prevents the mine launch');
  assert.ok(room.events.some(event => event.type === 'block' && event.variant === 'shockwave'));
});

test('fresh directional block parries melee without damage, then awards exactly one stronger counter hit', () => {
  const room = roomAt();
  input(room, 'p1', { action: 'light' });
  input(room, 'p2', { block: true });
  advance(room, 0.14, { p2: { block: true } });
  const defender = room.player('p2');
  assert.equal(defender.hp, MAX_HP);
  assert.equal(defender.guard, 100);
  assert.ok(defender.counterWindow > 1.1);
  assert.ok(defender.energy >= 54);
  assert.equal(room.player('p1').variant, 'parried');
  const parry = room.events.find(event => event.type === 'parry');
  assert.equal(parry.player, 'p2');
  assert.equal(parry.target, 'p1');
  input(room, 'p2', { action: 'light' }); advance(room, 0.18);
  assert.equal(room.player('p1').hp, MAX_HP - 12);
  assert.equal(defender.counterWindow, 0);
  const hit = room.events.find(event => event.type === 'hit' && event.counter);
  assert.equal(hit.damage, 12);
  assert.equal(hit.player, 'p2');
});

test('holding or rapidly toggling block cannot renew a parry, and rear attacks cannot be parried', () => {
  const room = roomAt();
  advance(room, 0.2, { p2: { block: true } });
  assert.equal(room.player('p2').parryWindow, 0);
  input(room, 'p2', { block: false }); input(room, 'p2', { block: true });
  assert.equal(room.player('p2').parryWindow, 0, 'cooldown blocks re-arming by packet toggles');
  advance(room, 0.52, { p2: { block: true } });
  assert.equal(room.player('p2').parryWindow, 0, 'holding past cooldown cannot re-arm');
  input(room, 'p2', { block: false }); input(room, 'p2', { block: true });
  assert.equal(room.player('p2').parryWindow, COMBAT_WINDOWS.parry);
  room.player('p2').facing = 1;
  room.damage(room.player('p1'), room.player('p2'), ATTACKS.light, 'light');
  assert.equal(room.player('p2').hp, MAX_HP - 7);
  assert.equal(room.events.filter(event => event.type === 'parry').length, 0);
});

test('projectiles are consumed by parry without staggering their distant owner', () => {
  const room = roomAt(2.6);
  input(room, 'p1', { action: 'special' }); advance(room, 0.36);
  input(room, 'p2', { block: true }); advance(room, 0.22, { p2: { block: true } });
  assert.equal(room.player('p2').hp, MAX_HP);
  assert.equal(room.player('p2').guard, 100);
  assert.equal(room.projectiles.length, 0);
  assert.equal(room.player('p1').action, 'special');
  assert.ok(room.events.some(event => event.type === 'parry' && event.projectile));
});

test('overload emits exactly three authoritative pulses for 220 unscaled damage and carries its recovery through KO', () => {
  const room = roomAt(4);
  room.player('p1').energy = 100;
  room.player('p1').counterWindow = 1.2;
  input(room, 'p1', { action: 'ultimate' }); advance(room, 0.93);
  assert.equal(room.player('p2').hp, MAX_HP);
  advance(room, 0.04);
  assert.equal(room.player('p2').hp, MAX_HP - 45);
  advance(room, 0.28);
  assert.equal(room.player('p2').hp, MAX_HP - 100);
  advance(room, 0.32);
  assert.equal(room.player('p2').hp, 0);
  const pulses = room.events.filter(event => event.type === 'ultimatePulse');
  assert.deepEqual(pulses.map(event => event.pulse), [0, 1, 2]);
  assert.ok(pulses.every(event => event.facing === 1 && event.range === 5.2 && event.variant === 'overload'));
  assert.equal(new Set(pulses.map(event => event.id)).size, 3);
  assert.deepEqual(room.events.filter(event => event.type === 'hit' && event.variant === 'overload').map(event => event.damage), [45, 55, 120], 'counter windows must not boost overload damage');
  advance(room, 0.4);
  assert.equal(room.player('p2').hp, 0);
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.player('p1').action, 'victory');
  assert.equal(room.player('p1').variant, 'overloadRecovery');
});

test('an ultimate ignores parry and its telegraph allows an early retreat out of pulse range', () => {
  const blocked = roomAt(4);
  blocked.player('p1').energy = 100;
  input(blocked, 'p1', { action: 'ultimate' }); advance(blocked, 0.87);
  input(blocked, 'p2', { block: true }); advance(blocked, 0.10, { p2: { block: true } });
  assert.equal(blocked.player('p2').hp, MAX_HP - 6);
  assert.equal(blocked.player('p2').guard, 80);
  assert.equal(blocked.events.filter(event => event.type === 'parry').length, 0);
  const retreat = roomAt(4);
  retreat.player('p1').energy = 100;
  input(retreat, 'p1', { action: 'ultimate' });
  advance(retreat, 0.18);
  input(retreat, 'p2', { action: 'dash', move: 1 });
  advance(retreat, 1.8, { p2: { move: 1 } });
  assert.equal(retreat.player('p2').hp, MAX_HP);
});

test('disconnect freezes reward windows and pulse progression; resume does not duplicate an already-fired pulse', () => {
  const room = roomAt(4);
  room.player('p1').energy = 100;
  room.player('p1').counterWindow = 2;
  input(room, 'p1', { action: 'ultimate' }); advance(room, 1.03);
  assert.equal(room.player('p2').hp, MAX_HP - 45);
  const remaining = room.player('p1').counterWindow;
  assert.ok(remaining > 0, 'the reward window is genuinely still live before disconnect');
  room.setConnected('p2', false); advance(room, 5);
  assert.equal(room.player('p1').counterWindow, remaining);
  room.setConnected('p2', true); advance(room, 3);
  assert.equal(room.player('p1').counterWindow, remaining);
  advance(room, 0.7);
  assert.equal(room.player('p2').hp, 0);
  assert.deepEqual(room.events.filter(event => event.type === 'ultimatePulse').map(event => event.pulse), [1, 2]);
});

test('training bot chooses low waves and confirmed launch follow-ups from observable state', () => {
  const room = roomAt(4);
  const bot = room.player('p2');
  bot.bot = true; bot.brainTimer = 0; bot.brainSerial = 1;
  advance(room, 0.02);
  assert.equal(bot.variant, 'shockwave');
  const follow = roomAt();
  const fighter = follow.player('p2');
  input(follow, 'p2', { action: 'light' }); advance(follow, 0.18);
  assert.ok(fighter.cancelWindow > 0);
  fighter.bot = true; fighter.brainTimer = 0;
  advance(follow, 0.02);
  assert.equal(fighter.variant, 'launcher');
});

test('extended seeded combat keeps physics, resources, cooldowns and new windows bounded', () => {
  let seed = 48391;
  const room = roomAt();
  room.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  room.players.forEach(player => { player.bot = true; });
  for (let frame = 0; frame < 60 * 750 && room.phase !== 'matchOver'; frame++) {
    room.step(1 / 60);
    for (const player of room.players) {
      for (const key of ['x', 'y', 'vx', 'vy', 'hp', 'guard', 'energy', 'counterWindow', 'launchWindow', 'parryCooldown']) assert.ok(Number.isFinite(player[key]), key);
      assert.ok(player.y >= 0 && player.y < 4.5);
      assert.ok(Math.abs(player.x) <= ARENA_EDGE);
      assert.ok(player.hp >= 0 && player.hp <= MAX_HP);
      assert.ok(player.guard >= 0 && player.guard <= 100);
      assert.ok(player.energy >= 0 && player.energy <= 100);
      assert.ok(player.counterWindow >= 0 && player.launchWindow >= 0 && player.parryCooldown >= 0);
    }
  }
  assert.equal(room.phase, 'matchOver');
});
