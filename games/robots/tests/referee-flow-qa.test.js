import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { CombatRoom } from '../server/combat.js';
import { ATTACKS, VARIANT_ATTACKS, V5_ATTACKS, WINS_TO_MATCH, COUNTDOWN_SECONDS } from '../shared/constants.js';
import { RULE_CARDS, formatClubText } from '../shared/club-story.js';
import { refereeRuleDuration, REFEREE_RECONNECT_GRACE } from '../shared/referee-round.js';
import { createRefereeDirector, buildRefereeRoundLead } from '../shared/referee-director.js';
import { REFEREE_LINES } from '../shared/referee-lines.js';

let pingSerial = 0;
const kind = type => packet => packet.type === type;
async function connect(app) {
  const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`), pending = [], transcript = [];
  socket.on('message', data => {
    const packet = JSON.parse(data); pending.push(packet); transcript.push(packet);
    if (packet.type === 'state') socket.latest = packet.state;
  });
  await once(socket, 'open');
  socket.transcript = transcript;
  socket.sendPacket = packet => socket.send(JSON.stringify(packet));
  socket.take = async predicate => {
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      const index = pending.findIndex(predicate);
      if (index >= 0) return pending.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw Error(`Missing packet: ${predicate}`);
  };
  socket.sync = async () => {
    const t = ++pingSerial; socket.sendPacket({ type: 'ping', t });
    await socket.take(packet => packet.type === 'pong' && packet.t === t);
    return socket.latest;
  };
  return socket;
}
async function advance(app, room, observer, seconds) {
  for (let n = 0; n < Math.ceil(seconds * 10 - 1e-8); n++) {
    app.tick(Math.min(.1, seconds - n * .1));
    if (n % 20 === 19) await new Promise(resolve => setImmediate(resolve));
  }
  await new Promise(resolve => setImmediate(resolve));
  app.broadcast(room); return observer.sync();
}
function privateKeys(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(['token', 'favorite', 'favored', 'opposed'].includes(key) ? [key] : []), ...privateKeys(child),
  ]);
}

test('wire flow gates five wins and a rematch separately, keeps every public packet private, and releases an absent referee', async t => {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false }); t.after(() => app.close());
  const one = await connect(app); one.sendPacket({ type: 'create', storyMode: true, name: 'Сом' });
  const a = await one.take(kind('welcome'));
  const two = await connect(app); two.sendPacket({ type: 'join', room: a.room, name: 'Чайник' });
  const b = await two.take(kind('welcome'));
  const ref = await connect(app); ref.sendPacket({ type: 'watch', room: a.room, preparing: true });
  const credentials = await ref.take(kind('refereeWelcome'));
  ref.sendPacket({ type: 'refereeFavorite', favorite: 'p2' }); ref.sendPacket({ type: 'refereeReady' });
  await ref.take(packet => packet.type === 'refereeState' && packet.prepared);
  one.sendPacket({ type: 'ready' }); two.sendPacket({ type: 'ready' });
  await one.take(packet => packet.type === 'state' && packet.state.story.stage === 'rules');
  const room = app.rooms.get(a.room);
  for (let i = 0; i < RULE_CARDS.length; i++) await advance(app, room, one, refereeRuleDuration(i, room.game.players));
  await advance(app, room, one, room.story.faceoffDuration);
  const gateIds = new Set(); let previousGate = 'not-a-round'; let seq = 0;
  for (let round = 1; round <= WINS_TO_MATCH; round++) {
    let state = await advance(app, room, one, room.story.roundIntro.duration + .01);
    assert.equal(state.story.stage, 'refereeIntro'); assert.equal(state.round, round);
    const gate = state.story.refereeIntro.sequenceId;
    assert.ok(!gateIds.has(gate)); gateIds.add(gate);
    assert.ok(buildRefereeRoundLead(state, 'p2').includes('«Чайник»'));
    const timer = state.time;
    ref.sendPacket({ type: 'refereeStartRound', sequenceId: previousGate }); await ref.take(kind('notice'));
    one.sendPacket({ type: 'refereeStartRound', sequenceId: gate }); await one.take(kind('error'));
    state = await advance(app, room, one, 14);
    assert.equal(state.story.refereeIntro.sequenceId, gate); assert.equal(state.time, timer);
    assert.equal(state.countdown, COUNTDOWN_SECONDS);
    ref.sendPacket({ type: 'refereeStartRound', sequenceId: gate }); await ref.sync();
    state = await advance(app, room, one, 1);
    const countdown = room.game.countdown;
    ref.sendPacket({ type: 'refereeStartRound', sequenceId: gate }); await ref.take(kind('notice'));
    assert.equal(room.game.countdown, countdown, 'duplicate launch cannot restart countdown');
    state = await advance(app, room, one, 2); assert.equal(state.phase, 'fight');
    one.sendPacket({ type: 'input', seq: seq++, move: 0, block: false, crouch: false, action: 'special' }); await one.sync();
    state = await advance(app, room, one, 1);
    assert.ok(state.players[0].hp > state.players[1].hp, 'real projectile establishes the winner without editing HP');
    state = await advance(app, room, one, state.time + .1);
    assert.equal(state.players[0].wins, round); previousGate = gate;
    if (round < WINS_TO_MATCH) await advance(app, room, one, 3.5);
  }
  let state = await advance(app, room, one, 8); assert.equal(state.phase, 'matchOver');
  one.sendPacket({ type: 'rematch' }); two.sendPacket({ type: 'rematch' }); await two.sync(); await one.sync();
  state = await advance(app, room, one, room.story.roundIntro.duration + .01);
  assert.equal(state.story.stage, 'refereeIntro'); assert.equal(state.story.refereeIntro.matchSerial, 1);
  assert.equal(state.round, 1); assert.ok(!gateIds.has(state.story.refereeIntro.sequenceId));
  ref.sendPacket({ type: 'refereeStartRound', sequenceId: previousGate }); await ref.take(kind('notice'));
  state = await advance(app, room, one, 12); assert.equal(state.story.stage, 'refereeIntro');
  const rematchGate = state.story.refereeIntro.sequenceId;
  const gone = once(ref, 'close'); ref.close(); await gone;
  await one.take(packet => packet.type === 'state' && !packet.state.referee.connected
    && packet.state.story.refereeIntro?.sequenceId === rematchGate);
  state = await advance(app, room, one, REFEREE_RECONNECT_GRACE - .2);
  assert.equal(state.story.stage, 'refereeIntro');
  state = await advance(app, room, one, .2 + COUNTDOWN_SECONDS);
  assert.equal(state.phase, 'fight'); assert.equal(state.players[0].wins, 0);
  assert.equal(state.players[1].wins, 0);

  // Keep the complete transport history, not just packets remaining after waits.
  for (const [socket, own, other] of [[one, a, b], [two, b, a]]) {
    assert.ok(socket.transcript.length > 100);
    for (const packet of socket.transcript) {
      const encoded = JSON.stringify(packet);
      assert.ok(!encoded.includes(credentials.token) && !encoded.includes(other.token));
      if (packet.type === 'welcome') assert.equal(packet.token, own.token);
      else assert.deepEqual(privateKeys(packet), [], `private field in ${packet.type}`);
      assert.notEqual(packet.type, 'refereeState');
    }
  }
});

test('real defensive and offensive events resolve actor/target names for either corner and reordered rosters', () => {
  const cases = [
    { category: 'parry', defender: true, block: true, parry: .2 },
    { category: 'block', defender: true, block: true },
    { category: 'guardBreak', block: true, guard: 1 },
    { category: 'defense', defender: true, variant: 'heavyDrive', kind: 'heavy' },
    { category: 'heavySeries', variant: 'heavyHook', kind: 'heavy' },
    { category: 'impulse', variant: 'bolt', kind: 'special' },
    { category: 'mine', variant: 'shockwave', kind: 'special' },
    { category: 'airLaunch', variant: 'launcher', kind: 'heavy' },
    { category: 'airCombo', variant: 'airJab', airborne: true },
  ];
  for (const item of cases) for (const attackerId of ['p1', 'p2']) for (let seed = 1; seed <= 12; seed++) {
    const room = new CombatRoom({ id: 'NAMED' }); room.addPlayer('Сом'); room.addPlayer('Чайник');
    room.ready('p1'); room.ready('p2'); for (let i = 0; i < 31; i++) room.step(.1);
    const attacker = room.player(attackerId), target = room.opponent(attacker);
    target.input.block = Boolean(item.block); target.parryWindow = item.parry || 0;
    target.guard = item.guard ?? 100; target.y = item.airborne ? .6 : 0;
    const state = () => { const s = room.snapshot(); s.players.reverse(); return s; };
    const director = createRefereeDirector({ seed, favorite: seed % 2 ? 'p1' : 'p2' }); director.update(state());
    const variant = item.variant || 'jab', attack = VARIANT_ATTACKS[variant] || V5_ATTACKS[variant] || ATTACKS[item.kind || 'light'];
    room.damage(attacker, target, attack, item.kind || 'light', attacker.x, { variant });
    const output = director.update(state());
    const cue = [output.current, output.next].find(c => c?.category === item.category);
    assert.ok(cue, `${item.category} from ${attackerId}`);
    const authored = REFEREE_LINES.find(line => cue.id.endsWith(`:${line.id}`));
    const actor = item.defender ? target : attacker, recipient = item.defender ? attacker : target;
    assert.equal(cue.text, formatClubText(authored.text, { actor, target: recipient, a: room.player('p1'), b: room.player('p2'), round: 1, score: '0 : 0' }));
    assert.ok(!cue.text.includes('Автоматон') && !/[{}<>]/u.test(cue.text));
    assert.deepEqual(privateKeys(cue), []);
  }
});
