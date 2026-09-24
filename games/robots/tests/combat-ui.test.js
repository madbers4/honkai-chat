import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatUI } from '../src/combat-ui.js';

test('HUD consumes round, hit, grab and pause snapshots without breaking the receive-state loop', t => {
  // Only the DOM surface this view uses; no rendering/GPU needed to exercise its state lifecycle.
  const element = () => {
    const classes = new Set();
    return { textContent: '', hidden: false, dataset: {}, style: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
      setAttribute(name, value) { this[name] = value; },
      querySelector() { return this.label ||= element(); },
    };
  };
  const nodes = new Map();
  const byId = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const buttons = ['light','heavy','special','ultimate','dash','block'].map(action => ({ ...element(), dataset: { action } }));
  const priorDocument = globalThis.document;
  globalThis.document = { getElementById: byId, querySelectorAll: () => buttons };
  t.after(() => { globalThis.document = priorDocument; });
  const ui = createCombatUI();
  t.after(() => ui.reset());
  const player = { id: 'p1', action: 'idle', variant: '', hp: 100, energy: 75, y: 0, cooldowns: { dash: 0, burst: 0 } };
  const state = { room: 'UI00', round: 1, time: 60, phase: 'fight', players: [player] };
  const button = action => buttons.find(button => button.dataset.action === action);
  ui.update(state, 'p1');
  assert.equal(button('dash').label.textContent, 'РЫВОК');
  assert.equal(button('special')['aria-label'], 'Импульс, 25 энергии');
  assert.equal(byId('escape-prompt').hidden, true);
  player.action = 'hit'; player.variant = 'launched'; player.y = .7;
  ui.update(state, 'p1');
  assert.equal(byId('escape-prompt').hidden, false);
  assert.equal(button('dash').label.textContent, 'СБРОС');
  assert.equal(byId('dash-cost').textContent, '50 ⚡');
  player.variant = 'grabbed'; player.grabTechWindow = .12; player.y = 0;
  ui.update(state, 'p1');
  assert.equal(button('light').label.textContent, 'ВЫРВАТЬСЯ');
  assert.equal(byId('escape-fill').style.transform, 'scaleX(0.5)');
  state.phase = 'paused'; ui.update(state, 'p1');
  assert.equal(byId('escape-prompt').hidden, true);
  state.phase = 'fight'; state.round = 2; player.action = 'idle'; player.variant = ''; player.grabTechWindow = 0;
  ui.update(state, 'p1', { crouch: true });
  assert.equal(button('light').label.textContent, 'УДАР');
  assert.equal(button('heavy').label.textContent, 'ЗАХВАТ');
  assert.equal(button('special')['aria-label'], 'Электромагнитная мина, 35 энергии');
  assert.equal(button('dash').classList.contains('escape-ready'), false);
  player.grabTarget = 'p2'; player.grabHoldTime = .4; player.grabStrikes = 1;
  ui.update(state, 'p1');
  assert.equal(button('heavy').label.textContent, 'БРОСОК');
  assert.equal(button('special')['aria-label'], 'Импульс, 25 энергии');
  assert.equal(byId('escape-prompt').dataset.kind, 'hold');
  assert.match(byId('escape-title').textContent, /1 \/ 2/);
  player.grabTarget = null;
  player.action = 'hit'; player.variant = 'heavyStagger'; player.defenseOnly = .60;
  ui.update(state, 'p1');
  for (const action of ['light', 'heavy', 'special', 'ultimate']) assert.equal(button(action).disabled, true, `${action}: defense-only disallows offense`);
  assert.equal(button('dash').disabled, false); assert.equal(button('block').disabled, false);
  assert.equal(button('dash').label.textContent, 'СБРОС', 'paid burst remains available during the microstun');
  player.action = 'idle'; player.variant = ''; player.defenseOnly = .33;
  ui.update(state, 'p1');
  assert.equal(button('dash').label.textContent, 'ОТСКОК');
  assert.equal(button('block').classList.contains('parry-ready'), false);
  assert.match(byId('move-recipe').textContent, /БЛОК \/ ПРЫЖОК \/ НАЗАД/);
  assert.equal(button('ultimate').disabled, true, 'offensive controls stay disabled after the full stun has ended');
  player.defenseOnly = 0; ui.update(state, 'p1');
  assert.equal(button('heavy').disabled, false);
  state.phase = 'finishing';
  state.finish = { stage: 'offer', type: 'coreRip', winner: 'p1', target: 'p2', time: 2, canTrigger: true };
  player.energy = 0;
  ui.update(state, 'p1');
  assert.equal(button('heavy').disabled, false);
  assert.equal(button('ultimate').disabled, false);
  assert.equal(button('light').disabled, true);
  assert.equal(byId('finisher-prompt').hidden, false);
  assert.equal(button('heavy').label.textContent, 'ДОБИТЬ');
  state.phase = 'paused'; ui.update(state, 'p1');
  assert.equal(button('heavy').disabled, true);
  assert.equal(byId('finisher-prompt').hidden, true);
  state.phase = 'finishing'; state.finish.stage = 'execute'; ui.update(state, 'p1');
  assert.equal(button('ultimate').disabled, true);
  assert.equal(byId('finisher-title').textContent, 'СОРВАННОЕ ЯДРО');
  state.phase = 'fight'; state.finish = null; state.round = 3; ui.update(state, 'p1');
  assert.equal(byId('finisher-prompt').hidden, true);
  assert.equal(button('heavy').disabled, false);
  assert.equal(button('heavy').classList.contains('finish-ready'), false);
  ui.reset();
  assert.equal(byId('move-recipe').hidden, true);
});
