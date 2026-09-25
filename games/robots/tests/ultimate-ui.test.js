import test from 'node:test';
import assert from 'node:assert/strict';
import { createUltimateUI } from '../src/ultimate-ui.js';

test('tap prompt reflects legal availability and its charge ring follows the server, never a held pointer', t => {
  const old = globalThis.document, title = {}, classes = new Set(), properties = {}, attrs = {};
  const button = { querySelector: () => title, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } }, style: { setProperty(name, value) { properties[name] = value; } }, setAttribute(name, value) { attrs[name] = value; } };
  const hint = {}, fill = { style: {} }, elements = { 'ultimate-btn': button, 'ultimate-hint': hint, 'ultimate-fill': fill };
  globalThis.document = { getElementById: id => elements[id] }; t.after(() => { globalThis.document = old; });
  const ui = createUltimateUI(), player = { id: 'p1', hp: 180, energy: 80, action: 'idle', actionTime: 0, y: 0, cooldowns: {} };
  const state = { phase: 'fight', players: [player] };
  ui.update(state, player.id); assert.equal(title.textContent, 'НАЖМИ'); assert.match(attrs['aria-label'], /один раз/);
  player.action = 'light'; player.variant = 'jab'; ui.update(state, player.id);
  assert.equal(title.textContent, 'ГОТОВА'); assert.doesNotMatch(attrs['aria-label'], /нажми/);
  player.action = 'idle'; player.defenseOnly = .4; ui.update(state, player.id); assert.equal(title.textContent, 'ГОТОВА');
  player.defenseOnly = 0; player.action = 'ultimate'; player.actionTime = .475; player.energy = 0; player.cooldowns.ultimate = 8;
  ui.update(state, player.id); assert.equal(title.textContent, 'ЗАРЯДКА'); assert.equal(properties['--charge'], '0.5');
  ui.hold({ active: false, amount: 0 }); assert.equal(properties['--charge'], '0.5');
  assert.ok(classes.has('arming')); assert.match(hint.textContent, /БРОНЯ/);
  player.actionTime = 1.1; ui.update(state, player.id); assert.equal(title.textContent, 'РАЗРЯД'); assert.ok(classes.has('discharging'));
  assert.equal(properties['--charge'], '1'); assert.ok(!classes.has('arming'));
});
