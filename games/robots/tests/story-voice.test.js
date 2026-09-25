import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryVoice } from '../src/story-voice.js';

function harness(t, options = {}) {
  const sources = [], spoken = [], statuses = [], urls = [], handlers = new Map();
  const visibility = { hidden: false, addEventListener: (key, fn) => handlers.set(key, fn), removeEventListener: key => handlers.delete(key) };
  let available = options.voices || [], cancelCount = 0;
  const speech = { getVoices: () => available, addEventListener: (key, fn) => handlers.set(key, fn), removeEventListener: key => handlers.delete(key),
    speak: value => spoken.push(value), cancel: () => cancelCount++ };
  const ctx = { state: 'suspended', destination: {}, resume: async () => { ctx.state = 'running'; }, close: async () => { ctx.state = 'closed'; },
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }), decodeAudioData: async () => ({ duration: 12 }),
    createBufferSource() { const source = { connect() {}, disconnect() {}, stop() { source.stopped = true; }, start(...values) { source.startArgs = values; } }; sources.push(source); return source; } };
  const voice = createStoryVoice({ makeContext: () => ctx, speech, Utterance: class { constructor(text) { this.text = text; } }, visibility,
    assetUrl: path => '/robots' + path, onStatus: value => statuses.push(value), fetcher: async url => { urls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; } });
  t.after(() => voice.dispose());
  return { voice, sources, spoken, statuses, urls, handlers, visibility, ctx, get cancels() { return cancelCount; }, changeVoices(list) { available = list; handlers.get('voiceschanged')?.(); } };
}
const clip = { id: 'greet', at: 1, duration: 4, clip: 'greeting', clipOffset: .2, clipDuration: 8 };
const frame = (elapsed, patch = {}) => ({ sequenceId: 'scene-1', elapsed, beats: [clip], enabled: true, ...patch });

test('recordings preload under /robots; repeated packets never queue duplicate speech', async t => {
  const h = harness(t); await h.voice.unlock(); await h.voice.preload([clip, clip]);
  assert.deepEqual(h.urls, ['/robots/assets/voices/greeting.mp3']);
  h.voice.update(frame(0)); h.voice.update(frame(1.1)); h.voice.update(frame(1.1)); h.voice.update(frame(1.2));
  assert.equal(h.sources.length, 1); assert.ok(Math.abs(h.sources[0].startArgs[1] - .2) < .0001);
  assert.ok(Math.abs(h.sources[0].startArgs[2] - 8) < .0001);
});

test('late join and mute never replay past dialogue; pause resumes the same recording at scene offset', async t => {
  const h = harness(t); await h.voice.unlock(); await h.voice.preload([clip]);
  h.voice.update(frame(3)); assert.equal(h.sources.length, 0, 'late join stays quiet');
  h.voice.update(frame(1, { sequenceId: 'new-scene' })); assert.equal(h.sources.length, 1);
  h.voice.update(frame(3, { sequenceId: 'new-scene', paused: true })); assert.equal(h.sources[0].stopped, true);
  h.voice.update(frame(3, { sequenceId: 'new-scene', paused: true })); assert.equal(h.sources.length, 1);
  h.voice.update(frame(3, { sequenceId: 'new-scene' })); assert.equal(h.sources.length, 2); assert.equal(h.sources[1].startArgs[1], 2.2);
  h.voice.setMuted(true); assert.equal(h.sources[1].stopped, true); h.voice.setMuted(false); h.voice.update(frame(3.1, { sequenceId: 'new-scene' })); assert.equal(h.sources.length, 2);
});

test('TTS is opt-in and selects only a local Russian voice, with an honest missing-voice fallback', async t => {
  const h = harness(t, { voices: [{ name: 'Cloud RU', lang: 'ru-RU', localService: false }, { name: 'Local EN', lang: 'en-US', localService: true }] });
  await h.voice.unlock(); h.voice.setTtsEnabled(true); assert.equal(h.voice.getCapabilities().ttsAvailable, false); assert.match(h.voice.getCapabilities().message, /Русского голоса/);
  const name = { id: 'name-1', at: 0, duration: 2.3, ttsText: 'Я Медный Сом.' };
  h.voice.update(frame(0, { beats: [name] })); assert.equal(h.spoken.length, 0);
  const local = { name: 'Local RU', lang: 'ru-RU', localService: true }; h.changeVoices([local]);
  h.voice.update(frame(0, { sequenceId: 'scene-2', beats: [name] })); assert.equal(h.spoken.length, 1); assert.equal(h.spoken[0].voice, local);
  h.voice.update(frame(.1, { sequenceId: 'scene-2', beats: [name] })); assert.equal(h.spoken.length, 1);
  h.voice.setTtsEnabled(false); assert.equal(h.cancels, 1);
  h.voice.update(frame(0, { sequenceId: 'scene-3', beats: [name] })); assert.equal(h.spoken.length, 1, 'names do not speak without explicit opt-in');
});

