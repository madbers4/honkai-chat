import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { MAX_HP, WINS_TO_MATCH, V5_ATTACKS, ATTACKS } from '../shared/constants.js';
import { CLUB_STORY, RULE_CARDS, PREMATCH_EXCHANGES, formatClubText } from '../shared/club-story.js';
import { REFEREE_LINES, REFEREE_CATEGORIES } from '../shared/referee-lines.js';
import { createRefereeDirector } from '../shared/referee-director.js';
import { buildHeavyAdvantageCase } from '../scripts/heavy-advantage-cases.js';
import { buildGrappleCase } from '../scripts/grapple-cases.js';
import { buildV5Case } from '../scripts/combat-v5-cases.js';

const snapshot = room => ({ ...room.snapshot(), elapsed: room.elapsed });
const send = (room, player, action = null, patch = {}) => room.input(player.id, { seq: player.lastSeq + 1, move: 0, block: false, crouch: false, action, ...patch });
function fight(distance = 2.14) {
  const room = new CombatRoom({ id: 'REFEREE', random: () => .5 });
  const a = room.addPlayer('ИСКРА'), b = room.addPlayer('ИНЕЙ'); room.ready(a.id); room.ready(b.id);
  for (let i = 0; i < 181; i++) room.step(1 / 60);
  a.x = -distance / 2; b.x = distance / 2;
  return { room, a, b };
}
function trace(room, seconds, run = () => {}) {
  const states = [snapshot(room)];
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { run(i); room.step(1 / 60); states.push(snapshot(room)); }
  return states;
}
const timed = data => data.snapshots.map((state, frame) => ({ ...state, elapsed: 3.1 + frame / 60 }));
function eventCue(states, type, variant, expected) {
  const frame = states.findIndex((state, i) => i > 0 && state.events.some(event => event.type === type && (!variant || event.variant === variant)
    && !states[i - 1].events.some(old => old.id === event.id)));
  assert.ok(frame > 0, `real ${type}/${variant || ''} event must occur`);
  const director = createRefereeDirector({ seed: 41 }); director.update(states[frame - 1]);
  const out = director.update(states[frame]);
  const candidates = [out.current, out.next].filter(Boolean);
  assert.ok(candidates.some(cue => cue.category === expected), `${expected}: ${JSON.stringify(candidates)}`);
  const cue = candidates.find(cue => cue.category === expected);
  assert.ok(states[frame].events.some(event => event.id === cue.sourceEventId), 'comment refers to a real authoritative event');
  assert.ok(!cue.text.includes('{'), 'all tokens are formatted');
  return cue;
}

test('club cards use actual rules and names are one-pass safe quoted text', () => {
  assert.ok(PREMATCH_EXCHANGES.length >= 6);
  for (const card of RULE_CARDS) for (const key of ['id', 'title', 'text', 'readAloud']) assert.equal(typeof card[key], 'string');
  assert.ok(RULE_CARDS.find(c => c.id === 'score').text.includes(`${WINS_TO_MATCH} побед`));
  assert.ok(RULE_CARDS.find(c => c.id === 'thumbs').text.includes('одним нажатием'));
  assert.ok(CLUB_STORY.final.both.includes('Оба участника'));
  const rendered = formatClubText('{a} / {b} / {round} / {score}', { a: '<img>\u202e{b}', b: 'Искра', round: 2, score: '1 : 0' });
  assert.equal(rendered, '«imgb» / «Искра» / 2 / 1 : 0');
  assert.ok(!/[<>\u202e]/u.test(rendered));
  assert.equal(formatClubText('{actor}', { actor: { name: 'ЛЕДЯНАЯ КОРОЛЕВА' } }), '«ЛЕДЯНАЯ КОРОЛЕВА»');
});

test('editorial pool has distinct readable copy for every real context and genuinely different partisan options', () => {
  assert.equal(new Set(REFEREE_LINES.map(l => l.id)).size, REFEREE_LINES.length);
  assert.equal(new Set(REFEREE_LINES.map(l => l.text)).size, REFEREE_LINES.length);
  for (const category of Object.keys(REFEREE_CATEGORIES)) {
    const lines = REFEREE_LINES.filter(line => line.category === category);
    assert.ok(lines.length >= 4, `${category} has useful variation`);
    if (lines.some(line => line.bias !== 'any')) for (const bias of ['any','favored','opposed'])
      assert.ok(lines.filter(line => line.bias === bias).length >= 2, `${category}/${bias} has independent writing`);
  }
  for (const line of REFEREE_LINES) {
    assert.ok(REFEREE_CATEGORIES[line.category]);
    assert.ok(line.text.length >= 30 && line.text.length <= 180, `${line.id}: speakable length`);
    assert.ok(!/<\/?\w/u.test(line.text), 'copy is not markup');
    assert.ok(!/\bundefined\b|\bNaN\b|XXX|YYY/u.test(line.text));
  }
});

