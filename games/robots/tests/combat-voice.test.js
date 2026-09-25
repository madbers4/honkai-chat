import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { combatVoiceCue, createCombatVoice } from '../src/combat-voice.js';
import { COMBAT_VOICE_CLIPS as clips } from '../shared/combat-voice-clips.js';
import { CombatRoom } from '../server/combat.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const sources = [], requests = [], gains = [];
  const gain = () => {
    const node = { disconnected: false, connect() {}, disconnect() { this.disconnected = true; },
      gain: { setValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime(...args) { this.fade = args; } } };
    gains.push(node); return node;
  };
  const context = { currentTime: 0, state: 'running', createGain: gain,
    decodeAudioData: async bytes => {
      const id = new TextDecoder().decode(bytes);
      return { id, duration: clips[id].duration };
    },
    createBufferSource() {
      const source = { stops: [], disconnected: false, connect() {},
        disconnect() { this.disconnected = true; },
        start(...args) { this.started = args; },
        stop(...args) { this.stops.push(args); this.stopAt = args[0] ?? context.currentTime; } };
      sources.push(source); return source;
    } };
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    const id = new URL(url, 'http://fixture/').pathname.split('/').at(-1).replace('.mp3', '');
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(id).buffer };
  };
  function advance(time) {
    context.currentTime = time;
    for (const source of sources) {
      if (source.ended || !source.started) continue;
      const end = Math.min(source.stopAt ?? Infinity, source.started[0] + source.buffer.duration);
      if (time >= end) { source.ended = true; source.onended?.(); }
    }
  }
  return { context, sources, requests, gains, destination: gain(), fetcher, advance };
}

test('prepared assets are bounded, measured, versioned cuts of the unchanged user sources', async () => {
  const report = JSON.parse(await readFile(new URL('../docs/combat-voice-v3-analysis.json', import.meta.url)));
  assert.equal(Object.keys(clips).length, 10);
  assert.equal(report.clips.length, 10);
  assert.equal(report.listeningApproved, false, 'signal checks must not claim human listening approval');
  for (const [name, source] of Object.entries(report.sources)) {
    const bytes = await readFile(new URL(`../public${source.url}`, import.meta.url));
    assert.equal(sha(bytes), source.sha256, name);
  }
  for (const row of report.clips) {
    const clip = clips[row.id];
    assert.equal(clip.actor, row.actor);
    assert.equal(clip.duration, row.duration);
    assert.ok(clip.url.startsWith('/assets/voices/combat-v3/'));
    const bytes = await readFile(new URL(`../public${clip.url}`, import.meta.url));
    assert.equal(sha(bytes), row.sha256, row.id);
    assert.equal(sha(bytes), clip.sha256, row.id);
    assert.equal(bytes.length, clip.bytes);
    assert.equal(row.channels, 1); assert.equal(row.sampleRate, 24000);
    assert.equal(row.clippedSamples, 0);
    assert.ok(row.samplePeakDBFS < -1.5, row.id);
    const [start, end] = row.sourceInterval;
    assert.ok(start >= 0 && end <= report.sources[row.source].decodedDuration);
    assert.ok(Math.abs(end - start - clip.duration) <= 1 / 24000, 'no pitch/speed change or hidden truncation');
  }
  assert.ok(report.newPreloadBytes < report.oldPreloadBytes * .3, 'at least 70% smaller than old combat preload');
  assert.equal(Object.values(clips).reduce((sum, clip) => sum + clip.bytes, 0), report.newPreloadBytes);
  assert.equal(clips.explosion.actor, 'explosion');
  assert.equal(report.clips.find(row => row.id === 'explosion').source, 'explosion', 'the blast never includes a dialogue source');
});

test('fixed actors, separate ultimate recordings and one cue owner per combat action', () => {
  for (const player of ['p1', 'p2']) {
    const actor = player === 'p1' ? 'jotaro' : 'dio';
    for (const variant of ['jab', 'cross', 'rake', 'heavyDrive', 'heavyHook', 'heavyPress', 'airFinish', 'slam']) {
      const cue = combatVoiceCue({ type: 'attack', player, variant });
      assert.equal(cue.actor, actor); assert.equal(clips[cue.clip].actor, actor);
      assert.equal(cue.offset, undefined); assert.equal(cue.duration, undefined);
    }
    for (const type of ['hit', 'block', 'launch', 'slam', 'ultimatePulse', 'throw', 'grab']) {
      assert.equal(combatVoiceCue({ type, player, variant: 'slam' }), null, `${type} does not duplicate the action-start cry`);
    }
  }
  const p1 = combatVoiceCue({ type: 'ultimate', player: 'p1' });
  const p2 = combatVoiceCue({ type: 'ultimate', player: 'p2' });
  assert.notEqual(p1.clip, p2.clip);
  assert.notEqual(clips[p1.clip].sha256, clips[p2.clip].sha256);
  assert.equal(combatVoiceCue({ type: 'finisherStart', player: 'p2' }).clip, 'dio-barrage');
  assert.equal(combatVoiceCue({ type: 'attack', player: 'p1', variant: 'grab' }), null, 'a grab attempt is not a held strike');
  assert.equal(combatVoiceCue({ type: 'attack', player: 'invented', variant: 'jab' }), null);
  assert.equal(combatVoiceCue({ type: 'destruction' }).actor, 'explosion');
});

