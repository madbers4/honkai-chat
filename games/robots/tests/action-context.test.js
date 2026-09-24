import test from 'node:test';
import assert from 'node:assert/strict';
import { actionContext, actionResource, comboCue, finishContext } from '../src/action-context.js';

test('defensive input uses burst resources even while the ordinary dash is cooling down', () => {
  const player = { hp: 80, action: 'hit', variant: 'launched', y: 1, energy: 60, cooldowns: { dash: 1, burst: 0 } };
  const context = actionContext(player);
  assert.equal(context.dash.label, 'СБРОС');
  assert.equal(context.dash.ready, true);
  assert.equal(actionResource('dash', player).cost, 50);
  assert.equal(actionResource('dash', player).cooldown, 0);
  assert.equal(actionContext({ ...player, energy: 40 }).dash.ready, false);
  assert.equal(actionContext({ ...player, cooldowns: { dash: 0, burst: 8 } }).dash.ready, false);
});

test('grapple changes existing buttons without offering more than two pummels', () => {
  const player = { id: 'p1', hp: 100, y: 0, facing: 1, action: 'heavy', variant: 'grab', grabTarget: 'p2', grabHoldTime: .35, grabStrikes: 0 };
  assert.equal(actionContext(player).heavy, 'БРОСОК');
  assert.equal(actionContext(player).pummelReady, true);
  assert.equal(actionContext(player, { move: -1 }).heavy, 'НАЗАД');
  assert.equal(actionContext({ ...player, grabStrikeTime: .1 }).pummelReady, false);
  assert.equal(actionContext({ ...player, grabStrikes: 2 }).pummelReady, false);
  assert.equal(actionContext({ ...player, grabThrowTime: .05 }).pummelReady, false);
  assert.equal(actionContext({ ...player, grabHoldTime: .1 }).pummelReady, false);
  assert.equal(actionContext({ ...player, grabHoldTime: 1.05 }).pummelReady, false);
});

test('air dash prompt respects the actual cancel window, landing and one dash per flight', () => {
  const player = { hp: 80, action: 'jump', y: 1, energy: 0, cooldowns: { dash: 0 } };
  assert.equal(actionContext(player).dash.ready, true);
  assert.equal(actionContext(player).dash.cost, 0);
  for (const changed of [{ airDashUsed: true }, { landingRecovery: .1 }, { cooldowns: { dash: .3 } }, { action: 'light', variant: 'airJab', actionTime: .2, cancelWindow: 0 }]) {
    assert.equal(actionContext({ ...player, ...changed }).dash.ready, false);
  }
  assert.equal(actionContext({ ...player, action: 'light', variant: 'airJab', actionTime: .2, cancelWindow: .15 }).dash.ready, true);
});

test('confirmed branches distinguish launcher and crusher; a blocked or interrupted hit offers no combo', () => {
  const hit = { hp: 90, action: 'light', variant: 'jab', cancelWindow: .2, launchWindow: .2, y: 0 };
  assert.equal(actionContext(hit).heavy, 'ПОДБРОС');
  assert.equal(comboCue(hit).stage, 1);
  assert.equal(actionContext({ ...hit, variant: 'cross' }).heavy, 'ДРОБИТЕЛЬ');
  assert.equal(comboCue({ ...hit, variant: 'cross' }).stage, 2);
  const recoveredCross = { ...hit, action: 'idle', variant: '', comboRoute: 'jab-cross' };
  assert.equal(actionContext(recoveredCross).heavy, 'ДРОБИТЕЛЬ');
  assert.equal(comboCue(recoveredCross).nextLight, 'РАССЕЧЬ');
  assert.equal(comboCue({ ...hit, cancelWindow: 0 }).open, false);
  assert.equal(comboCue({ ...hit, grabbedBy: 'p2' }).open, false);
  assert.match(comboCue({ ...hit, y: 1, variant: 'airCross' }).text, /СБИТЬ ВНИЗ/);
});

test('finisher is free only for the winning player during the live offer', () => {
  const player = { id: 'p1', hp: 60, energy: 0, cooldowns: { ultimate: 9 } };
  const state = { phase: 'finishing', finish: { stage: 'offer', winner: 'p1', target: 'p2', canTrigger: true, time: 2.4, duration: 3 } };
  assert.equal(finishContext(state, 'p1').remaining, 2.4);
  assert.equal(actionContext(player, {}, state).heavy, 'ДОБИТЬ');
  assert.deepEqual(actionResource('ultimate', player, {}, state), { cost: 0, cooldown: 0 });
  assert.equal(finishContext(state, 'p2').canTrigger, false);
  assert.equal(finishContext({ ...state, phase: 'paused' }, 'p1').canTrigger, false);
  assert.equal(finishContext({ ...state, finish: { ...state.finish, stage: 'execute' } }, 'p1').canTrigger, false);
  assert.equal(actionResource('ultimate', player).cost, 100);
});

test('tech takes priority over counter prompts, and excludes an inappropriate burst prompt', () => {
  const caught = { hp: 80, action: 'hit', variant: 'grabbed', grabTechWindow: .18, counterWindow: 1, energy: 100 };
  assert.equal(actionContext(caught).light, 'ВЫРВАТЬСЯ');
  assert.equal(actionContext(caught).burst, false);
  assert.equal(actionContext({ ...caught, grabTechWindow: 0 }).tech, false);
  for (const variant of ['parried', 'grabBreak', 'burstRepelled']) {
    assert.equal(actionContext({ ...caught, variant }).burst, false, `cannot promise an escape from ${variant}`);
  }
});

test('directional heavy labels preserve aerial and confirmed-hit variants, and feint has no ram prompt', () => {
  assert.equal(actionContext({ y: 0, launchWindow: .8 }, { crouch: true }).heavy, 'ЗАХВАТ');
  assert.equal(actionContext({ y: .5, launchWindow: .8 }, { crouch: true }).heavy, 'ПИКЕ');
  assert.equal(actionContext({ y: 0, launchWindow: .8 }).heavy, 'ПОДБРОС');
  const startup = { hp: 100, action: 'heavy', variant: '', actionTime: .15, y: 0, energy: 40 };
  assert.equal(actionResource('dash', startup).cost, 12);
  assert.equal(actionContext(startup).dash.label, 'ОТМЕНА');
  assert.equal(actionContext({ ...startup, actionTime: .4 }).feint, false);
  assert.equal(actionContext({ action: 'dash', variant: 'feint' }).ram, false);
  assert.equal(actionContext({ action: 'dash', variant: '' }).ram, true);
});