test('actual heavy, slam, grapple, launch and finisher sequences select the right contexts', () => {
  const heavy = timed(buildHeavyAdvantageCase('series'));
  eventCue(heavy, 'hit', 'heavyDrive', 'defense'); eventCue(heavy, 'hit', 'heavyHook', 'heavySeries');
  eventCue(timed(buildHeavyAdvantageCase('slam')), 'hit', 'slam', 'slam');
  const grapple = timed(buildGrappleCase('two'));
  eventCue(grapple, 'grab', null, 'grab'); eventCue(grapple, 'grabStrike', null, 'pummel'); eventCue(grapple, 'throw', null, 'throw');
  eventCue(timed(buildGrappleCase('tech')), 'grabBreak', null, 'grabBreak');
  eventCue(timed(buildV5Case('air')), 'launch', null, 'airLaunch');
  const final = timed(buildV5Case('finish'));
  eventCue(final, 'ko', null, 'ko'); eventCue(final, 'finisherStart', null, 'finale'); eventCue(final, 'destruction', null, 'destruction');
  const brutal = timed(buildV5Case('brutality'));
  const instantFinale = eventCue(brutal, 'finisherStart', null, 'finale');
  assert.equal(instantFinale.priority, REFEREE_CATEGORIES.finale.priority, 'same-packet KO yields to the actual automatic finale');
});

test('actual defenses, projectile contacts and paid burst are distinguished from their windups', () => {
  for (const mode of ['parry', 'block', 'guardBreak', 'impulse', 'mine', 'burst']) {
    const { room, a, b } = fight(2.4);
    if (mode === 'block' || mode === 'guardBreak') { send(room, b, null, { block: true }); trace(room, .20, () => send(room, b, null, { block: true })); }
    if (mode === 'guardBreak') b.guard = 10;
    if (mode === 'burst') b.energy = 100;
    const states = trace(room, 1.5, frame => {
      if (frame === 0) {
        send(room, a, ['impulse', 'mine'].includes(mode) ? 'special' : mode === 'guardBreak' || mode === 'burst' ? 'heavy' : 'light', { crouch: mode === 'mine' });
        if (mode === 'parry') send(room, b, null, { block: true });
      }
      if (['parry', 'block', 'guardBreak'].includes(mode)) send(room, b, null, { block: true });
      if (mode === 'burst' && b.variant === 'heavyStagger') send(room, b, 'dash');
    });
    eventCue(states, mode === 'parry' ? 'parry' : ['block', 'guardBreak'].includes(mode) ? 'block' : mode === 'burst' ? 'burst' : 'hit', null, mode);
  }
  const { room, a } = fight(5);
  const states = trace(room, 1.5, frame => { if (!frame) send(room, a, 'special', { crouch: true }); });
  assert.ok(states.some(s => s.projectiles.some(p => p.variant === 'shockwave')), 'mine was really placed');
  const director = createRefereeDirector();
  for (const state of states) {
    const out = director.update(state);
    assert.ok(![out.current, out.next].some(cue => cue?.category === 'mine'), 'a missed mine cannot be called a successful hit');
  }
});

test('ultimate charge and waves reflect actual events, never presumed damage', () => {
  const { room, a } = fight(5.5); a.energy = 100;
  const states = trace(room, 2.6, frame => { if (!frame) send(room, a, 'ultimate'); if (frame === 85) send(room, room.player('p2'), 'jump'); });
  eventCue(states, 'ultimate', null, 'ultimateCharge'); eventCue(states, 'ultimatePulse', null, 'ultimatePulse');
  assert.equal(room.player('p2').hp, MAX_HP, 'all waves passed underneath a timed jump');
  assert.ok(REFEREE_LINES.filter(l => l.category === 'ultimatePulse').every(l => !/попал|нанёс|пробил/u.test(l.text)));
});

