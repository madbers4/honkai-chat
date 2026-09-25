import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRoundIntro as buildCurrentRoundIntro, activeRoundIntroBeat, ROUND_INTRO_DURATION, ROUND_INTRO_BEAT_DURATION } from '../shared/round-intro.js';
import { PREMATCH_EXCHANGES } from '../shared/club-story.js';
import { GENERATED_VOICE_CLIPS } from '../shared/generated-voice-clips.js';
import { createRoundIntroUI } from '../src/round-intro-ui.js';
import { createStoryVoice } from '../src/story-voice.js';

const players = [{ id: 'copper', name: 'Медный Сом' }, { id: 'baron', name: 'Барон Коротыш' }];
// This file preserves the old-pack/TTS fallback contract. The complete 57-take
// catalogue and adaptive timings are exercised in spoken-runtime.test.js.
const legacyCatalog=Object.fromEntries(Object.entries(GENERATED_VOICE_CLIPS).filter(([id])=>/^(jotaro|dio)-(mode|round-[12])$/.test(id)));
const buildRoundIntro=(players,room,round,serial)=>buildCurrentRoundIntro(players,room,round,serial,{catalog:legacyCatalog});

test('round exchange is deterministic, independent of names and composed of two exact speaking windows', () => {
  const intro = buildRoundIntro(players, 'ROOM-42', 3, 2);
  assert.deepEqual(intro, buildRoundIntro(players, { id: 'ROOM-42' }, 3, 2));
  assert.deepEqual(intro, buildRoundIntro(players.map(p => ({ ...p, name: '<script>{a}</script>' })), 'ROOM-42', 3, 2));
  assert.equal(intro.duration, ROUND_INTRO_DURATION); assert.equal(intro.duration, 2 * ROUND_INTRO_BEAT_DURATION); assert.equal(intro.round, 3);
  assert.ok(PREMATCH_EXCHANGES.some(pair => pair.id === intro.exchangeId && pair.setup === intro.title));
  assert.equal(intro.beats.length, 2);
  assert.deepEqual(intro.beats.map(b => [b.at, b.duration]), [[0, ROUND_INTRO_BEAT_DURATION], [ROUND_INTRO_BEAT_DURATION, ROUND_INTRO_BEAT_DURATION]]);
  assert.equal(intro.beats[0].speaker, 'copper'); assert.equal(intro.beats[1].speaker, 'baron');
  assert.deepEqual(buildRoundIntro(players, 'ROOM-42', 4, 2).beats.map(b => b.speaker), ['baron', 'copper']);
  assert.notEqual(intro.id, buildRoundIntro(players, 'ROOM-42', 3, 3).id, 'rematch gets a fresh audio identity');
});

test('shuffled deck does not repeat in any twelve consecutive rounds, including a cycle boundary', () => {
  const firstOrders = new Set();
  for (let seed = 0; seed < 24; seed++) {
    const intros = Array.from({ length: 38 }, (_, i) => buildRoundIntro(players, `ROOM-${seed}`, i + 1, seed % 3));
    for (let start = 0; start + 12 <= intros.length; start++) assert.equal(new Set(intros.slice(start, start + 12).map(i => i.exchangeId)).size, 12);
    assert.equal(new Set(intros.flatMap(intro => intro.beats.map(beat => beat.id))).size, 76, 'audio IDs never repeat even when dialogue deck cycles');
    firstOrders.add(intros.slice(0, 12).map(i => i.exchangeId).join(','));
  }
  assert.ok(firstOrders.size > 12, 'different rooms get genuinely varied orders');
});

