import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { GameAudio } from '../src/audio.js';

function botAt(distance = 3.5, facing = 1) {
  const room = new CombatRoom({ random: () => .25 });
  const enemy = room.addPlayer('Игрок'), bot = room.addPlayer('Бот');
  room.ready(enemy.id); room.ready(bot.id);
  for (let i = 0; i < 181; i++) room.step(1/60);
  bot.x = -distance * facing / 2; enemy.x = distance * facing / 2;
  bot.facing = facing; enemy.facing = -facing;
  bot.bot = true; bot.brainTimer = 0; bot.brainSerial = 1;
  return { room, bot };
}
function choose(room, bot) { room.updateBot(bot, 1/60); return bot.queued; }
function execute(room, bot, choice) { return room.beginAction(bot, choice.action, choice.crouch); }

test('bot selects an affordable bolt instead of an unaffordable mine, including stale crouch intent', () => {
  for (const energy of [25, 30, 34]) {
    const { room, bot } = botAt(); bot.energy = energy; bot.botCrouchTimer = .4;
    const choice = choose(room, bot);
    assert.equal(choice.action, 'special'); assert.equal(choice.crouch, false);
    assert.equal(execute(room, bot, choice), true);
    assert.equal(bot.variant, 'bolt'); assert.equal(bot.energy, energy - 25);
  }
});

test('bot mine selection measures its planted origin and full contact radius in both facings', () => {
  for (const facing of [-1, 1]) for (const distance of [3.5, 4.5, 4.65, 6]) {
    const { room, bot } = botAt(distance, facing); bot.energy = 35; bot.botCrouchTimer = .4;
    const choice = choose(room, bot);
    assert.equal(choice.action, 'special');
    const mineInRange = distance <= 4.55;
    assert.equal(choice.crouch, mineInRange, `distance ${distance}, facing ${facing}`);
    assert.equal(execute(room, bot, choice), true);
    assert.equal(bot.variant, mineInRange ? 'shockwave' : 'bolt');
    assert.equal(bot.energy, mineInRange ? 0 : 10);
  }
});

test('cooling ultimate does not suppress an available bot attack, and ready 80-energy ultimate can fire', () => {
  for (const cooldown of [0, 4]) {
    const { room, bot } = botAt(); bot.energy = 80; bot.cooldowns.ultimate = cooldown;
    const choice = choose(room, bot);
    assert.equal(choice.action, cooldown ? 'special' : 'ultimate');
    assert.equal(execute(room, bot, choice), true);
    assert.equal(bot.action, cooldown ? 'special' : 'ultimate');
  }
});

test('bot defensive burst uses 65 percent of max HP instead of the old absolute 65 HP threshold', () => {
  for (const maximum of [100, 180]) for (const fraction of [.64, .65, .8]) {
    const { room, bot } = botAt(); bot.hp = maximum * fraction; bot.maxHp = maximum;
    bot.energy = 60; bot.action = 'hit'; bot.variant = 'electrified'; bot.actionDuration = .38;
    const choice = choose(room, bot);
    if (fraction < .65) {
      assert.equal(choice.action, 'dash'); assert.equal(execute(room, bot, choice), true);
      assert.equal(bot.variant, 'burst'); assert.equal(bot.energy, 10);
    } else assert.notEqual(choice.action, 'dash');
  }
});

test('hit fault audio follows the same 60/25 percent health bands as robot lights and keeps legacy samples valid', () => {
  function faultTone(hp, maxHp) {
    const tones = [];
    const audio = Object.assign(Object.create(GameAudio.prototype), {
      tone: (...args) => tones.push(args), burst() {}, metal() {},
    });
    audio.play('hit', { damage: 7, targetHp: hp, targetMaxHp: maxHp });
    return tones.find(args => args[2] === 'square')?.[0] ?? null;
  }
  assert.equal(faultTone(109, 180), null);
  assert.equal(faultTone(108, 180), 1650);
  assert.equal(faultTone(46, 180), 1650);
  assert.equal(faultTone(45, 180), 1150);
  assert.equal(faultTone(0, 180), null);
  assert.equal(faultTone(60, undefined), 1650);
  assert.equal(faultTone(25, undefined), 1150);
  assert.equal(faultTone(undefined, undefined), null);
});
