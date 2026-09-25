import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundIntro } from '../shared/round-intro.js';

// Load the real route handlers. Replace rendering/input surfaces, not snapshot
// routing or GameAudio.stop: the latter must also stop active synthesizer nodes.
const routeStubs = {
  'arena.js': 'export async function createArena() { return {update(){},setSuspended(){},dispose(){}}; }',
  'story-ui.js': 'export function createStoryUI() { return {update(){},profile(){return {}},reset(){}}; }',
  'club-journey.js': `export function createClubJourney() { return {
    update(state) { globalThis.__storyAudioTransition.present(state); return state.phase === 'story'; },
    previewActive(){return false},profile(){return {}},setInvite(){},setConnected(){},unlock(){},reset(){}
  }; }`,
  'input.js': 'export function createControls() { return {neutral(){},resetSequence(){},intent(){return {}}}; }',
  'ultimate-ui.js': 'export function createUltimateUI() { return {update(){},hold(){}}; }',
  'combat-ui.js': 'export function createCombatUI() { return {update(){},event(){},reset(){},stats(){return {}}}; }',
  'graphics-settings.js': 'export function mountGraphicsSettings() {}',
  'menu-viewport.js': 'export function installMenuViewport() {}',
};

function domFixture() {
  const nodes = new Map(), radios = [];
  const get = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  const node = () => ({ children: [], style: {}, dataset: {}, listeners: {}, value: '', textContent: '', disabled: false,
    classList: { add(){}, remove(){}, toggle(){} },
    setAttribute(key, value) { this[key] = value; }, insertAdjacentHTML(){},
    appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }, removeEventListener(){},
    querySelector(selector) {
      const radio = selector.match(/value="(.*?)"/);
      return radio ? radios.find(input => input.value === radio[1]) : get(selector.match(/data-ref="(.*?)"/)?.[1] || selector);
    },
    querySelectorAll() { return radios; }, remove(){}, close(){}, showModal(){},
    get firstElementChild() { return this.children[0] ||= node(); },
  });
  for (const value of ['neutral', 'p1', 'p2']) radios.push({ ...node(), value });
  const listeners = new Map();
  return { nodes, document: { body: node(), createElement: node, getElementById: get,
    querySelector: get, querySelectorAll: () => [], hidden: false,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) || []) listener(); },
  } };
}

