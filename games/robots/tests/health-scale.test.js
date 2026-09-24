import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import { healthFraction } from '../shared/health.js';
import { robotPresentation } from '../shared/robot-presentation.js';

test('180-point health survives snapshots, round resets and rematches without changing percentage signals', () => {
  const room = new CombatRoom(); room.addPlayer('A'); room.addPlayer('B');
  room.ready('p1'); room.ready('p2');
  assert.equal(MAX_HP, 180); assert.equal(WINS_TO_MATCH, 5);
  assert.ok(room.snapshot().players.every(p => p.hp === 180 && p.maxHp === 180));
  for (const fraction of [1, .61, .60, .26, .25, .01, 0]) {
    const actual = { hp: MAX_HP * fraction, maxHp: MAX_HP };
    assert.ok(Math.abs(healthFraction(actual) - fraction) < 1e-10);
    assert.equal(robotPresentation(actual).healthBand, robotPresentation({ hp: fraction * 100 }).healthBand);
  }
  room.player('p1').hp = 4; room.startRound();
  assert.equal(room.player('p1').hp, MAX_HP);
  room.phase = 'matchOver'; room.requestRematch('p1'); room.requestRematch('p2');
  assert.ok(room.snapshot().players.every(p => p.hp === MAX_HP && p.maxHp === MAX_HP && p.wins === 0));
});