test('hidden page, disabled stage, bounded name windows and disposal stop owned audio', async t => {
  const h = harness(t, { voices: [{ name: 'RU', lang: 'ru', localService: true }] }); await h.voice.unlock(); await h.voice.preload([clip]);
  h.voice.update(frame(1)); h.visibility.hidden = true; h.handlers.get('visibilitychange')(); assert.equal(h.sources[0].stopped, true);
  h.visibility.hidden = false; h.voice.update(frame(1.2)); assert.equal(h.sources.length, 1);
  h.voice.update(frame(1, { sequenceId: 's2' })); h.voice.update(frame(1.1, { sequenceId: 's2', enabled: false })); assert.equal(h.sources[1].stopped, true);
  h.voice.setTtsEnabled(true); const name = { id: 'name', at: 0, duration: 2.3, ttsText: 'Слишком длинное имя произносится без блокирования боя.' };
  h.voice.update(frame(0, { sequenceId: 's3', beats: [name] })); h.voice.update(frame(2.4, { sequenceId: 's3', beats: [name] })); assert.equal(h.cancels, 1);
  h.voice.dispose(); assert.equal(h.ctx.state, 'closed'); assert.equal(h.handlers.size, 0);
  h.voice.update(frame(1, { sequenceId: 's4' })); assert.equal(h.sources.length, 2);
});

test('a clip continuing beneath multiple subtitle beats is not truncated at the first caption', async t => {
  const h = harness(t); await h.voice.unlock(); await h.voice.preload([clip]);
  const nextCaption = { id: 'reply', at: 5, duration: 2, text: 'Дио!', speaker: 'p1' };
  h.voice.update(frame(1, { beats: [clip, nextCaption] })); h.voice.update(frame(5.2, { beats: [clip, nextCaption] }));
  assert.equal(h.sources.length, 1); assert.ok(!h.sources[0].stopped);
  h.voice.update(frame(9.01, { beats: [clip, nextCaption] })); assert.equal(h.sources[0].stopped, true);
});

test('leaving a paused story discards the resumable clip rather than leaking it into another stage', async t => {
  const h = harness(t); await h.voice.unlock(); await h.voice.preload([clip]);
  h.voice.update(frame(1)); h.voice.update(frame(2, { paused: true }));
  h.voice.update(frame(2, { paused: true, enabled: false }));
  h.voice.update(frame(2.1)); assert.equal(h.sources.length, 1);
});

test('packed generated lines play without browser TTS and keep precedence when device speech is enabled', async t => {
  const h = harness(t, { voices: [{ name: 'RU', lang: 'ru', localService: true }] });
  await h.voice.unlock(); h.voice.setTtsEnabled(true);
  const beat = { id: 'generated', at: 0, duration: 3.5, clip: 'jotaro-mode', clipDuration: 3.2, ttsText: 'Боевой режим: кабачковое противостояние!' };
  await h.voice.preload([beat]); h.voice.update(frame(0, { beats: [beat] }));
  assert.deepEqual(h.urls, ['/robots/assets/voices/generated/jotaro-mode.mp3']);
  assert.equal(h.sources.length, 1); assert.equal(h.spoken.length, 0);
  assert.equal(h.sources[0].startArgs[2], 3.2);
});

test('fresh jitter never trims a word; pause resumes its actual offset and overlapping beats wait', async t => {
  const h = harness(t); await h.voice.unlock();
  const first = { id: 'mode-a', at: 6.4, duration: 3.5, clip: 'jotaro-mode', clipDuration: 3.2 };
  const second = { id: 'mode-b', at: 9.9, duration: 3.1, clip: 'dio-mode', clipDuration: 2.55 };
  await h.voice.preload([first, second]);
  const next = (elapsed, paused = false) => h.voice.update(frame(elapsed, { beats: [first, second], paused }));
  next(6.75); assert.deepEqual(h.sources[0].startArgs, [0, 0, 3.2]);
  next(7.5, true); next(7.5);
  assert.equal(h.sources[1].startArgs[1], .75);
  next(9.9); assert.equal(h.sources.length, 2, 'second voice waits for full first line');
  next(9.96); assert.equal(h.sources.length, 3);
  assert.deepEqual(h.sources[2].startArgs, [0, 0, 2.55]);
});

test('stalled recordings time out twice and disposal aborts owned downloads', async () => {
  let requests = 0, aborts = 0;
  const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => {
    requests++;
    signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); }, { once: true });
  });
  const voice = createStoryVoice({ fetcher, loadTimeoutMs: 5, visibility: null, speech: null });
  await voice.preload([clip]);
  assert.equal(requests, 2); assert.equal(aborts, 2);
  await voice.preload([clip]); assert.equal(requests, 2, 'no unbounded background retry');
  const pending = voice.preload([{ ...clip, clip: 'dio-hero' }]);
  await Promise.resolve(); voice.dispose(); await pending;
  assert.equal(requests, 3); assert.equal(aborts, 3);
});
