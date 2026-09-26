import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { StorySession } from '../server/story-session.js';
import { COUNTDOWN_SECONDS, ROUND_SECONDS, WINS_TO_MATCH } from '../shared/constants.js';
import { REFEREE_RECONNECT_GRACE } from '../shared/referee-round.js';

function fixture(referee = true) {
  const game = new CombatRoom({ id: 'GATED' });
  game.addPlayer('Сом'); game.addPlayer('Чайник');
  const story = new StorySession(game, { openingComplete: true });
  story.setRefereeConnected(referee);
  game.ready('p1'); game.ready('p2'); story.prepareRound();
  const step = seconds => {
    for (let i = 0; i < Math.ceil(seconds * 60 - 1e-8); i++) {
      const dt = Math.min(1 / 60, seconds - i / 60);
      story.step(dt); if (!story.holdCombat(dt)) game.step(dt); story.prepareRound();
    }
  };
  const gate = () => { step(story.roundIntro.duration + .1); return story.snapshot().refereeIntro?.sequenceId; };
  return { game, story, step, gate };
}

test('the entire recorded exchange precedes an unlimited referee introduction, then one full countdown', () => {
  const f = fixture(); const duration = f.story.roundIntro.duration;
  f.step(duration - .1);
  assert.equal(f.story.snapshot().stage, 'roundIntro');
  assert.equal(f.story.startRefereeRound(f.story.refereeGate.sequenceId), false, 'cannot skip the robot recordings');
  f.step(.1);
  assert.equal(f.story.snapshot().stage, 'refereeIntro');
  const sequenceId = f.story.snapshot().refereeIntro.sequenceId;
  const time = f.game.time, elapsed = f.game.elapsed;
  f.step(120);
  assert.equal(f.game.countdown, COUNTDOWN_SECONDS);
  assert.equal(f.game.time, time); assert.equal(time, ROUND_SECONDS);
  assert.equal(f.game.elapsed, elapsed, 'no simulation or stale input runs behind the introduction');
  assert.equal(f.story.decorate(f.game.snapshot()).phase, 'story');
  assert.equal(f.story.startRefereeRound(`${sequenceId}:stale`), false);
  assert.equal(f.story.startRefereeRound(sequenceId), true);
  assert.equal(f.story.startRefereeRound(sequenceId), false, 'a duplicate click cannot reset countdown');
  f.step(COUNTDOWN_SECONDS - .1); assert.equal(f.game.phase, 'countdown');
  f.step(.1); assert.equal(f.game.phase, 'fight'); assert.equal(f.game.time, time);
  f.step(.1); assert.ok(f.game.time < time);
});

test('every next round and rematch require a new gate, while a fight reconnect does not', () => {
  const f = fixture(), tokens = new Set();
  for (let round = 1; round <= WINS_TO_MATCH; round++) {
    const token = f.gate(); assert.ok(token); assert.ok(!tokens.has(token)); tokens.add(token);
    assert.equal(f.story.snapshot().refereeIntro.round, round);
    if (round > 1) assert.equal(f.story.startRefereeRound([...tokens][0]), false);
    assert.equal(f.story.startRefereeRound(token), true); f.step(COUNTDOWN_SECONDS);
    if (round === 1) {
      f.game.setConnected('p2', false); f.game.setConnected('p2', true); f.story.prepareRound();
      assert.equal(f.story.snapshot().stage, 'complete');
      f.step(COUNTDOWN_SECONDS); assert.equal(f.game.phase, 'fight');
    }
    f.game.player('p2').hp = 0; f.step(.05);
    if (round < WINS_TO_MATCH) { f.step(3.5); assert.equal(f.game.round, round + 1); }
  }
  f.step(20); assert.equal(f.game.phase, 'matchOver');
  f.game.requestRematch('p1'); f.game.requestRematch('p2'); f.story.prepareRound();
  const token = f.gate(); assert.ok(!tokens.has(token));
  assert.equal(f.story.snapshot().refereeIntro.matchSerial, 1);
  assert.equal(f.story.snapshot().refereeIntro.round, 1);
  assert.equal(f.game.time, ROUND_SECONDS);
});

test('referee reconnection keeps the same introduction; absence eventually releases it without unpausing a missing fighter', () => {
  const f = fixture(), token = f.gate();
  f.story.setRefereeConnected(false); f.step(REFEREE_RECONNECT_GRACE - 1);
  assert.equal(f.story.snapshot().stage, 'refereeIntro');
  assert.equal(f.story.snapshot().refereeIntro.disconnectedRemaining, 1);
  assert.equal(f.story.startRefereeRound(token), false);
  f.story.setRefereeConnected(true); f.step(30);
  assert.equal(f.story.snapshot().refereeIntro.sequenceId, token);
  assert.equal(f.story.snapshot().refereeIntro.disconnectedRemaining, null);
  f.game.setConnected('p2', false);
  assert.equal(f.story.startRefereeRound(token), false, 'referee cannot start while a fighter is missing');
  f.story.setRefereeConnected(false); f.step(REFEREE_RECONNECT_GRACE);
  assert.equal(f.game.phase, 'paused'); assert.equal(f.game.countdown, COUNTDOWN_SECONDS);
  assert.equal(f.story.snapshot().refereeIntro, null);
  f.game.setConnected('p2', true); f.story.setRefereeConnected(true);
  assert.equal(f.story.snapshot().stage, 'complete', 'late reconnect after fallback does not recapture this round');
  f.step(COUNTDOWN_SECONDS); assert.equal(f.game.phase, 'fight');
});