test('legacy pack never reverses setup and reply to preserve a voice on even rounds', () => {
  const covered = new Set();
  for (let seed = 0; seed < 24; seed++) for (let round = 1; round <= 12; round++) {
    const intro=buildRoundIntro(players, 'ROOM-'+seed, round, seed%3);
    const exchange=PREMATCH_EXCHANGES.find(pair=>pair.id===intro.exchangeId);
    for (const [index,beat] of intro.beats.entries()) {
      const expected=(index===0?exchange.first:exchange.reply).replace(/^\{[ab]\}:\s*«/, '').replace(/»[.!?]*$/, '').trim();
      assert.equal(beat.text.replace(/[.!?…]$/, ''),expected.replace(/[.!?…]$/, ''));
      const seat=players.findIndex(player=>player.id===beat.speaker);
      assert.equal(seat,index===0?(round-1)%2:1-(round-1)%2);
      if(round%2===0) assert.ok(!beat.clip,'missing legacy cross-voice takes stay optional TTS, never reversed recordings');
      if(beat.clip) {
        covered.add(beat.clip);
        const recording=GENERATED_VOICE_CLIPS[beat.clip];
        assert.equal(recording.speaker,seat===0?'jotaro':'dio');
        assert.equal(beat.text,recording.text);assert.equal(beat.clipDuration,recording.duration);
        assert.ok(beat.duration>=recording.duration+.38+.12);
      }
    }
  }
  assert.deepEqual([...covered].sort(),['dio-round-1','dio-round-2','jotaro-round-1','jotaro-round-2']);
});

// The checked-in pack is MPEG-2 Layer III mono, 24 kHz. Read its real frame
// headers and Info/LAME gapless trim; container padding is not spoken duration.
// This keeps asset/window validation portable without ffmpeg on the test host.
function mp3Duration(bytes) {
  assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
  const id3Size = [...bytes.subarray(6, 10)].reduce((size, byte) => size * 128 + (byte & 127), 0);
  const start = 10 + id3Size, info = start + 13;
  assert.equal(bytes.toString('ascii', info, info + 4), 'Info');
  assert.equal(bytes.readUInt32BE(info + 4), 15, 'frame count, byte count, seek table and quality are present');
  const encodedFrames = bytes.readUInt32BE(info + 8), encoder = info + 120;
  assert.match(bytes.toString('ascii', encoder, encoder + 9), /^(Lavc|LAME)/);
  const delay = (bytes[encoder + 21] << 4) | (bytes[encoder + 22] >> 4);
  const padding = ((bytes[encoder + 22] & 15) << 8) | bytes[encoder + 23];
  const bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let offset = start, frames = 0;
  while (offset < bytes.length) {
    const header = bytes.readUInt32BE(offset);
    assert.equal(header >>> 21, 2047, 'every frame has MPEG sync');
    assert.equal((header >>> 19) & 3, 2, 'MPEG-2');
    assert.equal((header >>> 17) & 3, 1, 'Layer III');
    assert.equal((header >>> 10) & 3, 1, '24 kHz');
    assert.equal((header >>> 6) & 3, 3, 'mono');
    const bitrate = bitrates[(header >>> 12) & 15];
    assert.ok(bitrate > 0);
    offset += Math.floor(72000 * bitrate / 24000) + ((header >>> 9) & 1);
    frames++;
  }
  assert.equal(offset, bytes.length, 'the last frame is complete');
  assert.equal(frames, encodedFrames + 1, 'Info frame plus exactly the declared audio frames');
  return (encodedFrames * 576 - delay - padding) / 24000;
}

test('all four actual generated MP3 assets fit their windows with the complete first-start jitter allowance', () => {
  const clips = new Set(PREMATCH_EXCHANGES.flatMap(pair => Object.values(pair.clips || {})));
  assert.equal(clips.size, 4);
  for (const clip of clips) {
    const recording = GENERATED_VOICE_CLIPS[clip];
    assert.match(recording.url, /^\/assets\/voices\/generated\/(jotaro|dio)-round-[12]\.mp3$/);
    const bytes = readFileSync(new URL(`../public${recording.url}`, import.meta.url));
    const duration = mp3Duration(bytes);
    assert.ok(Math.abs(duration - recording.duration) < .0001, `${clip}: manifest and gapless stream duration agree`);
    assert.ok(duration > 0 && duration + .38 < ROUND_INTRO_BEAT_DURATION,
      `${clip}: full ${duration}s recording must fit even after the maximum .38s first-start delay`);
  }
  for (const round of [1, 2]) for (const beat of buildRoundIntro(players, 'jitter-budget', round).beats.filter(beat=>beat.clip)) {
    for (const delay of [.28, .38]) {
      const intro = buildRoundIntro(players, 'jitter-budget', round);
      assert.equal(activeRoundIntroBeat(intro, beat.at + delay + beat.clipDuration)?.id, beat.id,
        'the speaking robot and subtitle remain active through the complete delayed recording');
    }
  }
});

