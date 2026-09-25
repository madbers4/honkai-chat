import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBattleMusic, BATTLE_MUSIC } from '../src/battle-music.js';
import { GameAudio } from '../src/audio.js';

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture() {
  const calls = [], elements = [], nodes = [], pending = [];
  let deferred = false;
  const context = { currentTime: 10, destination: { name: 'output' },
    createGain() {
      const gain = { value: 1, cancelAndHoldAtTime: t => calls.push(['hold', t]),
        setValueAtTime(value, t) { this.value = value; calls.push(['set', value, t]); },
        linearRampToValueAtTime(value, t) { this.value = value; calls.push(['ramp', value, t]); } };
      const node = { gain, connect(to) { this.to = to; }, disconnect() { this.disconnected = true; } };
      nodes.push(node); return node;
    },
    createMediaElementSource(element) {
      const node = { element, connect(to) { this.to = to; }, disconnect() { this.disconnected = true; } };
      nodes.push(node); return node;
    },
    decodeAudioData() { assert.fail('the soundtrack must never be decoded as a whole AudioBuffer'); },
  };
  const createAudio = () => {
    const listeners = new Map();
    const element = { currentTime: 0, paused: true, error: null, playCount: 0, pauseCount: 0, loadCount: 0,
      addEventListener: (key, listener) => listeners.set(key, listener), removeEventListener: key => listeners.delete(key),
      emit: key => listeners.get(key)?.(),
      play() {
        this.playCount++; this.paused = false;
        if (!deferred) return Promise.resolve();
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      },
      pause() { this.pauseCount++; this.paused = true; },
      load() { this.loadCount++; }, removeAttribute(key) { delete this[key]; }, listeners,
    };
    elements.push(element); return element;
  };
  const music = createBattleMusic({ context, createAudio, url: '/robots/assets/music/club-ost-290.mp3' });
  return { music, context, calls, elements, nodes, pending, defer() { deferred = true; } };
}

test('OST is lazy, uses native loop and one streamed element, and ducks without round restarts', async () => {
  const f = fixture();
  f.music.update({ phase: 'story', connected: true });
  assert.equal(f.elements.length, 0, 'snapshots cannot download music before any gesture');
  f.music.update({ phase: null }); f.music.unlock();
  assert.equal(f.elements.length, 0, 'lobby gestures do not preload five minutes of music');
  f.music.update({ phase: 'story' }); await settle();
  const element = f.elements[0];
  assert.equal(element.src, '/robots/assets/music/club-ost-290.mp3');
  assert.equal(element.preload, 'none'); assert.equal(element.loop, true);
  assert.equal(f.nodes[1].element, element); assert.equal(f.nodes[1].to, f.nodes[0]);
  assert.equal(f.nodes[0].to, f.context.destination, 'music bypasses the combat compressor/master');
  assert.deepEqual(f.calls.at(-1), ['ramp', BATTLE_MUSIC.quiet, 10.6]);
  element.currentTime = 84;
  f.context.currentTime = 11; f.music.update({ phase: 'countdown' });
  assert.deepEqual(f.calls.at(-1), ['ramp', BATTLE_MUSIC.fight, 11.6]);
  const rampCount = f.calls.length;
  for (let i = 0; i < 100; i++) f.music.update({ phase: 'fight' });
  assert.equal(f.calls.length, rampCount, 'same volume does not reschedule gain automation per snapshot');
  f.context.currentTime = 12; f.music.update({ phase: 'story' });
  assert.deepEqual(f.calls.at(-1), ['ramp', BATTLE_MUSIC.quiet, 12.25]);
  for (const phase of ['roundOver', 'matchOver', 'waiting', 'story', 'countdown', 'fight', 'finishing']) f.music.update({ phase });
  assert.equal(element.playCount, 1); assert.equal(element.pauseCount, 0);
  assert.equal(element.currentTime, 84, 'new rounds and a rematch keep the same musical timeline');
  f.music.dispose();
});

test('mute, hidden tab, paused scene and transport disconnect pause and resume at the saved position', async () => {
  const f = fixture(); f.music.unlock(); f.music.update({ phase: 'fight', connected: true }); await settle();
  const element = f.elements[0]; element.currentTime = 209;
  for (const key of ['muted', 'hidden', 'paused']) {
    f.music.update({ [key]: true }); assert.equal(element.paused, true);
    assert.equal(f.nodes[0].gain.value, 0); assert.equal(element.currentTime, 209);
    const plays = element.playCount;
    for (let i = 0; i < 30; i++) f.music.update({ phase: 'fight' });
    assert.equal(element.playCount, plays);
    f.music.update({ [key]: false }); await settle(); assert.equal(element.paused, false);
  }
  f.music.update({ connected: false }); assert.equal(element.paused, true);
  f.music.update({ phase: 'story' }); assert.equal(element.paused, true, 'stale snapshots cannot resume a disconnected room');
  f.music.update({ connected: true }); await settle();
  assert.equal(element.currentTime, 209); assert.equal(element.paused, false);
  f.music.reset(); assert.equal(element.paused, true); assert.equal(element.currentTime, 0, 'leaving the room rewinds');
  f.music.update({ phase: 'story', connected: true }); await settle();
  assert.equal(f.elements.length, 1, 'rejoining still owns only one media element');
  f.music.dispose(); assert.ok(f.nodes.every(node => node.disconnected));
  assert.equal(element.src, undefined); assert.equal(element.listeners.size, 0);
  const plays = element.playCount; f.music.unlock(); f.music.update({ phase: 'fight' });
  assert.equal(element.playCount, plays, 'disposed music cannot revive');
});