test('whiff punishment, feint and health swing come from actual combat changes', () => {
  const missed = fight(4); send(missed.room, missed.a, 'heavy'); trace(missed.room, .58);
  assert.ok(missed.room.isWhiffRecovery(missed.a));
  missed.a.x = -1.03; missed.b.x = 1.03;
  const punished = trace(missed.room, .2, frame => { if (!frame) send(missed.room, missed.b, 'light'); });
  eventCue(punished, 'hit', null, 'whiffPunish');
  const feint = fight(4);
  const cancelled = trace(feint.room, .5, frame => {
    if (!frame) send(feint.room, feint.a, 'heavy');
    if (frame === 9) send(feint.room, feint.a, 'dash');
  });
  eventCue(cancelled, 'feint', null, 'feint');
  const { room, a, b } = fight(); a.hp = 70; b.hp = 120;
  const director = createRefereeDirector(); director.update(snapshot(room));
  room.damage(a, b, V5_ATTACKS.heavyPress, 'heavy', a.x, { variant: 'heavyPress' }); director.update(snapshot(room));
  room.damage(a, b, ATTACKS.special, 'special', a.x, { variant: 'bolt' });
  const out = director.update(snapshot(room));
  assert.equal(b.hp, 56); assert.equal(out.next.category, 'comeback');
  const low = createRefereeDirector(); b.hp = 50; low.update(snapshot(room));
  room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' });
  assert.equal(low.update(snapshot(room)).current.category, 'lowHp');
});

test('waiting introduction, real round start, leader and quiet gaps have distinct cues', () => {
  const room = new CombatRoom({ id: 'ANNOUNCE' }); const a = room.addPlayer('ИСКРА'), b = room.addPlayer('ИНЕЙ');
  const introduction = createRefereeDirector(); assert.equal(introduction.update(snapshot(room)).current.category, 'introduction');
  room.ready(a.id); room.ready(b.id);
  const started = trace(room, 3.2); eventCue(started, 'round', null, 'roundStart');
  a.wins = b.wins = 1; b.hp = 1;
  const director = createRefereeDirector(); director.update(snapshot(room));
  room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' }); room.step(1 / 60);
  const result = director.update(snapshot(room)); assert.equal(result.current.category, 'ko'); assert.equal(result.next.category, 'leadChange');
  const quietFight = fight(8), quiet = createRefereeDirector(); const quietCues = new Set();
  for (const state of trace(quietFight.room, 25)) { const cue = quiet.update(state).current; if (cue) quietCues.add(cue.category); }
  assert.ok(quietCues.has('quiet'), 'sustained inactivity receives an observation without requiring a click');
  const assembling = new CombatRoom({ id: 'ASSEMBLE' }), announce = createRefereeDirector();
  assembling.addPlayer('ПЕРВЫЙ'); assert.equal(announce.update(snapshot(assembling)).current, null);
  assembling.addPlayer('ВТОРОЙ'); assert.equal(announce.update(snapshot(assembling)).current.category, 'introduction');
});

test('first late snapshot, duplicate event tails, pause, resume and rewind cannot replay history', () => {
  const { room, a, b } = fight();
  send(room, a, 'heavy'); trace(room, .5);
  const director = createRefereeDirector();
  assert.equal(director.update(snapshot(room)).current, null, 'joining after a hit does not replay it');
  const stable = director.update(snapshot(room)); assert.deepEqual(stable, director.update(snapshot(room)));
  room.setConnected(b.id, false); const pause = director.update(snapshot(room));
  assert.equal(pause.current.category, 'disconnect');
  trace(room, 20); assert.deepEqual(director.update(snapshot(room)), pause, 'paused wall seconds do not expire or reroll a reading');
  room.setConnected(b.id, true); const resume = director.update(snapshot(room)); assert.equal(resume.current.category, 'reconnect');
  assert.deepEqual(director.update(snapshot(room)), resume);
  const old = { ...snapshot(room), elapsed: 1 }; assert.equal(director.update(old).current, null);
  assert.equal(director.update(old).current, null, 'repeated seek target is idempotent');
  assert.equal(director.update(snapshot(room)).current, null, 'old event ids are not resurrected by forward seek');
});

test('one complete reading survives fast contacts and KO queues ahead of lesser facts', () => {
  const { room, a, b } = fight(); const director = createRefereeDirector({ seed: 3 }); director.update(snapshot(room));
  room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' });
  const first = director.update(snapshot(room)).current;
  assert.ok(first.readSeconds >= 4.6 && first.readSeconds <= 10.5);
  assert.ok(Math.abs(first.expiresAt - first.startedAt - first.readSeconds) < 1e-8);
  for (let i = 0; i < 3; i++) {
    trace(room, .15); room.damage(a, b, V5_ATTACKS.cross, 'light', a.x, { variant: 'cross' });
    assert.equal(director.update(snapshot(room)).current.id, first.id);
  }
  b.hp = 1; room.damage(a, b, V5_ATTACKS.jab, 'light', a.x, { variant: 'jab' }); room.step(1 / 60);
  const result = director.update(snapshot(room)), ko = result.next;
  assert.equal(result.current.id, first.id, 'the host finishes their sentence before the result');
  assert.equal(ko.category, 'ko');
  assert.ok(ko.text.includes('ИСКРА') || !ko.text.includes('ИНЕЙ'), 'victory is never assigned to the loser');
});

