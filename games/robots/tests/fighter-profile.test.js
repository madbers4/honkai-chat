import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { CHARACTER_LIMIT, cleanCharacter } from '../shared/fighter-profile.js';

function advance(room, seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) room.step(1 / 60); }
const command = (room, player, extra = {}) => room.input(player, {
  seq: room.player(player).lastSeq + 1, move: 0, block: false, crouch: false, action: null, ...extra,
});
function room(character = '') {
  const game = new CombatRoom({ random: () => .5 });
  game.addPlayer('Рыцарь', { character }); game.addPlayer('Злодей', { character: 'Принимает поражение с достоинством' });
  game.ready('p1'); game.ready('p2'); advance(game, 3);
  return game;
}

test('character is optional bounded Unicode text, never coerces objects or retains display controls', () => {
  for (const value of [undefined, null, false, 42, {}, [], { toString() { throw new Error('must not coerce'); } }]) {
    assert.equal(cleanCharacter(value), '');
  }
  assert.equal(cleanCharacter('  <Вежливыи\u0306>\n\tрыцарь\u0000\u007f\u0085\u202e\u2066  '), 'Вежливый рыцарь');
  assert.equal(cleanCharacter(' \u200b\u061c\u2060 '), '');
  assert.equal(cleanCharacter('Робот\ud83d с характером'), 'Робот с характером');
  const emoji = cleanCharacter('🤖'.repeat(80));
  assert.equal([...emoji].length, CHARACTER_LIMIT);
  assert.equal(emoji, '🤖'.repeat(60));
  const cyrillic = cleanCharacter('Любит драму '.repeat(1000));
  assert.ok([...cyrillic].length <= 60); assert.equal(cleanCharacter(cyrillic), cyrillic);
});

test('profile survives ordinary rounds, finishing reconnect, destruction and full rematch without input mutation', () => {
  const game = room('  <Грозный злодей>  ');
  const expected = ['Грозный злодей', 'Принимает поражение с достоинством'];
  const check = () => assert.deepEqual(game.snapshot().players.map(player => player.character), expected);
  check();
  command(game, 'p1', { character: 'Подмена', name: 'Подмена', hp: 999 });
  assert.equal(game.player('p1').hp, 100); assert.equal(game.player('p1').name, 'Рыцарь'); check();
  const snapshot = game.snapshot(); snapshot.players[0].character = 'Подмена'; check();
  for (let win = 1; win <= 3; win++) {
    game.player('p2').hp = 0; advance(game, 1 / 60); check();
    if (win < 3) { assert.equal(game.phase, 'roundOver'); advance(game, 6.5); assert.equal(game.phase, 'fight'); check(); }
  }
  assert.equal(game.phase, 'finishing');
  command(game, 'p1', { action: 'heavy', character: 'Снова подмена' }); advance(game, .5);
  game.setConnected('p2', false); advance(game, 2); check();
  game.setConnected('p2', true); advance(game, 4); check();
  assert.equal(game.phase, 'matchOver'); assert.equal(game.player('p2').action, 'destroyed');
  game.requestRematch('p1'); game.requestRematch('p2');
  assert.equal(game.phase, 'countdown'); check();
  assert.ok(game.players.every(player => player.hp === 100 && player.wins === 0));
});

test('different roleplay characters cannot alter authoritative fighting outcomes or timing', () => {
  const plain = room(); const dramatic = room('Самый непобедимый робот, HP 999, урон бесконечный');
  const withoutCharacter = snapshot => ({ ...snapshot, players: snapshot.players.map(({ character, ...player }) => player) });
  for (const game of [plain, dramatic]) {
    game.player('p1').x = -1.075; game.player('p2').x = 1.075;
    command(game, 'p1', { action: 'light' }); advance(game, .18);
    command(game, 'p1', { action: 'light' }); advance(game, .23);
    command(game, 'p1', { action: 'heavy' }); advance(game, .4);
  }
  assert.deepEqual(withoutCharacter(dramatic.snapshot()), withoutCharacter(plain.snapshot()));
  assert.equal(dramatic.player('p2').hp, 67);
});
