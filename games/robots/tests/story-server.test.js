import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { RULE_CARDS } from '../shared/club-story.js';
import { FACE_OFF_DURATION } from '../shared/faceoff-script.js';
import { REFEREE_RECONNECT_GRACE, refereeRuleDuration } from '../shared/referee-round.js';
import { COUNTDOWN_SECONDS, ROUND_SECONDS } from '../shared/constants.js';

async function client(app) {
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  const messages = [];
  ws.on('message', data => messages.push(JSON.parse(data)));
  await once(ws, 'open');
  ws.sendPacket = message => ws.send(JSON.stringify(message));
  ws.take = async predicate => {
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Packet missing: ${predicate}`);
  };
  ws.messages = messages;
  return ws;
}
const kind = type => p => p.type === type;
const state = predicate => p => p.type === 'state' && predicate(p.state);
async function setup(t, training = false) {
  const app = await startServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const one = await client(app);
  one.sendPacket({ type: 'create', storyMode: true, mode: training ? 'training' : 'pvp', name: 'Кабачок' });
  const first = await one.take(kind('welcome'));
  let two, second;
  if (!training) {
    two = await client(app); two.sendPacket({ type: 'join', room: first.room, name: 'Чайник' });
    second = await two.take(kind('welcome'));
  }
  return { app, one, two, first, second, room: app.rooms.get(first.room) };
}
async function ready({ one, two }) {
  one.sendPacket({ type: 'ready' }); two?.sendPacket({ type: 'ready' });
  return (await one.take(state(s => s.story?.stage === 'rules'))).state;
}
const tick = (app, seconds) => { for (let n = 0; n < Math.ceil(seconds * 60); n++) app.tick(); };

let barrierSerial = 0;
async function drainSnapshots(app) {
  const marker = `snapshot-barrier-${++barrierSerial}`;
  await Promise.all([...app.wss.clients].filter(socket => socket.readyState === WebSocket.OPEN).map(socket => new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); socket.off('pong', onPong); socket.off('close', onClose); socket.off('error', finish);
      if (error) reject(error); else resolve();
    };
    const onPong = data => { if (data.toString() === marker) finish(); };
    const onClose = () => finish(new Error('Socket closed before queued snapshots reached the client'));
    const timer = setTimeout(() => finish(new Error('Queued snapshots did not reach the client')), 2500);
    socket.on('pong', onPong); socket.once('close', onClose); socket.once('error', finish);
    // Control ping is queued behind the prior state frames on this transport;
    // unlike the JSON ping response, it cannot be skipped by the 256 KiB cap.
    // Matching pong proves that the peer read the queue, not merely that an
    // arbitrary wall-clock delay expired. autoTick:false keeps it drained.
    socket.ping(marker, error => { if (error) finish(error); });
  })));
}

test('workshop profiles are validated, replicated and preserved through rounds and cannot change once ready', async t => {
  const f = await setup(t);
  f.one.sendPacket({ type: 'profile', name: ' <Царь>\u202e\n болтов ', character: '<Вежливый>\u0001', customization: { body: 'ruby', core: 'violet', accessory: 'crown', shader: 'bad' } });
  const updated = (await f.two.take(state(s => s.players[0].name === 'Царь болтов'))).state;
  assert.equal(updated.players[0].character, 'Вежливый');
  assert.deepEqual(updated.players[0].customization, { body: 'ruby', core: 'violet', accessory: 'crown' });
  f.one.sendPacket({ type: 'ready' });
  await f.one.take(state(s => s.story.ready.p1));
  f.one.sendPacket({ type: 'profile', name: 'Подмена', customization: { body: 'jade' } });
  await f.one.take(kind('notice'));
  assert.equal(f.room.game.player('p1').name, 'Царь болтов');
  f.one.sendPacket({ type: 'ready', ready: false });
  await f.one.take(state(s => s.story.stage === 'workshop' && !s.story.ready.p1 && s.players[0].name === 'Царь болтов'));
  f.one.sendPacket({ type: 'profile', customization: { body: '#f00', core: 'cyan', accessory: '../../texture.png' } });
  await f.two.take(state(s => s.players[0].customization.core === 'cyan'));
  assert.deepEqual(f.room.game.player('p1').customization, { body: 'original', core: 'cyan', accessory: 'none' });
  f.room.game.startRound();
  assert.equal(f.room.game.player('p1').customization.core, 'cyan');
  const detached = f.room.game.snapshot(); detached.players[0].customization.core = 'lime';
  assert.equal(f.room.game.player('p1').customization.core, 'cyan', 'snapshot must not leak mutable profile');
});

test('optional referee has a separate resumable seat, private favorite and no fighter privileges', async t => {
  const f = await setup(t);
  const ref = await client(f.app);
  ref.sendPacket({ type: 'watch', room: f.first.room });
  const welcome = await ref.take(kind('refereeWelcome'));
  assert.notEqual(welcome.token, f.first.token);
  assert.equal(f.room.game.players.length, 2);
  ref.sendPacket({ type: 'refereeFavorite', favorite: 'p2' });
  assert.equal((await ref.take(p => p.type === 'refereeState' && p.favorite === 'p2')).favorite, 'p2');
  const broadcast = (await f.one.take(state(s => s.referee?.connected))).state;
  assert.deepEqual(broadcast.referee, { connected: true, preparing: true });
  assert.ok(!JSON.stringify(broadcast).includes(welcome.token));
  assert.ok(!f.one.messages.some(p => p.type === 'refereeState'));
  for (const message of [{ type: 'ready' }, { type: 'input', seq: 1, move: 1, block: false, crouch: false, action: 'ultimate' }, { type: 'profile', name: 'Подмена' }, { type: 'rematch' }]) {
    ref.sendPacket(message); await ref.take(kind('notice'));
  }
  assert.equal(f.room.game.phase, 'waiting'); assert.equal(f.room.game.player('p1').lastSeq, -1);
  assert.equal(f.room.game.player('p1').name, 'Кабачок');
  const imposter = await client(f.app);
  imposter.sendPacket({ type: 'join', room: f.first.room, token: welcome.token });
  assert.match((await imposter.take(kind('error'))).message, /ключ/);
  imposter.sendPacket({ type: 'watch', room: f.first.room, token: f.first.token });
  assert.match((await imposter.take(kind('error'))).message, /ключ/);
  imposter.sendPacket({ type: 'watch', room: f.first.room });
  assert.match((await imposter.take(kind('error'))).message, /другого рефери/);
  const closed = once(ref, 'close'); ref.close(); await closed;
  await f.one.take(state(s => !s.referee.connected && s.players.length === 2));
  imposter.sendPacket({ type: 'watch', room: f.first.room, token: welcome.token });
  await imposter.take(kind('refereeWelcome'));
  assert.equal((await imposter.take(kind('refereeState'))).favorite, 'p2');
});

test('real clients read shared rules and synchronize faceoff; referee disconnect returns rule control without skipping', async t => {
  const f = await setup(t);
  const ref = await client(f.app); ref.sendPacket({ type: 'watch', room: f.first.room });
  await ref.take(kind('refereeWelcome'));
  ref.sendPacket({ type: 'refereeFavorite', favorite: 'p1' }); ref.sendPacket({ type: 'refereeReady' });
  await ref.take(p => p.type === 'refereeState' && p.prepared);
  const snapshot = await ready(f);
  const advance = (ws, ruleIndex) => ws.sendPacket({ type: 'storyAdvance', sequenceId: snapshot.story.sequenceId, ruleIndex });
  advance(f.one, 0); advance(f.two, 0);
  f.one.sendPacket({ type: 'ping', t: 1 }); await f.one.take(kind('pong'));
  assert.equal(f.room.story.ruleIndex, 0, 'players cannot rush the referee');
  advance(ref, 0); await ref.take(kind('notice'));
  assert.equal(f.room.story.ruleIndex, 0, 'referee rules are automatically paced');
  tick(f.app, refereeRuleDuration(0, f.room.game.players));
  await drainSnapshots(f.app); f.app.broadcast(f.room);
  await ref.take(state(s => s.story.ruleIndex === 1));
  advance(ref, 0); ref.sendPacket({ type: 'ping', t: 2 }); await ref.take(kind('pong'));
  assert.equal(f.room.story.ruleIndex, 1, 'duplicate/stale advances cannot skip a card');
  const closed = once(ref, 'close'); ref.close(); await closed;
  await f.one.take(state(s => s.story.ruleIndex === 1 && !s.referee.connected));
  for (let i = 1; i < RULE_CARDS.length; i++) {
    advance(f.one, i); advance(f.two, i);
    await f.one.take(state(s => s.story.ruleIndex === i + 1));
  }
  assert.equal(f.room.story.stage, 'faceoff'); assert.equal(f.room.game.phase, 'waiting');
  tick(f.app, 2);
  const disconnected = once(f.two, 'close'); f.two.close(); await disconnected;
  await f.one.take(state(s => s.story.paused));
  const sceneTime = f.room.story.elapsed; tick(f.app, 30); assert.equal(f.room.story.elapsed, sceneTime);
  const restored = await client(f.app); restored.sendPacket({ type: 'join', room: f.first.room, token: f.second.token });
  await restored.take(kind('welcome'));
  assert.equal(f.room.game.phase, 'waiting', 'reconnect cannot bypass the faceoff');
  tick(f.app, FACE_OFF_DURATION - sceneTime + 1);
  // A synthetic tight loop can fill the deliberate socket backpressure cap.
  // A skipped final state is not retried when autoTick:false: first prove all
  // queued frames reached the clients, then publish the authoritative frame.
  await drainSnapshots(f.app); f.app.broadcast(f.room);
  const combat = (await restored.take(state(s => s.story.stage === 'roundIntro'))).state;
  assert.equal(combat.phase, 'story'); assert.equal(f.room.game.phase, 'countdown'); assert.equal(f.room.game.round, 1);
  assert.ok(Number.isFinite(combat.elapsed));
});

test('snapshot barrier waits through actual outbound backpressure before publishing the latest state', async t => {
  const f = await setup(t);
  const serverSocket = f.room.sessions.get('p2').socket;
  // Hold real writes, not a mocked bufferedAmount. This reproduces the CI
  // queue saturation independently of OS socket-buffer size or machine speed.
  serverSocket._socket.cork();
  t.after(() => serverSocket._socket?.uncork());
  for (let i = 0; i < 512 && serverSocket.bufferedAmount < 256 * 1024; i++) f.app.broadcast(f.room);
  assert.ok(serverSocket.bufferedAmount >= 256 * 1024, 'exercise the real application backpressure guard');
  f.room.game.player('p1').name = 'После очереди';
  f.app.broadcast(f.room);
  let drained = false;
  const barrier = drainSnapshots(f.app).then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false, 'a barrier cannot finish while earlier frames are held');
  serverSocket._socket.uncork();
  await barrier;
  assert.equal(f.two.messages.some(p => p.type === 'state' && p.state.players[0].name === 'После очереди'), false, 'the capped final snapshot was actually skipped');
  assert.equal(serverSocket.bufferedAmount, 0, 'the transport has drained before retrying the snapshot');
  f.app.broadcast(f.room);
  const latest = (await f.two.take(state(s => s.players[0].name === 'После очереди'))).state;
  assert.equal(latest.players[1].id, 'p2');
});

test('training story needs only its human; a referee cannot keep an abandoned room alive', async t => {
  const f = await setup(t, true); const s = await ready(f);
  for (let i = 0; i < RULE_CARDS.length; i++) {
    f.one.sendPacket({ type: 'storyAdvance', sequenceId: s.story.sequenceId, ruleIndex: i });
    await f.one.take(state(s => s.story.ruleIndex === i + 1));
  }
  tick(f.app, FACE_OFF_DURATION + 1); assert.equal(f.room.story.stage, 'complete');
  const ref = await client(f.app); ref.sendPacket({ type: 'watch', room: f.first.room });
  await ref.take(kind('refereeWelcome'));
  const gone = once(f.one, 'close'); f.one.close(); await gone;
  await ref.take(state(s => !s.players.find(player => player.id === 'p1')?.connected && (s.phase === 'paused' || s.story.paused)));
  const refClosed = once(ref, 'close'); f.app.cleanup(Date.now() + 181_000);
  assert.equal((await refClosed)[0], 4000); assert.equal(f.app.rooms.has(f.first.room), false);
});

test('real referee gate requires a secret favorite and current socket/token; fighters and replayed packets cannot launch it', async t => {
  const f = await setup(t); let ref = await client(f.app);
  ref.sendPacket({ type: 'watch', room: f.first.room });
  const credentials = await ref.take(kind('refereeWelcome'));
  assert.deepEqual(await ref.take(kind('refereeState')), { type: 'refereeState', favorite: null, selectionRequired: true, prepared: false });
  ref.sendPacket({ type: 'refereeReady' }); assert.match((await ref.take(kind('notice'))).message, /тайно/);
  ref.sendPacket({ type: 'refereeFavorite', favorite: 'neutral' });
  assert.deepEqual(await ref.take(kind('refereeState')), { type: 'refereeState', favorite: null, selectionRequired: true, prepared: false });
  ref.sendPacket({ type: 'refereeFavorite', favorite: 'p2' });
  assert.deepEqual(await ref.take(kind('refereeState')), { type: 'refereeState', favorite: 'p2', selectionRequired: false, prepared: false });
  ref.sendPacket({ type: 'refereeReady' });
  assert.deepEqual(await ref.take(kind('refereeState')), { type: 'refereeState', favorite: 'p2', selectionRequired: false, prepared: true });
  await ready(f);
  for (let i = 0; i < RULE_CARDS.length; i++) {
    tick(f.app, refereeRuleDuration(i, f.room.game.players));
    await drainSnapshots(f.app);
  }
  assert.equal(f.room.story.stage, 'faceoff');
  tick(f.app, FACE_OFF_DURATION); await drainSnapshots(f.app);
  tick(f.app, f.room.story.roundIntro.duration + .1); await drainSnapshots(f.app); f.app.broadcast(f.room);
  const intro = (await ref.take(state(s => s.story.stage === 'refereeIntro'))).state.story.refereeIntro;
  const start = { type: 'refereeStartRound', sequenceId: intro.sequenceId };
  f.one.sendPacket({ ...start, actor: 'referee', token: credentials.token });
  assert.match((await f.one.take(kind('error'))).message, /Неизвестная/);
  assert.equal(f.room.game.countdown, COUNTDOWN_SECONDS);
  ref.sendPacket({ ...start, sequenceId: `${intro.sequenceId}:old` }); await ref.take(kind('notice'));
  tick(f.app, 5); await drainSnapshots(f.app);
  assert.equal(f.room.game.time, ROUND_SECONDS); assert.equal(f.room.game.countdown, COUNTDOWN_SECONDS);
  const gone = once(ref, 'close'); ref.close(); await gone;
  await f.one.take(state(s => s.story.stage === 'refereeIntro' && !s.referee.connected));
  tick(f.app, REFEREE_RECONNECT_GRACE - 1); await drainSnapshots(f.app);
  ref = await client(f.app); ref.sendPacket({ type: 'watch', room: f.first.room, token: credentials.token });
  await ref.take(kind('refereeWelcome'));
  assert.equal((await ref.take(kind('refereeState'))).favorite, 'p2');
  const restored = (await ref.take(state(s => s.story.stage === 'refereeIntro'))).state;
  assert.equal(restored.story.refereeIntro.sequenceId, intro.sequenceId);
  const fighterGone = once(f.two, 'close'); f.two.close(); await fighterGone;
  await ref.take(state(s => s.story.paused));
  ref.sendPacket(start); await ref.take(kind('notice'));
  const fighter = await client(f.app); fighter.sendPacket({ type: 'join', room: f.first.room, token: f.second.token });
  await fighter.take(kind('welcome'));
  ref.sendPacket(start);
  const launched = (await ref.take(state(s => s.phase === 'countdown' && s.story.stage === 'complete'))).state;
  assert.equal(launched.countdown, COUNTDOWN_SECONDS); assert.equal(launched.time, ROUND_SECONDS);
  tick(f.app, 1); await drainSnapshots(f.app);
  const countdown = f.room.game.countdown;
  ref.sendPacket(start); await ref.take(kind('notice'));
  assert.equal(f.room.game.countdown, countdown, 'duplicate start cannot extend the countdown');
  tick(f.app, 2); assert.equal(f.room.game.phase, 'fight'); assert.equal(f.room.game.time, ROUND_SECONDS);
  const publicPackets = f.one.messages.filter(packet => packet.type === 'state');
  assert.ok(publicPackets.length);
  assert.ok(publicPackets.every(packet => !JSON.stringify(packet).includes(credentials.token) && !JSON.stringify(packet).includes('favorite')));
  assert.equal(f.one.messages.some(packet => packet.type === 'refereeState'), false);
});

test('slow media preparation freezes rules until the private ready handshake; socket reconnect preserves it and a fresh page resets it', async t => {
  const f = await setup(t); let ref = await client(f.app);
  ref.sendPacket({ type: 'watch', room: f.first.room, preparing: true });
  const credentials = await ref.take(kind('refereeWelcome')); await ref.take(kind('refereeState'));
  const initial = await ready(f);
  assert.equal(initial.story.refereePreparing, true); assert.equal(initial.story.paused, true);
  tick(f.app, refereeRuleDuration(0, f.room.game.players) + 10); await drainSnapshots(f.app);
  assert.equal(f.room.story.ruleIndex, 0); assert.equal(f.room.story.elapsed, 0);
  f.one.sendPacket({ type: 'refereeReady' }); await f.one.take(kind('error'));
  assert.equal(f.room.referee.prepared, false);
  ref.sendPacket({ type: 'refereeFavorite', favorite: 'p2' }); ref.sendPacket({ type: 'refereeReady' });
  await ref.take(packet => packet.type === 'refereeState' && packet.prepared);
  tick(f.app, refereeRuleDuration(0, f.room.game.players)); await drainSnapshots(f.app);
  assert.equal(f.room.story.ruleIndex, 1);
  const closed = once(ref, 'close'); ref.close(); await closed;
  await f.one.take(state(s => !s.referee.connected));
  ref = await client(f.app); ref.sendPacket({ type: 'watch', room: f.first.room, token: credentials.token, preparing: false });
  await ref.take(kind('refereeWelcome'));
  assert.equal((await ref.take(kind('refereeState'))).prepared, true, 'same-page reconnect retains decoded assets');
  tick(f.app, 2); await drainSnapshots(f.app); const elapsed = f.room.story.elapsed;
  const freshPage = await client(f.app);
  freshPage.sendPacket({ type: 'watch', room: f.first.room, token: credentials.token, preparing: true });
  await freshPage.take(kind('refereeWelcome'));
  assert.deepEqual(await freshPage.take(kind('refereeState')), { type: 'refereeState', favorite: 'p2', selectionRequired: false, prepared: false });
  tick(f.app, 10); await drainSnapshots(f.app);
  assert.equal(f.room.story.elapsed, elapsed, 'new page does not inherit audio preparation from the old page');
  freshPage.sendPacket({ type: 'refereeReady' }); await freshPage.take(packet => packet.type === 'refereeState' && packet.prepared);
  tick(f.app, .2); assert.ok(f.room.story.elapsed > elapsed);
});