test('autoplay refusal waits for another gesture, not repeated snapshots; pending resumes cannot race', async () => {
  const f = fixture(); f.defer(); f.music.update({ phase: 'story', connected: true }); f.music.unlock();
  const element = f.elements[0];
  for (let i = 0; i < 100; i++) f.music.update({ phase: 'story' });
  assert.equal(element.playCount, 1, 'one unresolved play promise');
  f.pending[0].reject(new Error('NotAllowedError')); await settle();
  for (let i = 0; i < 100; i++) f.music.update({ phase: 'fight' });
  assert.equal(element.playCount, 1, 'autoplay rejection does not turn every packet into a retry');
  assert.equal(f.nodes[0].gain.value, 0);
  f.music.unlock(); assert.equal(element.playCount, 2);
  f.music.update({ hidden: true }); f.music.update({ hidden: false });
  assert.equal(element.playCount, 2, 'do not race a pending request with a resume');
  f.pending[1].resolve(); await settle();
  assert.equal(element.playCount, 3, 'after the interrupted request settles, exactly one resume is issued');
  f.pending[2].resolve(); await settle();
  assert.equal(element.paused, false);
  element.error = { code: 2 }; element.emit('error');
  assert.equal(element.paused, true);
  f.music.update({ phase: 'story' }); assert.equal(element.playCount, 3, 'network/media errors also wait for a gesture');
  f.music.unlock(); assert.equal(element.loadCount, 1, 'explicit retry reloads a failed media resource');
  assert.equal(element.playCount, 4);
  f.music.dispose(); f.pending[3].resolve(); await settle();
  assert.equal(element.paused, true); assert.equal(element.playCount, 4, 'late resolution cannot revive a disposed stream');
});

test('GameAudio keeps music outside stop(), shares mute, and forwards story pause/visibility separately', () => {
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage };
  try {
    globalThis.document = { hidden: false };
    const storage = new Map(); globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    const audio = new GameAudio(), calls = [];
    audio.music = { update: state => calls.push(['music', state]), reset: () => calls.push(['reset']), dispose: () => calls.push(['dispose']) };
    audio.combatVoice = { stop: () => calls.push(['combatStop']) };
    audio.voices.add({ stop: () => calls.push(['toneStop']) });
    audio.updateMusic({ phase: 'story', story: { paused: true } }, { connected: true });
    assert.deepEqual(calls.at(-1), ['music', { phase: 'story', paused: true, connected: true, hidden: false, muted: false }]);
    const before = calls.length; audio.stop();
    assert.deepEqual(calls.slice(before), [['combatStop'], ['toneStop']], 'round-tail fix stops SFX without stopping or resetting the OST');
    audio.toggle(); assert.deepEqual(calls.at(-1), ['music', { muted: true }]);
    globalThis.document.hidden = true;
    audio.updateMusic({ phase: 'fight' }, { connected: false });
    assert.deepEqual(calls.at(-1), ['music', { phase: 'fight', paused: false, connected: false, hidden: true, muted: true }]);
    audio.resetMusic(); assert.equal(audio.musicState, null); assert.equal(audio.musicConnected, false);
    audio.disposeMusic(); assert.deepEqual(calls.slice(-2), [['reset'], ['dispose']]);
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test('shipped OST is exactly 290 decoded seconds, stereo 44.1kHz 128kbps, without cover art or tags', () => {
  const bytes = readFileSync(new URL(`../public${BATTLE_MUSIC.url}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'a1be5cb4fc2dfcddfeafd57b71007a1ac244fc296382d4b52dbc17f0efe9cc70');
  assert.equal(bytes.length, 4641017);
  const info = 36;
  assert.equal(bytes.toString('ascii', info, info + 4), 'Info');
  const frames = bytes.readUInt32BE(info + 8), encoder = info + 120;
  assert.match(bytes.toString('ascii', encoder, encoder + 9), /^(LAME|Lavc)/);
  const delay = (bytes[encoder + 21] << 4) | (bytes[encoder + 22] >> 4);
  const padding = ((bytes[encoder + 22] & 15) << 8) | bytes[encoder + 23];
  assert.equal((frames * 1152 - delay - padding) / 44100, BATTLE_MUSIC.duration, 'native loop uses gapless encoder trim, not an arbitrary JS timeupdate seek');
  let offset = 0, count = 0;
  while (offset < bytes.length) {
    const header = bytes.readUInt32BE(offset);
    assert.equal(header >>> 21, 2047); assert.equal((header >>> 19) & 3, 3, 'MPEG-1');
    assert.equal((header >>> 17) & 3, 1, 'Layer III'); assert.equal((header >>> 12) & 15, 9, '128 kbps');
    assert.equal((header >>> 10) & 3, 0, '44100 Hz'); assert.notEqual((header >>> 6) & 3, 3, 'two-channel stereo');
    offset += Math.floor(144000 * 128 / 44100) + ((header >>> 9) & 1); count++;
  }
  assert.equal(offset, bytes.length, 'only complete MPEG frames, no embedded images or ID3 metadata');
  assert.equal(count, frames + 1);
});
