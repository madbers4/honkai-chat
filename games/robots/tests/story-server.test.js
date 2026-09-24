import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { RULE_CARDS } from '../shared/club-story.js';

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
  assert.deepEqual(broadcast.referee, { connected: true });
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
  const snapshot = await ready(f);
  const advance = (ws, ruleIndex) => ws.sendPacket({ type: 'storyAdvance', sequenceId: snapshot.story.sequenceId, ruleIndex });
  advance(f.one, 0); advance(f.two, 0);
  f.one.sendPacket({ type: 'ping', t: 1 }); await f.one.take(kind('pong'));
  assert.equal(f.room.story.ruleIndex, 0, 'players cannot rush the referee');
  advance(ref, 0); await ref.take(state(s => s.story.ruleIndex === 1));
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
  tick(f.app, 23);
  // A synthetic tight loop can fill the deliberate socket backpressure cap.
  // Let transport drain, then inspect the same authoritative final frame.
  await new Promise(resolve => setTimeout(resolve, 30)); f.app.broadcast(f.room);
  const combat = (await restored.take(state(s => s.story.stage === 'roundIntro'))).state;
  assert.equal(combat.phase, 'story'); assert.equal(f.room.game.phase, 'countdown'); assert.equal(f.room.game.round, 1);
  assert.ok(Number.isFinite(combat.elapsed));
});

test('training story needs only its human; a referee cannot keep an abandoned room alive', async t => {
  const f = await setup(t, true); const s = await ready(f);
  for (let i = 0; i < RULE_CARDS.length; i++) {
    f.one.sendPacket({ type: 'storyAdvance', sequenceId: s.story.sequenceId, ruleIndex: i });
    await f.one.take(state(s => s.story.ruleIndex === i + 1));
  }
  tick(f.app, 25); assert.equal(f.room.story.stage, 'complete');
  const ref = await client(f.app); ref.sendPacket({ type: 'watch', room: f.first.room });
  await ref.take(kind('refereeWelcome'));
  const gone = once(f.one, 'close'); f.one.close(); await gone;
  await ref.take(state(s => s.phase === 'paused' || s.story.paused));
  const refClosed = once(ref, 'close'); f.app.cleanup(Date.now() + 181_000);
  assert.equal((await refClosed)[0], 4000); assert.equal(f.app.rooms.has(f.first.room), false);
});
