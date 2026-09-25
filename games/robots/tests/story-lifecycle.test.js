import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { RULE_CARDS } from '../shared/club-story.js';
import { WINS_TO_MATCH, COUNTDOWN_SECONDS } from '../shared/constants.js';
import { ROUND_INTRO_DURATION } from '../shared/round-intro.js';

let pingSerial = 0;
async function connect(app) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`), packets = [];
  ws.on('message', data => {
    const packet = JSON.parse(data); if (packet.type === 'state') ws.latest = packet.state;
    packets.push(packet); if (packets.length > 256) packets.splice(0, packets.length - 256);
  });
  await once(ws, 'open');
  ws.sendPacket = packet => ws.send(JSON.stringify(packet));
  ws.take = async predicate => {
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      const index = packets.findIndex(predicate); if (index >= 0) return packets.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw Error(`Missing packet: ${predicate}`);
  };
  ws.sync = async () => { const t = ++pingSerial; ws.sendPacket({ type: 'ping', t }); await ws.take(p => p.type === 'pong' && p.t === t); return ws.latest; };
  return ws;
}
const kind = type => packet => packet.type === type;
async function setup(t, storyMode = true) {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false }); t.after(() => app.close());
  const one = await connect(app); one.sendPacket({ type: 'create', storyMode, name: 'Сом' }); const a = await one.take(kind('welcome'));
  const two = await connect(app); two.sendPacket({ type: 'join', room: a.room, name: 'Чайник' }); const b = await two.take(kind('welcome'));
  await two.sync(); await one.sync();
  return { app, one, two, a, b };
}
// Drive the real server at its supported maximum fixed delta. Yield while
// advancing long timeouts so a fast fixture cannot hide states in backpressure.
async function advance(f, seconds, observer = f.one) {
  for (let n = 0; n < Math.round(seconds * 10); n++) {
    f.app.tick(.1); if (n % 20 === 19) await new Promise(resolve => setImmediate(resolve));
  }
  await new Promise(resolve => setImmediate(resolve));
  return observer.sync();
}
async function disconnect(ws, observer, id) {
  const closed = once(ws, 'close'); ws.close(); await closed;
  await observer.take(p => p.type === 'state' && p.state.players.some(player => player.id === id && !player.connected));
  return observer.sync();
}
async function reconnect(f, seat) {
  const welcome = seat === 'one' ? f.a : f.b, ws = await connect(f.app);
  ws.sendPacket({ type: 'join', room: f.a.room, token: welcome.token, name: 'Не изменять паспорт' });
  await ws.take(kind('welcome')); f[seat] = ws; await ws.sync(); return ws;
}
async function enterRules(f) {
  f.one.sendPacket({ type: 'ready' }); f.two.sendPacket({ type: 'ready' });
  await f.one.take(p => p.type === 'state' && p.state.story?.stage === 'rules'); return f.one.sync();
}
async function enterFaceoff(f) {
  let state = await enterRules(f);
  for (let ruleIndex = 0; ruleIndex < RULE_CARDS.length; ruleIndex++) {
    for (const ws of [f.one, f.two]) ws.sendPacket({ type: 'storyAdvance', sequenceId: state.story.sequenceId, ruleIndex });
    await f.two.sync(); state = await f.one.sync();
    assert.equal(state.story.ruleIndex, ruleIndex + 1);
  }
  assert.equal(state.story.stage, 'faceoff'); return state;
}
async function skipFaceoff(f) {
  let state = await enterFaceoff(f); state = await advance(f, 3.2);
  for (const ws of [f.one, f.two]) ws.sendPacket({ type: 'storyAdvance', sequenceId: state.story.sequenceId, ruleIndex: state.story.ruleIndex });
  await f.two.sync(); state = await f.one.sync(); assert.equal(state.story.stage, 'roundIntro'); return state;
}

test('ready/profile race survives workshop reconnect and starts the rules once both committed passports are present', async t => {
  const f = await setup(t);
  f.one.sendPacket({ type: 'profile', name: 'Утверждённый Сом' });
  f.one.sendPacket({ type: 'ready' });
  f.one.sendPacket({ type: 'profile', name: 'Запоздалая подмена' });
  await f.one.take(kind('notice'));
  let state = await f.one.sync(); assert.equal(state.players[0].name, 'Утверждённый Сом');
  await disconnect(f.one, f.two, 'p1');
  f.two.sendPacket({ type: 'ready' }); state = await f.two.sync();
  assert.equal(state.story.stage, 'workshop'); assert.deepEqual(state.story.ready, { p1: true, p2: true });
  await reconnect(f, 'one'); state = await advance(f, .2);
  assert.equal(state.story.stage, 'rules', 'restoring the missing committed player must not strand two ready fighters in the workshop');
  assert.equal(state.story.ruleIndex, 0); assert.equal(state.players[0].name, 'Утверждённый Сом');
  f.one.sendPacket({ type: 'ready', ready: false }); f.one.sendPacket({ type: 'profile', name: 'После сдачи' });
  await f.one.take(kind('notice')); state = await f.one.sync(); assert.equal(state.story.stage, 'rules'); assert.equal(state.players[0].name, 'Утверждённый Сом');
});

test('late duplicated rule acknowledgements cannot become faceoff skip votes', async t => {
  const f = await setup(t); const rulesSequence = (await enterFaceoff(f)).story.sequenceId;
  let state = await advance(f, 3.2);
  for (const ws of [f.one, f.two]) {
    ws.sendPacket({ type: 'storyAdvance', sequenceId: `${rulesSequence}:stale`, ruleIndex: RULE_CARDS.length });
    ws.sendPacket({ type: 'storyAdvance', sequenceId: rulesSequence, ruleIndex: RULE_CARDS.length - 1 });
  }
  await f.two.sync(); state = await f.one.sync();
  assert.equal(state.story.stage, 'faceoff', 'a delayed rule ACK is not a request to skip the theatrical scene');
  assert.deepEqual(state.story.skipVotes, []);
  for (const ws of [f.one, f.two]) ws.sendPacket({ type: 'storyAdvance', sequenceId: state.story.sequenceId, ruleIndex: RULE_CARDS.length });
  await f.two.sync(); state = await f.one.sync(); assert.equal(state.story.stage, 'roundIntro', 'current explicit votes still skip correctly');
});

test('real player/referee reconnects freeze only player-owned story time and preserve the three-second fight resume', async t => {
  const f = await setup(t); let ref = await connect(f.app);
  ref.sendPacket({ type: 'watch', room: f.a.room }); const refWelcome = await ref.take(kind('refereeWelcome')); await ref.sync();
  let state = await enterRules(f); const sequenceId = state.story.sequenceId;
  ref.sendPacket({ type: 'storyAdvance', sequenceId, ruleIndex: 0 }); await ref.sync(); state = await f.one.sync(); assert.equal(state.story.ruleIndex, 1);
  const refClosed = once(ref, 'close'); ref.close(); await refClosed;
  await f.one.take(p => p.type === 'state' && !p.state.referee.connected && p.state.story.ruleIndex === 1);
  f.one.sendPacket({ type: 'storyAdvance', sequenceId, ruleIndex: 1 }); await f.one.sync();
  await disconnect(f.two, f.one, 'p2'); const frozenRule = f.one.latest.story.elapsed;
  state = await advance(f, 5); assert.equal(state.story.ruleIndex, 1); assert.equal(state.story.elapsed, frozenRule);
  await reconnect(f, 'two');
  for (let index = 1; index < RULE_CARDS.length; index++) {
    f.one.sendPacket({ type: 'storyAdvance', sequenceId, ruleIndex: index }); f.two.sendPacket({ type: 'storyAdvance', sequenceId, ruleIndex: index }); await f.two.sync(); await f.one.sync();
  }
  state = await advance(f, .8); assert.equal(state.story.stage, 'faceoff');
  ref = await connect(f.app); ref.sendPacket({ type: 'watch', room: f.a.room, token: refWelcome.token }); await ref.take(kind('refereeWelcome')); await ref.sync();
  ref.sendPacket({ type: 'storyAdvance', actor: 'p1', sequenceId, ruleIndex: RULE_CARDS.length });
  ref.sendPacket({ type: 'input', playerId: 'p1', seq: 8000, move: 1, block: false, crouch: false, action: 'ultimate' });
  await ref.take(kind('notice')); await ref.sync(); state = await f.one.sync(); assert.deepEqual(state.story.skipVotes, []);
  const oldFaceoffTime = state.story.elapsed; const closedAgain = once(ref, 'close'); ref.close(); await closedAgain;
  state = await advance(f, .4); assert.ok(state.story.elapsed > oldFaceoffTime, 'referee absence does not freeze fighters');
  await disconnect(f.two, f.one, 'p2'); const held = f.one.latest.story.elapsed; state = await advance(f, 5); assert.equal(state.story.elapsed, held); assert.equal(state.story.paused, true);
  await reconnect(f, 'two'); state = await advance(f, 3.2);
  for (const ws of [f.one, f.two]) ws.sendPacket({ type: 'storyAdvance', sequenceId, ruleIndex: state.story.ruleIndex });
  await f.two.sync(); state = await f.one.sync(); assert.equal(state.story.stage, 'roundIntro'); const introSequence = state.story.roundIntro.sequenceId;
  state = await advance(f, 1.4); await disconnect(f.two, f.one, 'p2');
  const heldIntro = f.one.latest.story.elapsed, heldCountdown = f.one.latest.countdown;
  state = await advance(f, 5); assert.equal(state.story.elapsed, heldIntro); assert.equal(state.countdown, heldCountdown); assert.equal(state.story.paused, true);
  await reconnect(f, 'two');
  state = await advance(f, ROUND_INTRO_DURATION - heldIntro - .1);
  assert.equal(state.story.stage, 'roundIntro', 'the complete second recording retains its last presentation window');
  state = await advance(f, .1); assert.equal(state.story.stage, 'complete'); assert.equal(state.phase, 'countdown'); assert.equal(state.countdown, COUNTDOWN_SECONDS);
  state = await advance(f, 2.8); assert.equal(state.phase, 'countdown'); state = await advance(f, .2); assert.equal(state.phase, 'fight');
  await disconnect(f.two, f.one, 'p2'); const remainingTime = f.one.latest.time;
  state = await advance(f, 9); assert.equal(state.phase, 'paused'); assert.equal(state.time, remainingTime);
  await reconnect(f, 'two'); state = await f.one.sync(); assert.equal(state.countdown, 3); assert.equal(state.story.stage, 'complete'); assert.equal(state.story.roundIntro.sequenceId, introSequence);
  state = await advance(f, 2.8); assert.equal(state.phase, 'countdown'); assert.equal(state.time, remainingTime);
  state = await advance(f, .2); assert.equal(state.phase, 'fight'); assert.equal(state.time, remainingTime);
  // A forged referee input did not poison the fighter's input sequence.
  f.one.sendPacket({ type: 'input', seq: 0, move: 1, block: false, crouch: false, action: null }); await f.one.sync();
  const priorX = state.players[0].x; state = await advance(f, .2); assert.ok(state.players[0].x > priorX);
});

test('five real timeout victories and a rematch keep short exchanges; disconnect before its first tick cannot lose the rematch intro', async t => {
  const f = await setup(t); let state = await skipFaceoff(f); const introIds = new Set(), exchanges = new Set();
  let seq = 0;
  for (let round = 1; round <= WINS_TO_MATCH; round++) {
    assert.equal(state.story.stage, 'roundIntro'); assert.equal(state.round, round);
    introIds.add(state.story.roundIntro.sequenceId); exchanges.add(state.story.roundIntro.exchangeId);
    state = await advance(f, state.countdown + .2); assert.equal(state.phase, 'fight');
    f.one.sendPacket({ type: 'input', seq: seq++, move: 0, block: false, crouch: false, action: 'special' }); await f.one.sync();
    state = await advance(f, 1); assert.ok(state.players[1].hp < state.players[0].hp, 'real projectile gives a timeout lead without mutating combat state');
    state = await advance(f, state.time + .2); assert.equal(state.players[0].wins, round);
    if (round < WINS_TO_MATCH) state = await advance(f, 3.4);
  }
  assert.equal(introIds.size, WINS_TO_MATCH); assert.equal(exchanges.size, WINS_TO_MATCH);
  state = await advance(f, 8); assert.equal(state.phase, 'matchOver');
  f.one.sendPacket({ type: 'rematch' }); f.two.sendPacket({ type: 'rematch' }); await f.two.sync(); state = await f.one.sync();
  assert.equal(state.story.stage, 'roundIntro', 'the rematch first broadcast must already contain its complete exchange');
  assert.equal(state.story.roundIntro.duration, ROUND_INTRO_DURATION);
  const rematchId = state.story.roundIntro.sequenceId; assert.ok(!introIds.has(rematchId)); assert.equal(state.story.roundIntro.matchSerial, 1); assert.equal(state.round, 1);
  await disconnect(f.two, f.one, 'p2'); state = await advance(f, 5); assert.equal(state.story.stage, 'roundIntro'); assert.equal(state.story.elapsed, 0);
  await reconnect(f, 'two'); state = await advance(f, ROUND_INTRO_DURATION + COUNTDOWN_SECONDS); assert.equal(state.phase, 'fight'); assert.equal(state.story.roundIntro.sequenceId, rematchId); assert.equal(state.players[0].wins, 0);
});
