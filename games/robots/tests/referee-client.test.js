import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { once } from 'node:events';
import { startServer } from '../server/index.js';
import { createRefereeClient, REFEREE_SESSION_PREFIX } from '../src/referee-client.js';

const store = () => { const data = new Map(); return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
function fixture() {
  let time = 1000, timerId = 0; const jobs = new Map(), sockets = [], storage = store(), statuses = [], frames = [], favorites = [], notices = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, value = {}) { for (const fn of this.listeners[type] || []) fn(value); }
    open() { this.readyState = 1; this.emit('open'); }
    message(value) { this.emit('message', { data: JSON.stringify(value) }); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.emit('close', { code: 1000 }); }
    closed(code = 1006) { this.readyState = 3; this.emit('close', { code }); }
  }
  const options = { room: 'ABC234', origin: 'https://example.test', socketUrl: 'wss://example.test/robots/ws', sessionScope: '/robots/', WebSocketImpl: Socket,
    storage, now: () => time, setTimer: (fn, delay) => { const id = ++timerId; jobs.set(id, { at: time + delay, fn }); return id; }, clearTimer: id => jobs.delete(id),
    onStatus: value => statuses.push(value), onSnapshot: (state, meta) => frames.push({ state, meta }), onFavorite: value => favorites.push(value), onNotice: value => notices.push(value) };
  const client = createRefereeClient(options);
  const advance = amount => {
    const until = time + amount;
    for (let n = 0; n < 1000; n++) {
      const due = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= until);
      if (!due) break; time = due[1].at; jobs.delete(due[0]); due[1].fn();
    }
    time = until;
  };
  const welcome = (socket = sockets.at(-1)) => { socket.open(); socket.message({ type: 'refereeWelcome', room: 'ABC234', token: 'referee-secret' }); };
  return { client, sockets, storage, statuses, frames, favorites, notices, advance, welcome, options };
}
const state = (events = [], story = {}) => ({ room: 'ABC234', phase: 'fight', round: 1, players: [], events, story });

test('only an explicit entry or matching own session opens watch; fighter tokens stay untouched', () => {
  const f = fixture(); assert.equal(f.sockets.length, 0); assert.equal(f.client.restore(), false);
  f.storage.setItem('belobog-session', JSON.stringify({ room: 'ABC234', token: 'fighter-secret' }));
  f.client.start(); assert.equal(f.sockets.length, 1); assert.deepEqual(f.sockets[0].sent, []);
  f.welcome(); assert.deepEqual(f.sockets[0].sent[0], { type: 'watch', room: 'ABC234', preparing: true });
  assert.equal(f.storage.data.size, 2); assert.ok([...f.storage.data.keys()].some(k => k.startsWith(REFEREE_SESSION_PREFIX)));
  const restored = createRefereeClient(f.options); assert.equal(restored.restore(), true);
  f.sockets.at(-1).open(); assert.equal(f.sockets.at(-1).sent[0].token, 'referee-secret');
  const other = createRefereeClient({ ...f.options, room: 'XYZ678' }); assert.equal(other.restore(), false);
  assert.equal(JSON.parse(f.storage.getItem('belobog-session')).token, 'fighter-secret');
  f.client.stop(); restored.stop(); other.stop();
});

test('old sockets cannot publish state, save credentials or schedule retries after replacement', () => {
  const f = fixture(); f.client.start(); f.welcome(); const old = f.sockets[0];
  old.closed(); f.advance(500); const fresh = f.sockets[1]; f.welcome(fresh);
  old.message({ type: 'state', state: state([{ id: 99 }]) });
  old.message({ type: 'refereeWelcome', room: 'ABC234', token: 'stale-token' }); old.closed(4001);
  assert.equal(f.frames.length, 0); assert.equal(f.client.getStatus(), 'connected');
  assert.equal(JSON.parse([...f.storage.data.values()][0]).token, 'referee-secret');
  f.client.stop(); f.advance(90000); assert.equal(f.sockets.length, 2);
});