test('real timeout, draw and complete match produce their own results and both final voices', () => {
  for (const tied of [true, false]) {
    const { room, a } = fight(); room.time = .02; if (!tied) a.hp = 150, room.player('p2').hp = 100;
    const director = createRefereeDirector(); director.update(snapshot(room));
    room.step(1 / 60); room.step(1 / 60);
    const cue = director.update(snapshot(room)).current;
    assert.equal(cue.category, tied ? 'tie' : 'timeout');
  }
  const states = timed(buildV5Case('finish')), director = createRefereeDirector(); let last;
  for (const state of states) last = director.update(state);
  assert.equal(states.at(-1).phase, 'matchOver');
  const winnerAt = states.findIndex(s => s.phase === 'matchOver');
  const final = createRefereeDirector(); final.update(states[winnerAt - 1]);
  const out = final.update(states[winnerAt]); assert.equal(out.current.category, 'win'); assert.equal(out.next.category, 'loss');
  assert.equal(final.acknowledge().current.category, 'loss');
  assert.ok(last.current == null || ['win', 'loss'].includes(last.current.category));
});

test('favorite changes interpretation only, consumes no combat state, and variation never repeats the last 24 lines', () => {
  const { room, a, b } = fight(); const start = snapshot(room);
  room.damage(a, b, ATTACKS.special, 'special', a.x, { variant: 'bolt' }); const hit = snapshot(room);
  const original = JSON.stringify(hit); let biased = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const one = createRefereeDirector({ seed, favorite: 'p1' }), two = createRefereeDirector({ seed, favorite: 'p2' });
    one.update(start); two.update(start);
    const left = one.update(hit), right = two.update(hit);
    assert.equal(left.current.category, right.current.category); assert.equal(left.current.sourceEventId, right.current.sourceEventId);
    if (left.current.text !== right.current.text) biased++;
    assert.ok(!Object.keys(left.current).includes('favorite'));
  }
  assert.ok(biased >= 6); assert.equal(JSON.stringify(hit), original);
  const director = createRefereeDirector({ seed: 17, favorite: 'p1' }); director.update(start); let out = director.update(hit);
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    const before = out.current; ids.add(before.id.split(':').at(-1)); out = director.nextVariation();
    if (out.current.id !== before.id) assert.ok(!ids.has(out.current.id.split(':').at(-1)), 'exhausted context stays still instead of recycling a recent line');
  }
  assert.ok(ids.size >= 4);
});

test('seeded recorded fight is deterministic, bounded and has no automatic hit-by-hit chatter', () => {
  const states = timed(buildHeavyAdvantageCase('series'));
  const a = createRefereeDirector({ seed: 'show-7', favorite: 'p2' }), b = createRefereeDirector({ seed: 'show-7', favorite: 'p2' });
  const shown = new Set();
  for (const state of states) {
    Object.freeze(state.events); const left = a.update(state), right = b.update(state);
    assert.deepEqual(left, right); if (left.current) shown.add(left.current.id);
    assert.ok(left.next == null || typeof left.next.text === 'string');
  }
  assert.ok(shown.size <= 2, 'three rapid contacts share a readable window');
  a.reset(); assert.equal(a.update(states.at(-1)).current, null, 'reset does not rehearse the old fight');
});

test('a complete seeded bot match never repeats any of the last 24 published line ids', () => {
  const { room } = fight(); let seed = 925;
  room.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296; };
  room.players.forEach(player => { player.bot = true; });
  const director = createRefereeDirector({ seed: 808, favorite: 'p2' }); director.update(snapshot(room));
  const ids = [], categories = new Set(); let lastId;
  for (let frame = 0; frame < 600 * 60 && room.phase !== 'matchOver'; frame++) {
    room.step(1 / 60); const out = director.update(snapshot(room));
    if (out.current && out.current.id !== lastId) {
      const id = out.current.id.split(':').at(-1);
      assert.ok(!ids.slice(-24).includes(id), `${id} repeated too soon`);
      ids.push(id); categories.add(out.current.category); lastId = out.current.id;
    }
  }
  assert.equal(room.phase, 'matchOver'); assert.ok(ids.length >= 25); assert.ok(categories.size >= 10);
});