test('late referee catches a countdown but never stops an active fight', () => {
  const f = fixture(false); f.step(f.story.roundIntro.duration + 1);
  assert.ok(f.game.countdown < COUNTDOWN_SECONDS);
  f.story.setRefereeConnected(true);
  assert.equal(f.story.snapshot().stage, 'refereeIntro'); assert.equal(f.game.countdown, COUNTDOWN_SECONDS);
  assert.equal(f.story.startRefereeRound(f.story.refereeGate.sequenceId), true);
  f.step(COUNTDOWN_SECONDS); f.story.setRefereeConnected(false); f.story.setRefereeConnected(true);
  assert.equal(f.game.phase, 'fight'); assert.equal(f.story.snapshot().refereeIntro, null);
});

test('absence during the recordings leaves the ordinary automatic countdown intact', () => {
  const f = fixture(); f.step(1); f.story.setRefereeConnected(false);
  f.step(f.game.countdown); assert.equal(f.game.phase, 'fight');
  assert.equal(f.story.snapshot().refereeIntro, null);
});

test('legacy room late attachment still gets a gate after its expired round event', () => {
  const game = new CombatRoom({ id: 'OLDAPI' }); game.addPlayer('Сом'); game.addPlayer('Чайник');
  game.ready('p1'); game.ready('p2');
  for (let i = 0; i < 120; i++) game.step(1 / 60);
  assert.equal(game.events.length, 0);
  const story = new StorySession(game, { openingComplete: true }); story.setRefereeConnected(true);
  for (let i = 0; i < 900; i++) { story.step(1 / 60); if (!story.holdCombat(1 / 60)) game.step(1 / 60); }
  assert.equal(story.snapshot().stage, 'refereeIntro');
  assert.equal(game.time, ROUND_SECONDS);
});

test('a warming referee cannot consume recordings or launch a gate; leaving preparation releases the story', () => {
  const f = fixture(); f.story.setRefereeConnected(true, false);
  const remaining = f.game.countdown;
  f.step(60);
  assert.equal(f.game.countdown, remaining); assert.equal(f.story.snapshot().stage, 'roundIntro');
  assert.equal(f.story.snapshot().elapsed, 0); assert.equal(f.story.snapshot().paused, true);
  assert.equal(f.story.snapshot().refereePreparing, true);
  f.story.setRefereeConnected(true, true); const token = f.gate();
  f.story.setRefereeConnected(true, false);
  assert.equal(f.story.startRefereeRound(token), false, 'a forged start cannot bypass media preparation');
  f.story.setRefereeConnected(true, true); assert.equal(f.story.startRefereeRound(token), true);

  const abandoned = fixture(); abandoned.story.setRefereeConnected(true, false); abandoned.step(10);
  abandoned.story.setRefereeConnected(false); abandoned.step(abandoned.game.countdown);
  assert.equal(abandoned.game.phase, 'fight'); assert.equal(abandoned.story.snapshot().refereePreparing, false);
});

test('preparation pauses an opening scene but never stops a running fight or its reconnect countdown', () => {
  const game = new CombatRoom({ id: 'PREP' }); game.addPlayer('a'); game.addPlayer('b');
  const story = new StorySession(game, { ruleCount: 1 }); story.ready('p1'); story.ready('p2');
  for (const actor of ['p1', 'p2']) story.advance({ actor, sequenceId: story.sequenceId, ruleIndex: 0 });
  story.step(.1); const held = story.elapsed; story.setRefereeConnected(true, false);
  for (let i = 0; i < 100; i++) story.step(.1);
  assert.equal(story.elapsed, held); assert.equal(story.snapshot().paused, true);
  story.setRefereeConnected(false); story.step(.1); assert.ok(story.elapsed > held);

  const f = fixture(false); f.step(f.game.countdown);
  f.story.setRefereeConnected(true, false); const time = f.game.time;
  assert.equal(f.story.snapshot().paused, false); f.step(1); assert.ok(f.game.time < time);
  f.game.setConnected('p2', false); f.game.setConnected('p2', true);
  f.step(COUNTDOWN_SECONDS); assert.equal(f.game.phase, 'fight');
  assert.equal(f.story.snapshot().paused, false);
});
