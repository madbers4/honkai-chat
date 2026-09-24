import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundIntro, activeRoundIntroBeat, ROUND_INTRO_DURATION } from '../shared/round-intro.js';
import { PREMATCH_EXCHANGES } from '../shared/club-story.js';
import { createRoundIntroUI } from '../src/round-intro-ui.js';
import { createStoryVoice } from '../src/story-voice.js';

const players = [{ id: 'copper', name: 'Медный Сом' }, { id: 'baron', name: 'Барон Коротыш' }];

test('six-second exchange is deterministic, independent of names and composed of two exact speaking windows', () => {
  const intro = buildRoundIntro(players, 'ROOM-42', 3, 2);
  assert.deepEqual(intro, buildRoundIntro(players, { id: 'ROOM-42' }, 3, 2));
  assert.deepEqual(intro, buildRoundIntro(players.map(p => ({ ...p, name: '<script>{a}</script>' })), 'ROOM-42', 3, 2));
  assert.equal(intro.duration, ROUND_INTRO_DURATION); assert.equal(intro.duration, 6); assert.equal(intro.round, 3);
  assert.ok(PREMATCH_EXCHANGES.some(pair => pair.id === intro.exchangeId && pair.setup === intro.title));
  assert.equal(intro.beats.length, 2); assert.deepEqual(intro.beats.map(b => [b.at, b.duration]), [[0, 3], [3, 3]]);
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

test('all dialogue is concise and free of the author speaker prefix or repeated names in TTS', () => {
  for (let round = 1; round <= 12; round++) {
    const intro = buildRoundIntro(players, 'full-deck', round);
    for (const beat of intro.beats) {
      assert.equal(beat.text, beat.ttsText); assert.ok(beat.text.split(/\s+/).length <= 12);
      assert.ok(beat.text.length < 100); assert.ok(!/[{}«»<>]/.test(beat.text));
      assert.ok(!players.some(p => beat.text.includes(p.name))); assert.ok(/[.!?…]$/.test(beat.text));
      assert.ok(['resolve', 'point', 'stance'].includes(beat.pose)); assert.equal(beat.clip, undefined, 'no old borrowed-name recording is played');
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
  assert.equal(activeRoundIntroBeat(intro, 0), intro.beats[0]); assert.equal(activeRoundIntroBeat(intro, 2.999), intro.beats[0]);
  assert.equal(activeRoundIntroBeat(intro, 3), intro.beats[1]); assert.equal(activeRoundIntroBeat(intro, 5.999), intro.beats[1]);
  for (const time of [-.01, 6, 12, NaN, Infinity]) assert.equal(activeRoundIntroBeat(intro, time), null);
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
  update(3.2); assert.equal(ui.element.dataset.speaker, '0'); assert.equal(line.textContent, intro.beats[1].text);
  assert.equal(find(ui.element, 'round-intro-speaker').textContent, roster[0].name);
  const fill = find(ui.element, 'round-intro-fill'); assert.equal(fill.style.transform, 'scaleX(1)');
  update(3.2, { paused: true }); assert.equal(ui.element.dataset.paused, 'true'); assert.match(find(ui.element, 'round-intro-note').textContent, /ПАУЗА/);
  update(6, { active: false }); assert.equal(ui.element.hidden, true); ui.dispose(); ui.dispose(); assert.equal(mount.children.length, 0);
});

test('a reconnect selects the current subtitle immediately, including an empty-roster fallback', () => {
  const mount = new Element('main', doc), ui = createRoundIntroUI(mount), intro = buildRoundIntro([], 'empty', 1);
  ui.update({ active: true, players: [], intro, elapsed: 4.2, paused: true });
  assert.equal(find(ui.element, 'round-intro-speaker').textContent, 'Автоматон 2');
  assert.equal(find(ui.element, 'round-intro-line').textContent, intro.beats[1].text); assert.equal(ui.element.dataset.speaker, '1');
  ui.update({ active: true, intro, elapsed: 6 }); assert.equal(find(ui.element, 'round-intro-line').textContent, 'Теперь говорят приёмы.'); ui.dispose();
});

test('round beats use the existing opt-in local voice lifecycle; late join and referee suppression stay silent', async t => {
  const intro = buildRoundIntro(players, 'voice', 1), spoken = [];
  const ctx = { state: 'suspended', destination: {}, resume: async () => { ctx.state = 'running'; }, close() {}, createGain: () => ({ gain: {}, connect() {}, disconnect() {} }) };
  const voice = createStoryVoice({ makeContext: () => ctx, visibility: { hidden: false },
    speech: { getVoices: () => [{ name: 'Russian local test', lang: 'ru-RU', localService: true }], speak: value => spoken.push(value), cancel() {} },
    Utterance: class { constructor(text) { this.text = text; } } });
  t.after(() => voice.dispose()); await voice.unlock(); voice.setTtsEnabled(true);
  const frame = (elapsed, patch = {}) => ({ sequenceId: intro.id, elapsed, beats: intro.beats, enabled: true, ...patch });
  voice.update(frame(1.5)); assert.equal(spoken.length, 0, 'reconnect skips obsolete first line');
  voice.update(frame(3.1)); voice.update(frame(3.1)); assert.equal(spoken.length, 1); assert.equal(spoken[0].text, intro.beats[1].text);
  voice.update(frame(0, { sequenceId: 'referee-round', enabled: false })); voice.update(frame(3, { sequenceId: 'referee-round', enabled: false }));
  assert.equal(spoken.length, 1, 'root referee gate disables automatic dialogue');
});
