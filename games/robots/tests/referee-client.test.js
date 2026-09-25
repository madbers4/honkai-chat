import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { once } from 'node:events';
import { startServer } from '../server/index.js';
import { createRefereeClient, REFEREE_SESSION_PREFIX } from '../src/referee-client.js';
import { buildRoundIntro, ROUND_INTRO_BEAT_DURATION, ROUND_INTRO_DURATION } from '../shared/round-intro.js';
import { RULE_CARDS, getClubRuleCard } from '../shared/club-story.js';

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
  f.welcome(); assert.deepEqual(f.sockets[0].sent[0], { type: 'watch', room: 'ABC234' });
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

test('advance uses the latest exact rule generation, cannot fire while paused and sends no fighter actions', () => {
  const f = fixture(); f.client.start(); f.welcome(); const socket = f.sockets[0];
  assert.equal(f.client.advanceRules(), false);
  socket.message({ type: 'state', state: state([], { stage: 'rules', sequenceId: 'show:1', ruleIndex: 2, paused: false }) });
  assert.equal(f.client.advanceRules(), true);
  assert.deepEqual(socket.sent.at(-1), { type: 'storyAdvance', sequenceId: 'show:1', ruleIndex: 2 });
  socket.message({ type: 'state', state: state([], { stage: 'rules', sequenceId: 'show:2', ruleIndex: 0, paused: true }) });
  assert.equal(f.client.advanceRules(), false);
  socket.message({ type: 'state', state: state([], { stage: 'roundIntro', sequenceId: 'show:2', ruleIndex: 0 }) });
  assert.equal(f.client.advanceRules(), false);
  assert.equal(f.client.setFavorite('p1'), true); assert.equal(f.client.setFavorite('<invalid>'), false);
  assert.ok(socket.sent.every(p => ['watch', 'ping', 'storyAdvance', 'refereeFavorite'].includes(p.type)));
  f.client.stop();
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

test('real referee client joins a two-fighter story, advances exactly one card and restores its private session', async t => {
  const app = await startServer({ host: '127.0.0.1', port: 0, autoTick: false }); t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.port}`, one = new WebSocket(origin.replace('http', 'ws') + '/ws'), two = new WebSocket(origin.replace('http', 'ws') + '/ws');
  await Promise.all([once(one, 'open'), once(two, 'open')]);
  let p = packet(one, 'welcome'); one.send(JSON.stringify({ type: 'create', name: 'ИСКРА', storyMode: true })); const welcome = await p;
  p = packet(two, 'welcome'); two.send(JSON.stringify({ type: 'join', room: welcome.room, name: 'ИНЕЙ' })); await p;
  const storage = store(), states = [], favorites = [], statuses = [];
  let client = createRefereeClient({ room: welcome.room, origin, WebSocketImpl: WebSocket, storage, onSnapshot: s => states.push(s), onFavorite: f => favorites.push(f), onStatus: s => statuses.push(s) });
  t.after(() => client.stop()); client.start(); await until(() => states.length > 0);
  assert.equal(app.rooms.get(welcome.room).game.players.length, 2);
  one.send(JSON.stringify({ type: 'ready' })); two.send(JSON.stringify({ type: 'ready' })); await until(() => states.at(-1)?.story.stage === 'rules');
  assert.equal(client.advanceRules(), true); await until(() => states.at(-1)?.story.ruleIndex === 1);
  assert.equal(states.at(-1).story.ruleIndex, 1);
  client.setFavorite('p2'); await until(() => favorites.at(-1) === 'p2');
  assert.ok(states.every(s => !JSON.stringify(s).includes('favorite')));
  client.stop(); await new Promise(resolve => setTimeout(resolve, 15));
  client = createRefereeClient({ room: welcome.room, origin, WebSocketImpl: WebSocket, storage, onSnapshot: s => states.push(s), onFavorite: f => favorites.push(f) });
  assert.equal(client.restore(), true); await until(() => client.getStatus() === 'connected');
  await until(() => favorites.at(-1) === 'p2'); assert.equal(app.rooms.get(welcome.room).game.players.length, 2);
});

test('mounted player/referee pages share the charter, respect reading control, and retain timed/final lines', async t => {
  // Vite loads the actual CSS-importing route. Only the DOM/GPU/transport
  // surfaces are replaced; presentation handlers and shared director are real.
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: false, cacheDir: 'artifacts/referee-test-cache', server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const { mountRefereePage } = await vite.ssrLoadModule('/src/referee-page.js');
  const { createClubJourney } = await vite.ssrLoadModule('/src/club-journey.js');
  const saved = new Map(['document', 'location', 'localStorage', 'matchMedia'].map(key => [key, globalThis[key]]));
  let mountedPage;
  t.after(() => { mountedPage?.dispose(); for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const nodes = new Map(), radios = [];
  const node = () => ({ textContent: '', hidden: false, disabled: false, value: '', children: [], style: {}, dataset: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { this[name] = value; }, appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
    insertBefore(child, before) { this.children.splice(Math.max(0, this.children.indexOf(before)), 0, child); },
    replaceChildren(...children) { this.children = children; }, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener() {},
    click() { if (!this.disabled) for (const fn of this.listeners.click || []) fn({ target: this }); }, close() {}, showModal() {}, remove() {},
    get firstElementChild() { return this.children[0] ||= node(); },
    querySelector(selector) {
      const radio = selector.match(/value="(.*?)"/); if (radio) return radios.find(input => input.value === radio[1]);
      const key = selector.match(/data-ref="(.*?)"/)?.[1] || selector;
      if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key);
    }, querySelectorAll() { return radios; },
  });
  for (const value of ['neutral', 'p1', 'p2']) radios.push({ ...node(), value });
  globalThis.document = { body: node(), createElement: node, title: '', hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.location = { href: 'http://test/?role=referee&room=ABC234' }; globalThis.localStorage = store(); globalThis.matchMedia = () => ({ matches: false });
  let handlers;
  const page = mountRefereePage({ room: 'ABC234', createClientImpl: options => {
    handlers = options; return { stop() {}, restore: () => false, setFavorite: () => true, advanceRules: () => true };
  }, createArenaImpl: async () => ({ update() {}, dispose() {} }) });
  mountedPage = page; handlers.onStatus({ status: 'connected', message: 'Микрофон у вас' });
  const roster = [{ id: 'p1', name: 'ИСКРА', maxHp: 180, hp: 90, wins: 5 }, { id: 'p2', name: 'ИНЕЙ', maxHp: 180, hp: 0, wins: 2 }];
  const ended = { room: 'ABC234', round: 7, phase: 'matchOver', elapsed: 80, time: 40, winner: 'p1', players: roster, events: [], story: { sequenceId: 'one', stage: 'complete' } };
  const sent = [], journey = createClubJourney(node(), { send: packet => sent.push(packet), leave() {}, toggleSound() {}, toast() {} });
  t.after(() => journey.reset());
  // Deliberately reverse the roster and supply hostile names: both surfaces
  // must keep the correct corner, the same words and plain-text presentation.
  const fighters = [{ ...roster[1], name: '<img>\u202e{a}' }, { ...roster[0], name: 'Царь болтов' }];
  let rules;
  for (let index = 0; index < RULE_CARDS.length; index++) {
    rules = { ...ended, phase: 'story', players: fighters, referee: { connected: true }, story: {
      sequenceId: 'charter', stage: 'rules', ruleIndex: index, ruleCount: RULE_CARDS.length,
      ruleAcks: [], ready: { p1: true, p2: true }, paused: false, refereeConnected: true,
    } };
    if (nodes.has('.journey-rules')) nodes.get('.journey-rules').scrollTop = 123;
    journey.update(rules, 'p1'); handlers.onSnapshot(rules, { baseline: true, freshEvents: [] });
    assert.equal(nodes.get('[data-rule-text]').textContent, getClubRuleCard(index, fighters).text);
    assert.equal(nodes.get('script').textContent, nodes.get('[data-rule-text]').textContent);
    assert.doesNotMatch(nodes.get('script').textContent, /[<>{}\u202e]/u);
    assert.equal(nodes.get('[data-rule-text]').innerHTML, undefined, 'player names never enter HTML');
    assert.equal(nodes.get('script').innerHTML, undefined, 'referee names never enter HTML');
    assert.equal(nodes.get('[data-next]').disabled, true, 'only the connected referee can advance');
    assert.equal(nodes.get('ack').disabled, false);
    assert.equal(nodes.get('.journey-rules').scrollTop, 0, 'a new card starts at the top');
    nodes.get('.journey-rules').scrollTop = 45;
    journey.update(rules, 'p1');
    assert.equal(nodes.get('.journey-rules').scrollTop, 45, 'server ticks preserve the reading position');
  }
  rules.story = { ...rules.story, refereeConnected: false };
  journey.update(rules, 'p1'); nodes.get('[data-next]').click();
  assert.deepEqual(sent.at(-1), { type: 'storyAdvance', sequenceId: 'charter', ruleIndex: RULE_CARDS.length - 1 });
  rules.story.ruleAcks = ['p1']; journey.update(rules, 'p1');
  assert.equal(nodes.get('[data-next]').disabled, true, 'a fighter waits for the peer after acknowledging');
  rules.story = { ...rules.story, ruleAcks: [], refereeConnected: true, paused: true };
  journey.update(rules, 'p1'); handlers.onSnapshot(rules, { baseline: false, freshEvents: [] });
  assert.equal(nodes.get('[data-next]').disabled, true); assert.equal(nodes.get('ack').disabled, true);
  handlers.onSnapshot(ended, { baseline: true, freshEvents: [] });
  assert.match(nodes.get('script').textContent, /Победитель матча/); assert.equal(nodes.get('ack').disabled, false);
  nodes.get('ack').click(); assert.match(nodes.get('script').textContent, /последнее слово/);
  nodes.get('ack').click(); assert.match(nodes.get('script').textContent, /Оба участника/); assert.equal(nodes.get('ack').disabled, true);
  handlers.onSnapshot({ ...ended, elapsed: 81 }, { baseline: false, freshEvents: [] }); assert.doesNotMatch(nodes.get('script').textContent, /Победитель матча/);
  const intro = buildRoundIntro(roster, 'ABC234', 7, 4);
  for (const [elapsed, index] of [[.4, 0], [ROUND_INTRO_BEAT_DURATION - .01, 0], [ROUND_INTRO_BEAT_DURATION, 1], [ROUND_INTRO_DURATION - .01, 1]]) {
    handlers.onSnapshot({ ...ended, phase: 'story', elapsed: 90 + elapsed, story: { sequenceId: 'two', stage: 'roundIntro',
      roundIntro: { sequenceId: 'two:round7', round: 7, matchSerial: 4, elapsed, duration: ROUND_INTRO_DURATION } } }, { baseline: false, freshEvents: [] });
    assert.equal(nodes.get('title').textContent, roster.find(player => player.id === intro.beats[index].speaker).name);
    assert.equal(nodes.get('script').textContent, intro.beats[index].text);
    if (!index) assert.ok(nodes.get('next').textContent.includes(intro.beats[1].text));
    assert.equal(nodes.get('ack').disabled, true);
  }
  await Promise.resolve();
});