test('first and reconnect event tails are historical; live events appear once and favorites stay separate', () => {
  const f = fixture(); f.client.start(); f.welcome(); const socket = f.sockets[0];
  socket.message({ type: 'state', state: state([{ id: 1 }, { id: 2 }]) });
  assert.equal(f.frames.at(-1).meta.baseline, true); assert.deepEqual(f.frames.at(-1).meta.freshEvents, []);
  socket.message({ type: 'state', state: state([{ id: 2 }, { id: 3 }]) }); assert.deepEqual(f.frames.at(-1).meta.freshEvents, [{ id: 3 }]);
  socket.message({ type: 'state', state: state([{ id: 3 }]) }); assert.deepEqual(f.frames.at(-1).meta.freshEvents, []);
  socket.message({ type: 'refereeState', favorite: 'p2' }); assert.deepEqual(f.favorites, ['p2']);
  assert.equal(f.frames.at(-1).state.favorite, undefined);
  socket.closed(); f.advance(500); f.welcome(); f.sockets.at(-1).message({ type: 'state', state: state([{ id: 3 }, { id: 4 }]) });
  assert.deepEqual(f.frames.at(-1).meta.freshEvents, []);
  f.sockets.at(-1).message({ type: 'state', state: state([{ id: 4 }, { id: 5 }]) }); assert.deepEqual(f.frames.at(-1).meta.freshEvents, [{ id: 5 }]);
  f.client.stop();
});

test('takeover and room closure stop automatic retries, and errors remain correctable', () => {
  for (const code of [4000, 4001]) {
    const f = fixture(); f.client.start(); f.welcome(); f.sockets[0].closed(code); f.advance(200000);
    assert.equal(f.sockets.length, 1); assert.equal(f.client.getStatus(), code === 4000 ? 'closed' : 'takenOver');
    assert.equal(f.client.hasSession(), code === 4001);
  }
  const f = fixture(); f.client.start(); f.welcome();
  f.sockets[0].message({ type: 'error', message: 'Неверный ключ рефери. Откройте приглашение заново.' });
  assert.equal(f.client.getStatus(), 'error'); assert.equal(f.client.hasSession(), false);
  f.client.start(); f.sockets.at(-1).open(); assert.equal(f.sockets.at(-1).sent[0].token, undefined);
  f.sockets.at(-1).message(null); f.sockets.at(-1).message({ type: 'notice', message: 'Проверка микрофона' });
  assert.equal(f.notices.at(-1), 'Проверка микрофона'); assert.notEqual(f.client.getStatus(), 'error');
  f.client.stop();
});

test('round start sends only the current ceremony token, never rule or fighter input', () => {
  const f = fixture(); f.client.start(); f.welcome(); const socket = f.sockets[0];
  assert.equal(f.client.startRound(), false);
  socket.message({ type: 'state', state: state([], { stage: 'refereeIntro', refereeIntro: { sequenceId: 'gate:1' }, paused: false }) });
  assert.equal(f.client.startRound(), false);
  socket.message({ type: 'refereeState', favorite: 'p1', prepared: true });
  assert.equal(f.client.startRound(), true);
  assert.deepEqual(socket.sent.at(-1), { type: 'refereeStartRound', sequenceId: 'gate:1' });
  socket.message({ type: 'state', state: state([], { stage: 'refereeIntro', refereeIntro: { sequenceId: 'gate:2' }, paused: true }) });
  assert.equal(f.client.startRound(), false);
  socket.message({ type: 'state', state: state([], { stage: 'rules', sequenceId: 'show:2', ruleIndex: 0 }) });
  assert.equal(f.client.startRound(), false);
  assert.equal(f.client.setFavorite('p1'), true); assert.equal(f.client.setFavorite('neutral'), false);
  assert.equal(f.client.setFavorite('<invalid>'), false);
  assert.ok(socket.sent.every(p => ['watch', 'ping', 'refereeStartRound', 'refereeFavorite'].includes(p.type)));
  f.client.stop();
});

test('a transport stall consumes historical hits instead of replaying the explosion tail', () => {
  const f = fixture(); f.client.start(); f.welcome(); const socket = f.sockets[0];
  socket.message({ type: 'state', state: state([{ id: 1 }]) });
  f.advance(400);
  socket.message({ type: 'state', state: state([{ id: 1 }, { id: 2, type: 'destruction' }]) });
  assert.deepEqual(f.frames.at(-1).meta.freshEvents, []);
  socket.message({ type: 'state', state: state([{ id: 2, type: 'destruction' }, { id: 3, type: 'hit' }]) });
  assert.deepEqual(f.frames.at(-1).meta.freshEvents, [{ id: 3, type: 'hit' }]);
  f.client.stop();
});