test('preload fetches only the ten compact files, joins in-flight calls and decodes once', async () => {
  const f = fixture(); let resolve;
  const gate = new Promise(r => { resolve = r; });
  const voice = createCombatVoice({ ...f, fetcher: async (...args) => { await gate; return f.fetcher(...args); } });
  const first = voice.preload(), second = voice.preload();
  resolve(); await Promise.all([first, second]);
  assert.equal(f.requests.length, 10);
  assert.equal(new Set(f.requests.map(item => item.url)).size, 10);
  assert.ok(f.requests.every(item => item.url.includes('/assets/voices/combat-v3/')));
  assert.ok(f.requests.every(item => !item.url.includes('duo-super')));
  await voice.preload(); assert.equal(f.requests.length, 10);
  voice.dispose();
});

test('rapid punches do not cut a complete cry, overlap an actor, or enqueue late sounds', async () => {
  const f = fixture(), voice = createCombatVoice(f); await voice.preload();
  assert.equal(voice.play({ id: 2, type: 'attack', player: 'p1', variant: 'jab' }), true);
  const first = f.sources[0];
  assert.deepEqual(first.started, [0], 'whole prepared buffer, without runtime offset/duration');
  for (const [time, variant, id] of [[.18, 'cross', 3], [.41, 'rake', 4], [.7, 'jab', 5], [.9, 'heavyDrive', 6]]) {
    f.advance(time);
    assert.equal(voice.play({ id, type: 'attack', player: 'p1', variant }), false);
  }
  assert.deepEqual(first.stops, [], 'even high-impact followups do not cut the current word');
  f.advance(first.buffer.duration + .07);
  assert.equal(f.sources.length, 1, 'dropped cries do not start later');
  assert.equal(voice.play({ id: 7, type: 'attack', player: 'p1', variant: 'rake' }), true);
  assert.equal(f.sources[1].buffer.id, 'jotaro-finisher');
  assert.equal(voice.play({ id: 8, type: 'attack', player: 'p2', variant: 'jab' }), true, 'the opponent has an independent actor channel');
  assert.equal(voice.stats().active, 2);
  voice.dispose();
});

test('server jab-cross-rake event chain produces no duplicate impact cries or 180ms retriggers', async () => {
  const f = fixture(), voice = createCombatVoice(f); await voice.preload();
  const room = new CombatRoom({ random: () => .8 });
  room.addPlayer('One'); room.addPlayer('Two'); room.ready('p1'); room.ready('p2');
  for (let i = 0; i < 180; i++) room.step(1 / 60);
  room.player('p1').x = -1.075; room.player('p2').x = 1.075;
  const events = [], emit = room.event.bind(room), start = room.elapsed;
  room.event = (...args) => { emit(...args); const event = { ...room.events.at(-1) };
    events.push(event); f.advance(room.elapsed - start); voice.play(event); };
  const press = seconds => {
    room.input('p1', { seq: room.player('p1').lastSeq + 1, move: 0, block: false, crouch: false, action: 'light' });
    for (let i = 0; i < Math.ceil(seconds * 60); i++) room.step(1 / 60);
  };
  press(.18); press(.23); press(.4);
  assert.deepEqual(events.filter(event => event.type === 'attack').map(event => event.variant), ['jab', 'cross', 'rake']);
  assert.equal(events.filter(event => event.type === 'hit').length, 3);
  assert.equal(f.sources.length, 1);
  assert.deepEqual(f.sources[0].stops, []);
  voice.dispose();
});

test('a delivered event remains consumed after its sound ends; dedup storage is bounded', async () => {
  const f = fixture(), voice = createCombatVoice(f); await voice.preload();
  const event = { id: 4, at: 10, type: 'attack', player: 'p2', variant: 'jab' };
  assert.equal(voice.play(event), true);
  f.advance(2);
  assert.equal(voice.play({ ...event }), false);
  for (let id = 5; id < 700; id++) voice.play({ id, at: 10, type: 'hit', player: 'p2' });
  assert.equal(voice.stats().seen, 256);
  voice.dispose();
});

