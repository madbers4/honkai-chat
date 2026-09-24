// Reproducible training-bot stress sample, not a claim about human win rates.
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { MAX_HP, WINS_TO_MATCH, ROUND_SECONDS } from '../shared/constants.js';

const count = Math.max(1, Math.min(100, Number(process.argv[2]) || 24));
const sample = [];
const damage = {}, uses = {};
for (let trial = 0; trial < count; trial++) {
  let seed = 48391 + trial * 7919;
  const room = new CombatRoom({ random: () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  } });
  room.addPlayer('A', { bot: true }); room.addPlayer('B', { bot: true });
  room.startRound();
  let lastEvent = 0, fightSeconds = 0, rounds = 0;
  for (let frame = 0; frame < 60 * ROUND_SECONDS * WINS_TO_MATCH * 3 && room.phase !== 'matchOver'; frame++) {
    if (room.phase === 'fight') fightSeconds += 1 / 60;
    room.step(1 / 60);
    for (const player of room.players) {
      for (const key of ['x', 'y', 'vx', 'vy', 'hp', 'energy', 'guard']) assert.ok(Number.isFinite(player[key]), `${trial}: ${key}`);
      assert.ok(player.hp >= 0 && player.hp <= MAX_HP);
      assert.ok(player.y >= 0 && player.y < 4.5);
      assert.ok(player.energy >= 0 && player.energy <= 100);
    }
    for (const event of room.events) {
      if (event.id <= lastEvent) continue;
      lastEvent = event.id;
      if (event.type === 'round' && event.fight) rounds++;
      if (['attack', 'special', 'ultimate'].includes(event.type)) {
        const kind = event.variant || event.action || event.type;
        uses[kind] = (uses[kind] || 0) + 1;
      }
      if (event.type === 'hit') {
        const kind = event.variant || event.action;
        const bucket = damage[kind] ||= { hits: 0, total: 0 };
        bucket.hits++; bucket.total += event.damage;
      }
    }
  }
  assert.equal(room.phase, 'matchOver', `Seed ${trial} failed to finish`);
  assert.equal(Math.max(...room.players.map(p => p.wins)), WINS_TO_MATCH);
  sample.push({ seed: 48391 + trial * 7919, seconds: Math.round(room.elapsed), rounds,
    fightSeconds: Math.round(fightSeconds), score: room.players.map(p => p.wins), winner: room.winner });
}
const totalRounds = sample.reduce((n, s) => n + s.rounds, 0);
console.log(JSON.stringify({ note: 'Deterministic training bots; human balance requires playtesting.',
  matches: count, totalRounds, averageFightSecondsPerRound: +(sample.reduce((n, s) => n + s.fightSeconds, 0) / totalRounds).toFixed(1),
  averageMatchSeconds: +(sample.reduce((n, s) => n + s.seconds, 0) / count).toFixed(1),
  uses, damage, sample }, null, 2));