test('a new page asks for preparation, while a ready socket reconnect preserves readiness', () => {
  const f = fixture(); f.client.start(); f.welcome(); const socket = f.sockets[0];
  assert.equal(socket.sent[0].preparing, true);
  socket.message({ type: 'refereeState', favorite: 'p1', prepared: false });
  assert.equal(f.client.markReady(), true); assert.deepEqual(socket.sent.at(-1), { type: 'refereeReady' });
  socket.message({ type: 'refereeState', favorite: 'p1', prepared: true });
  socket.closed(); f.advance(500); f.welcome(); assert.equal(f.sockets.at(-1).sent[0].preparing, false);
  const restored = createRefereeClient(f.options); restored.restore(); f.sockets.at(-1).open();
  assert.equal(f.sockets.at(-1).sent[0].preparing, true, 'a fresh page has a fresh audio context');
  f.client.stop(); restored.stop();
});

test('missing pong and handshake failures have bounded retries, not a permanent dead connection', () => {
  const f = fixture(); f.client.start(); f.welcome(); f.advance(30000);
  assert.equal(f.client.getStatus(), 'reconnecting'); f.advance(500); assert.equal(f.sockets.length, 2);
  f.advance(200000); assert.equal(f.client.getStatus(), 'error'); assert.ok(f.sockets.length < 20);
  f.client.stop();
});

async function packet(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', read); reject(Error(`No ${type}`)); }, 2500);
    function read(data) { const value = JSON.parse(data.toString()); if (value.type === type) { clearTimeout(timeout); socket.off('message', read); resolve(value); } }
    socket.on('message', read);
  });
}
const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Condition not reached'); };

test('real referee joins automatic rules and restores the private choice without any public leakage', async t => {
  const app = await startServer({ host: '127.0.0.1', port: 0, autoTick: false }); t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.port}`, one = new WebSocket(origin.replace('http', 'ws') + '/ws'), two = new WebSocket(origin.replace('http', 'ws') + '/ws');
  await Promise.all([once(one, 'open'), once(two, 'open')]);
  let p = packet(one, 'welcome'); one.send(JSON.stringify({ type: 'create', name: 'ИСКРА', storyMode: true })); const welcome = await p;
  p = packet(two, 'welcome'); two.send(JSON.stringify({ type: 'join', room: welcome.room, name: 'ИНЕЙ' })); await p;
  const storage = store(), states = [], favorites = [], statuses = [];
  let client = createRefereeClient({ room: welcome.room, origin, WebSocketImpl: WebSocket, storage, onSnapshot: s => states.push(s), onFavorite: f => favorites.push(f), onStatus: s => statuses.push(s) });
  t.after(() => client.stop()); client.start(); await until(() => states.length > 0);
  assert.equal(app.rooms.get(welcome.room).game.players.length, 2);
  client.setFavorite('p2'); await until(() => favorites.at(-1) === 'p2');
  client.markReady(); await until(() => app.rooms.get(welcome.room).referee.prepared === true);
  one.send(JSON.stringify({ type: 'ready' })); two.send(JSON.stringify({ type: 'ready' })); await until(() => states.at(-1)?.story.stage === 'rules');
  const before = states.at(-1).story.ruleIndex;
  for (let i = 0; i < 60 * 56; i++) { app.rooms.get(welcome.room).story.step(1 / 60); if (app.rooms.get(welcome.room).story.snapshot().ruleIndex > before) break; }
  app.broadcast(app.rooms.get(welcome.room));
  await until(() => states.at(-1)?.story.ruleIndex > before);
  client.setFavorite('p2'); await until(() => favorites.at(-1) === 'p2');
  assert.ok(states.every(s => !JSON.stringify(s).includes('favorite')));
  client.stop(); await new Promise(resolve => setTimeout(resolve, 15));
  client = createRefereeClient({ room: welcome.room, origin, WebSocketImpl: WebSocket, storage, onSnapshot: s => states.push(s), onFavorite: f => favorites.push(f) });
  assert.equal(client.restore(), true); await until(() => client.getStatus() === 'connected');
  await until(() => favorites.at(-1) === 'p2'); assert.equal(app.rooms.get(welcome.room).game.players.length, 2);
});
