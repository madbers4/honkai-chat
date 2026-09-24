import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRoom } from '../server/combat.js';
import { StorySession } from '../server/story-session.js';

const create = (training = false) => {
  const game = new CombatRoom({ id: 'STORY', mode: training ? 'training' : 'pvp' });
  game.addPlayer('Кабачок'); game.addPlayer('Грозный чайник', { bot: training });
  const story = new StorySession(game, { ruleCount: 2, buildFaceoff: () => [{ id: 'hello', at: 0, duration: 24, speaker: 'p1', pose: 'point' }] });
  const advance = (actor, referee = false, overrides = {}) => story.advance({ actor, sequenceId: story.sequenceId, ruleIndex: story.ruleIndex, ...overrides }, referee);
  return { game, story, advance };
};

test('both fighters must finish the workshop and acknowledge each rule before the timed faceoff', () => {
  const { game, story, advance } = create();
  story.ready('p1'); assert.equal(story.stage, 'workshop'); assert.equal(game.phase, 'waiting');
  assert.equal(story.canEdit('p1'), false); assert.equal(story.canEdit('p2'), true);
  story.ready('p1', false); assert.equal(story.canEdit('p1'), true);
  story.ready('p1'); story.ready('p2'); assert.equal(story.stage, 'rules');
  advance('p1'); assert.equal(story.ruleIndex, 0); advance('p1'); assert.equal(story.ruleIndex, 0);
  advance('p2'); assert.equal(story.ruleIndex, 1);
  assert.equal(advance('p2', false, { ruleIndex: 0 }), false);
  advance('p1'); advance('p2'); assert.equal(story.stage, 'faceoff');
  assert.equal(game.phase, 'waiting');
  const presented = story.decorate(game.snapshot());
  assert.equal(presented.phase, 'story'); assert.equal(presented.players[0].variant, 'point');
  assert.equal(game.player('p1').action, 'idle', 'presentation never mutates combat poses');
  for (let n = 0; n < 24 * 60; n++) story.step(1 / 60);
  assert.equal(story.stage, 'complete'); assert.equal(game.phase, 'countdown');
  const roundEvents = game.events.filter(e => e.type === 'round').length;
  story.step(1); assert.equal(game.events.filter(e => e.type === 'round').length, roundEvents);
});

test('a connected referee advances rules, while leaving immediately returns control to both fighters', () => {
  const { story, advance } = create(); story.ready('p1'); story.ready('p2');
  assert.equal(advance('p1', true), false); assert.equal(story.ruleIndex, 0);
  assert.equal(advance('referee', true), true); assert.equal(story.ruleIndex, 1);
  assert.equal(advance('referee', false), false);
  advance('p1'); advance('p2'); assert.equal(story.stage, 'faceoff');
});

test('player disconnect freezes the presentation and a reconnect resumes the same beat', () => {
  const { game, story, advance } = create(); story.ready('p1'); story.ready('p2');
  advance('referee', true); advance('referee', true);
  story.step(.1); game.setConnected('p2', false);
  assert.equal(story.snapshot().paused, true);
  for (let n = 0; n < 600; n++) story.step(1 / 60);
  assert.equal(story.elapsed, .1); assert.equal(advance('p1'), false);
  game.setConnected('p2', true); story.step(.1);
  assert.equal(story.elapsed, .2); assert.equal(game.phase, 'waiting');
});

test('training acknowledges only its human and skipping a PvP faceoff requires both fighters', () => {
  const practice = create(true); practice.story.ready('p1');
  assert.equal(practice.story.stage, 'rules'); practice.advance('p1'); practice.advance('p1');
  assert.equal(practice.story.stage, 'faceoff');
  const { game, story, advance } = create(); story.ready('p1'); story.ready('p2');
  advance('referee', true); advance('referee', true);
  assert.equal(advance('p1'), false, 'a stale ready action cannot immediately skip the scene');
  for (let n = 0; n < 31; n++) story.step(.1);
  advance('p1'); assert.equal(story.stage, 'faceoff'); advance('p1'); assert.equal(story.stage, 'faceoff');
  advance('p2'); assert.equal(story.stage, 'complete'); assert.equal(game.phase, 'countdown');
  assert.equal(advance('referee', true), false);
});

test('each real round gets one exchange while reconnect countdowns do not replay it or hide mechanical reboot', () => {
  const { game, story, advance } = create(); story.ready('p1'); story.ready('p2');
  advance('referee', true); advance('referee', true);
  const step = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) { story.step(1 / 60); game.step(1 / 60); story.prepareRound(); } };
  step(24.1);
  assert.equal(story.snapshot().stage, 'roundIntro');
  assert.equal(story.decorate(game.snapshot()).players[0].action, 'recover');
  const firstSequence = story.snapshot().roundIntro.sequenceId;
  game.setConnected('p2', false);
  const held = story.snapshot().elapsed; step(3); assert.equal(story.snapshot().elapsed, held);
  game.setConnected('p2', true); step(6);
  assert.equal(story.snapshot().stage, 'complete'); assert.equal(game.phase, 'countdown');
  step(3); assert.equal(game.phase, 'fight');
  game.setConnected('p2', false); game.setConnected('p2', true); story.prepareRound();
  assert.equal(story.snapshot().stage, 'complete', 'fight reconnect only has its ordinary three-second safety countdown');
  assert.equal(story.snapshot().roundIntro.sequenceId, firstSequence);
  step(3.1); game.player('p2').hp = 0; step(.02); assert.equal(game.phase, 'roundOver');
  step(3.5); assert.equal(game.round, 2); assert.equal(story.snapshot().stage, 'roundIntro');
  assert.notEqual(story.snapshot().roundIntro.sequenceId, firstSequence);
  assert.equal(story.decorate(game.snapshot()).players[1].action, 'recover', 'loser can visibly reboot before delivering its line');
  const duration = game.countdown; story.prepareRound(); story.prepareRound(); assert.equal(game.countdown, duration);
});