test('a completed short cry gets a breath and ultimate pulses never restart the actor recording', async () => {
  const f = fixture(), voice = createCombatVoice(f); await voice.preload();
  voice.play({ type: 'attack', player: 'p2', variant: 'jab' });
  f.advance(clips['dio-single-a'].duration + .02);
  assert.equal(voice.play({ type: 'attack', player: 'p2', variant: 'cross' }), false);
  f.advance(clips['dio-single-a'].duration + .061);
  assert.equal(voice.play({ type: 'ultimate', player: 'p2' }), true);
  const ultimate = f.sources.at(-1), began = f.context.currentTime;
  assert.equal(ultimate.buffer.id, 'dio-ultimate');
  for (const [pulse, time] of [.95, 1.23, 1.55].entries()) {
    f.advance(began + time);
    assert.equal(voice.play({ type: 'ultimatePulse', player: 'p2', pulse }), false);
    assert.equal(voice.play({ type: 'hit', player: 'p2', variant: 'overload' }), false);
  }
  voice.play({ type: 'ko', player: 'p1' });
  voice.play({ type: 'win', player: 'p2' });
  assert.deepEqual(ultimate.stops, [], 'opponent KO/result does not chop the final MUDA run');
  assert.equal(f.sources.length, 2);
  voice.dispose();
});

test('historical attacks and lifecycle events neither speak nor cut live audio', async () => {
  const f = fixture(), voice = createCombatVoice(f); await voice.preload();
  voice.play({ type: 'ultimate', player: 'p1' });
  for (const type of ['attack', 'ko', 'round', 'fight', 'destruction']) {
    assert.equal(voice.play({ type, player: 'p1', variant: 'jab', presentationHistorical: true }), false);
  }
  assert.equal(voice.stats().active, 1);
  assert.deepEqual(f.sources[0].stops, []);
  voice.dispose();
});

test('KO fades only the defeated actor; round cleanup includes blast tails and old fade callbacks are safe', async () => {
  const f = fixture(), voice = createCombatVoice(f); await voice.preload();
  voice.play({ type: 'attack', player: 'p1', variant: 'jab' });
  voice.play({ type: 'attack', player: 'p2', variant: 'jab' });
  const oldEnd = f.sources[0].onended;
  voice.play({ type: 'ko', player: 'p1' });
  assert.deepEqual(f.sources[0].stops, [[.03]]);
  assert.equal(voice.stats().active, 1); assert.equal(voice.stats().fading, 1);
  f.advance(.031);
  voice.play({ type: 'ultimate', player: 'p1' });
  oldEnd(); assert.equal(voice.stats().active, 2, 'stale completion does not remove a replacement');
  voice.play({ type: 'destruction', player: 'p1' });
  assert.equal(voice.stats().active, 3);
  voice.play({ type: 'round', id: 99 });
  assert.equal(voice.stats().active, 0);
  f.advance(.062);
  assert.equal(voice.stats().fading, 0);
  assert.ok(f.sources.every(source => source.disconnected));
  voice.dispose();
});

test('mute, suspension, explicit pause and disposal leave no delayed playback', async () => {
  const f = fixture(); let muted = false;
  const voice = createCombatVoice({ ...f, muted: () => muted }); await voice.preload();
  const event = { type: 'attack', player: 'p1', variant: 'jab' };
  voice.play(event); muted = true; voice.stop(); f.advance(.04);
  assert.equal(voice.play(event), false);
  muted = false; f.context.state = 'suspended';
  assert.equal(voice.play(event), false);
  f.context.state = 'running'; voice.dispose();
  assert.equal(voice.play(event), false);
  assert.equal(voice.stats().active, 0); assert.equal(voice.stats().fading, 0);
  assert.ok(f.sources.every(source => source.disconnected));
});

test('a cold event is dropped forever, while a distinct later event can use the warmed file', async () => {
  const f = fixture(); let resolveFetch;
  const voice = createCombatVoice({ ...f, fetcher: url => new Promise(resolve => {
    resolveFetch = async () => resolve(await f.fetcher(url));
  }) });
  const event = { id: 2, type: 'attack', player: 'p1', variant: 'jab' };
  assert.equal(voice.play(event), false);
  await resolveFetch(); await flush();
  assert.equal(f.sources.length, 0);
  assert.equal(voice.play(event), false, 'the same server event cannot speak after downloading');
  assert.equal(voice.play({ ...event, id: 4 }), true);
  voice.dispose();
});

test('optional fetch failures and nonsettling fetches have bounded retries and disposal', async () => {
  const f = fixture(); let calls = 0;
  const voice = createCombatVoice({ ...f, fetcher: async () => { calls++; throw Error('offline'); } });
  for (let i = 0; i < 5; i++) { voice.play({ type: 'attack', player: 'p1', variant: 'jab' }); await flush(); }
  assert.equal(calls, 2); voice.dispose();
  const hanging = createCombatVoice({ ...f, loadTimeoutMs: 10, fetcher: () => new Promise(() => {}) });
  await hanging.preload(); assert.equal(hanging.stats().loaded, 0);
  hanging.dispose();
  let decoded = 0; const pending = [];
  f.context.decodeAudioData = async () => { decoded++; return { duration: 1 }; };
  const late = createCombatVoice({ ...f, fetcher: () => new Promise(resolve => pending.push(resolve)) });
  const preload = late.preload(); late.dispose(); await preload;
  for (const resolve of pending) resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  await flush(); assert.equal(decoded, 0, 'disposed requests do not decode late audio');
  assert.equal(late.stats().loaded, 0);
});