test('all dialogue is concise and free of the author speaker prefix or repeated names in TTS', () => {
  for (let round = 1; round <= 12; round++) {
    const intro = buildRoundIntro(players, 'full-deck', round);
    for (const beat of intro.beats) {
      assert.equal(beat.text, beat.ttsText); assert.ok(beat.text.split(/\s+/).length <= 12);
      assert.ok(beat.text.length < 100); assert.ok(!/[{}«»<>]/.test(beat.text));
      assert.ok(!players.some(p => beat.text.includes(p.name))); assert.ok(/[.!?…]$/.test(beat.text));
      assert.ok(['resolve', 'point', 'stance'].includes(beat.pose));
      if (beat.clip) {
        const recording = GENERATED_VOICE_CLIPS[beat.clip];
        assert.equal(beat.text, recording.text, 'the subtitle is the exact generated recording transcript');
        assert.equal(recording.speaker, beat.speaker === players[0].id ? 'jotaro' : 'dio');
      }
    }
  }
});

test('empty roster and invalid round counters have stable usable defaults and finite boundaries', () => {
  for (const invalid of [undefined, null, '', -3, 0, NaN, Infinity]) {
    const intro = buildRoundIntro(null, null, invalid, invalid);
    assert.equal(intro.round, 1); assert.deepEqual(intro.beats.map(b => b.speaker), ['p1', 'p2']);
    assert.deepEqual(intro, buildRoundIntro([], '', 1, 0));
  }
  const intro = buildRoundIntro(players, 'x', 2.9); assert.equal(intro.round, 2);
  assert.equal(activeRoundIntroBeat(intro, 0), intro.beats[0]); assert.equal(activeRoundIntroBeat(intro, ROUND_INTRO_BEAT_DURATION - .001), intro.beats[0]);
  assert.equal(activeRoundIntroBeat(intro, ROUND_INTRO_BEAT_DURATION), intro.beats[1]); assert.equal(activeRoundIntroBeat(intro, ROUND_INTRO_DURATION - .001), intro.beats[1]);
  for (const time of [-.01, ROUND_INTRO_DURATION, ROUND_INTRO_DURATION + 1, NaN, Infinity]) assert.equal(activeRoundIntroBeat(intro, time), null);
  assert.equal(activeRoundIntroBeat(null, 1), null);
});

class Element {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.writes = 0; this.classList = { toggle: (key, value) => { this[key] = value; } }; }
  set textContent(value) { this.value = value; this.writes++; }
  get textContent() { return this.value; }
  setAttribute(key, value) { this.attrs[key] = value; }
  append(...children) { this.children.push(...children); children.forEach(c => c.parent = this); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  set innerHTML(_) { throw Error('Names may never be interpreted as HTML'); }
}
const doc = { createElement: tag => new Element(tag, doc) };
const find = (root, name) => root.className?.split(' ').includes(name) ? root : root.children.map(c => find(c, name)).find(Boolean);

test('separate round UI renders actual names safely, follows the speaker and does not re-announce duplicate packets', () => {
  const mount = new Element('main', doc), ui = createRoundIntroUI(mount);
  const roster = [{ id: 'a', name: '<img src=x onerror=x>' }, { id: 'b', name: '  ' }], intro = buildRoundIntro(roster, 'x', 2);
  const update = (elapsed, patch = {}) => ui.update({ active: true, players: roster, intro, elapsed, ...patch });
  update(.4); assert.equal(ui.element.hidden, false); assert.equal(ui.element.dataset.speaker, '1');
  assert.equal(find(ui.element, 'round-intro-name').textContent, roster[0].name);
  assert.equal(find(ui.element, 'round-intro-speaker').textContent, 'Автоматон 2');
  assert.equal(find(ui.element, 'round-intro-number').textContent, 'РАУНД 2');
  const line = find(ui.element, 'round-intro-line'), writes = line.writes;
  update(.6); update(.6); assert.equal(line.writes, writes, 'same beat does not repeatedly announce its subtitle');
  update(ROUND_INTRO_BEAT_DURATION - .01); assert.equal(line.textContent, intro.beats[0].text);
  update(ROUND_INTRO_BEAT_DURATION + .2); assert.equal(ui.element.dataset.speaker, '0'); assert.equal(line.textContent, intro.beats[1].text);
  assert.equal(find(ui.element, 'round-intro-speaker').textContent, roster[0].name);
  const fill = find(ui.element, 'round-intro-fill'); assert.equal(fill.style.transform, 'scaleX(1)');
  update(ROUND_INTRO_BEAT_DURATION + .2, { paused: true }); assert.equal(ui.element.dataset.paused, 'true'); assert.match(find(ui.element, 'round-intro-note').textContent, /ПАУЗА/);
  update(ROUND_INTRO_DURATION, { active: false }); assert.equal(ui.element.hidden, true); ui.dispose(); ui.dispose(); assert.equal(mount.children.length, 0);
});