test('player and referee stop a surviving final blast before rematch story, once per transition', async t => {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: false, cacheDir: 'artifacts/story-audio-transition-cache',
    server: { middlewareMode: true, ws: false }, appType: 'custom', plugins: [{ name: 'route-rendering-fixture', enforce: 'pre',
      load(id) { return id.replaceAll('\\', '/').includes('/src/') ? routeStubs[id.split(/[\\/]/).at(-1)] : undefined; },
    }] });
  t.after(() => vite.close());
  const saved = new Map(['document', 'location', 'history', 'localStorage', 'sessionStorage', 'matchMedia', 'fetch',
    'WebSocket', '__storyAudioTransition'].map(key => [key, globalThis[key]]));
  let refereePage;
  t.after(() => { refereePage?.dispose(); for (const [key, value] of saved) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  const { nodes, document } = domFixture();
  const storage = new Map();
  globalThis.document = document;
  globalThis.location = { href: 'http://test/', origin: 'http://test', hostname: 'test' };
  globalThis.history = { replaceState(){} };
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.sessionStorage = { ...globalThis.localStorage };
  sessionStorage.setItem('belobog-session', JSON.stringify({ room: 'ABC234', playerId: 'p1', token: 'saved', mode: 'pvp' }));
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.fetch = async () => ({ ok: false });
  const timers = new Set();
  const setTimer = globalThis.setTimeout, setRepeating = globalThis.setInterval;
  t.mock.method(globalThis, 'setTimeout', (fn, ...args) => { const handle = setTimer(fn, ...args); timers.add(handle); return handle; });
  t.mock.method(globalThis, 'setInterval', (fn, ...args) => { const handle = setRepeating(fn, ...args); timers.add(handle); return handle; });
  t.after(() => { for (const timer of timers) { clearTimeout(timer); clearInterval(timer); } });
  const sockets = [];
  globalThis.WebSocket = class Socket {
    static OPEN = 1; static CONNECTING = 0;
    constructor() { this.listeners = {}; this.readyState = 1; sockets.push(this); }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    send() {}
    close() { this.readyState = 3; }
    emit(type, value = {}) { for (const listener of this.listeners[type] || []) listener(value); }
    snapshot(state) { for (const listener of this.listeners.message || []) listener({ data: JSON.stringify({ type: 'state', state }) }); }
  };
  const { GameAudio } = await vite.ssrLoadModule('/src/audio.js');
  const audioStates = new Map();
  const observe = audio => {
    if (!audioStates.has(audio)) audioStates.set(audio, { stops: 0, blast: false, tone: false, events: [], music: [], resets: 0 });
    return audioStates.get(audio);
  };
  const originalStop = GameAudio.prototype.stop;
  const originalMusic = GameAudio.prototype.updateMusic, originalReset = GameAudio.prototype.resetMusic;
  t.mock.method(GameAudio.prototype, 'updateMusic', function(state, options) {
    observe(this).music.push({ phase: state?.phase, paused: state?.story?.paused, hidden: document.hidden,
      connected: options?.connected, muted: this.muted });
    originalMusic.call(this, state, options);
  });
  t.mock.method(GameAudio.prototype, 'resetMusic', function() { observe(this).resets++; originalReset.call(this); });
  t.mock.method(GameAudio.prototype, 'stop', function() { observe(this).stops++; originalStop.call(this); });
  t.mock.method(GameAudio.prototype, 'play', function(type) {
    const observed = observe(this); observed.events.push(type);
    if (type === 'destruction') {
      // The new 5.125s recording still has 3.575s left when matchOver arrives.
      // Do not expire it on win: exercise the actual transition interruption.
      observed.blast = observed.tone = true;
      this.combatVoice = { stop() { observed.blast = false; } };
      this.voices.add({ stop() { observed.tone = false; } });
    }
  });
  const presentations = [];
  globalThis.__storyAudioTransition = { present(state) {
    if (state.phase === 'story') presentations.push([...audioStates.values()].map(value => ({ ...value })));
  } };
  const players = [
    { id: 'p1', name: 'Искра', maxHp: 240, hp: 180, wins: 5, energy: 80, guard: 100 },
    { id: 'p2', name: 'Иней', maxHp: 240, hp: 0, wins: 2, energy: 0, guard: 100 },
  ];
  const base = { room: 'ABC234', round: 7, phase: 'fight', elapsed: 80, time: 40, players, events: [], story: { stage: 'complete' } };
  const intro = buildRoundIntro(players, 'ABC234', 1, 1);
  const rematch = { ...base, phase: 'story', round: 1, events: [{ id: 3, type: 'round' }], story: {
    sequenceId: 'rematch', stage: 'roundIntro', roundIntro: { sequenceId: 'rematch:round1', round: 1,
      matchSerial: 1, elapsed: 0, duration: intro.duration },
  } };
  async function checkRoute(label, send, observedAudio) {
    send(base); // Establish a live stream: destruction is not a historical event.
    send({ ...base, phase: 'finishing', events: [{ id: 1, type: 'destruction', player: 'p2' }] });
    const observed = observedAudio();
    assert.equal(observed.blast, true, `${label}: blast is playing before the result`);
    send({ ...base, phase: 'matchOver', winner: 'p1', events: [] });
    assert.equal(observed.blast, true, `${label}: result preserves the deliberate final decay`);
    const previousStops = observed.stops;
    send(rematch);
    assert.equal(observed.music.at(-1).phase, 'story', `${label}: music gets the new phase even when story consumes events`);
    assert.equal(observed.music.at(-1).connected, true);
    assert.equal(observed.blast, false, `${label}: fast rematch stops the remaining recording`);
    assert.equal(observed.tone, false, `${label}: synthesized explosion layers also stop`);
    assert.equal(observed.stops, previousStops + 1);
    assert.equal(observed.events.includes('round'), false, `${label}: story still suppresses the round event`);
    for (const elapsed of [.05, .1, .5]) send({ ...rematch, story: { ...rematch.story,
      roundIntro: { ...rematch.story.roundIntro, elapsed } } });
    assert.equal(observed.stops, previousStops + 1, `${label}: repeated story snapshots do not interrupt audio again`);
    send({ ...base, phase: 'fight', events: [] });
    send({ ...rematch, story: { ...rematch.story, paused: true } });
    assert.equal(observed.stops, previousStops + 2, `${label}: a new story entry also clears combat when paused`);
    assert.equal(observed.music.at(-1).paused, true, `${label}: paused story also pauses the soundtrack`);
  }
  await vite.ssrLoadModule('/src/main.js');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets.length, 1, 'the real player route restores its saved connection');
  sockets[0].emit('open');
  await checkRoute('player', state => sockets[0].snapshot(state), () => [...audioStates.values()][0]);
  assert.ok(presentations.length > 0);
  assert.ok(presentations.every(values => values.every(value => !value.blast && !value.tone)), 'combat stops before journey.update can start the first spoken line');
  const playerAudio = [...audioStates.values()][0];
  document.hidden = true; document.emit('visibilitychange'); assert.equal(playerAudio.music.at(-1).hidden, true);
  document.hidden = false; document.emit('visibilitychange'); assert.equal(playerAudio.music.at(-1).hidden, false);
  sockets[0].emit('close', { code: 1006 }); assert.equal(playerAudio.music.at(-1).connected, false);
  const reconnectUpdates = playerAudio.music.length;
  sockets[0].emit('open'); assert.equal(playerAudio.music.length, reconnectUpdates, 'socket open waits for a fresh snapshot before resuming');
  sockets[0].snapshot(rematch); assert.equal(playerAudio.music.at(-1).connected, true);
  for (const click of nodes.get('game-leave-btn').listeners.click) click();
  assert.equal(playerAudio.resets, 1, 'leaving the player room resets the OST');
  const { mountRefereePage } = await vite.ssrLoadModule('/src/referee-page.js');
  let handlers;
  refereePage = mountRefereePage({ room: 'ABC234', createClientImpl: options => {
    handlers = options; return { stop(){ options.onStatus({ status: 'idle' }); }, restore: () => false, setFavorite: () => true };
  }, createArenaImpl: async () => ({ update(){}, dispose(){} }) });
  handlers.onStatus({ status: 'connected' });
  await checkRoute('referee', state => {
    handlers.onSnapshot(state, { baseline: false, freshEvents: state.events });
    if (state.phase === 'story') assert.equal(nodes.get('script').textContent, intro.beats[0].text, 'the referee keeps the same first reading cue');
  }, () => [...audioStates.values()][1]);
  const refereeAudio = [...audioStates.values()][1];
  assert.equal(refereeAudio.music.at(-1).muted, true, 'referee music remains muted by default');
  document.hidden = true; document.emit('visibilitychange'); assert.equal(refereeAudio.music.at(-1).hidden, true);
  document.hidden = false; document.emit('visibilitychange'); assert.equal(refereeAudio.music.at(-1).hidden, false);
  handlers.onStatus({ status: 'reconnecting' }); assert.equal(refereeAudio.music.at(-1).connected, false);
  const refereeUpdates = refereeAudio.music.length;
  handlers.onStatus({ status: 'connected' }); assert.equal(refereeAudio.music.length, refereeUpdates);
  handlers.onSnapshot(rematch, { baseline: true, freshEvents: [] }); assert.equal(refereeAudio.music.at(-1).connected, true);
  const resets = refereeAudio.resets;
  for (const click of nodes.get('leave').listeners.click) click();
  assert.equal(refereeAudio.resets, resets + 1, 'leaving the referee room resets the OST');
});