test('a reconnect selects the current subtitle immediately, including an empty-roster fallback', () => {
  const mount = new Element('main', doc), ui = createRoundIntroUI(mount), intro = buildRoundIntro([], 'empty', 1);
  ui.update({ active: true, players: [], intro, elapsed: ROUND_INTRO_BEAT_DURATION + .8, paused: true });
  assert.equal(find(ui.element, 'round-intro-speaker').textContent, 'Автоматон 2');
  assert.equal(find(ui.element, 'round-intro-line').textContent, intro.beats[1].text); assert.equal(ui.element.dataset.speaker, '1');
  ui.update({ active: true, intro, elapsed: intro.duration }); assert.equal(find(ui.element, 'round-intro-line').textContent, 'Теперь говорят приёмы.'); ui.dispose();
});

test('round UI uses each measured window for progress and keeps a long reply visible until its actual end', () => {
  const mount = new Element('main', doc), ui = createRoundIntroUI(mount);
  const intro = { id:'uneven', round:3, duration:19.9, beats:[
    { id:'setup', at:0, duration:7.7, speaker:'p1', text:'Начало реплики.' },
    { id:'reply', at:7.7, duration:12.2, speaker:'p2', text:'Ответ с эмоциональной паузой.' },
  ] };
  ui.update({ active:true, intro, elapsed:3.85 });
  assert.equal(find(ui.element,'round-intro-fill').style.transform,'scaleX(0.5)');
  ui.update({ active:true, intro, elapsed:19.8 });
  assert.equal(find(ui.element,'round-intro-line').textContent,intro.beats[1].text);
  assert.match(find(ui.element,'round-intro-note').textContent,/СНАЧАЛА СЛОВО/);
  ui.update({ active:true, intro, elapsed:intro.duration });
  assert.equal(find(ui.element,'round-intro-note').textContent,'ПРИГОТОВЬТЕСЬ');
  ui.dispose();
});

test('unrecorded round beats retain opt-in local voice; late join and referee suppression stay silent', async t => {
  const intro = buildRoundIntro(players, 'voice', 3), spoken = [];
  assert.ok(intro.beats.every(beat => !beat.clip));
  const ctx = { state: 'suspended', destination: {}, resume: async () => { ctx.state = 'running'; }, close() {}, createGain: () => ({ gain: {}, connect() {}, disconnect() {} }) };
  const voice = createStoryVoice({ makeContext: () => ctx, visibility: { hidden: false },
    speech: { getVoices: () => [{ name: 'Russian local test', lang: 'ru-RU', localService: true }], speak: value => spoken.push(value), cancel() {} },
    Utterance: class { constructor(text) { this.text = text; } } });
  t.after(() => voice.dispose()); await voice.unlock();
  const frame = (elapsed, patch = {}) => ({ sequenceId: intro.id, elapsed, beats: intro.beats, enabled: true, ...patch });
  voice.update(frame(0, { sequenceId: 'without-opt-in' }));
  voice.update(frame(ROUND_INTRO_BEAT_DURATION, { sequenceId: 'without-opt-in' }));
  assert.equal(spoken.length, 0, 'the other ten exchanges never enable device speech on their own');
  voice.setTtsEnabled(true);
  voice.update(frame(1.5)); assert.equal(spoken.length, 0, 'reconnect skips obsolete first line');
  voice.update(frame(ROUND_INTRO_BEAT_DURATION + .1)); voice.update(frame(ROUND_INTRO_BEAT_DURATION + .1)); assert.equal(spoken.length, 1); assert.equal(spoken[0].text, intro.beats[1].text);
  voice.update(frame(0, { sequenceId: 'referee-round', enabled: false })); voice.update(frame(ROUND_INTRO_BEAT_DURATION, { sequenceId: 'referee-round', enabled: false }));
  assert.equal(spoken.length, 1, 'root referee gate disables automatic dialogue');
});
