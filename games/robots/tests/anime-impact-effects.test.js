import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAnimeImpactEffects, ANIME_IMPACT_LIMITS } from '../src/anime-impact-effects.js';
import { createCombatEffects } from '../src/effects.js';
import { buildHeavyCase } from '../scripts/heavy-review.js';
import { buildGrappleCase } from '../scripts/grapple-cases.js';
import { buildSpecialCase } from '../scripts/special-review.js';

const state = () => ({ room: 'INK', round: 1, elapsed: 3.5, phase: 'fight', players: [
  { id: 'p1', x: -1, y: 0, facing: 1, skin: 'amber' },
  { id: 'p2', x: 1, y: 0, facing: -1, skin: 'cyan' },
] });
const contact = (id = 1, extra = {}) => ({ id, type: 'hit', player: 'p1', target: 'p2', x: 1, y: 1.15, damage: 12, variant: 'jab', ...extra });
function setup(t) {
  const scene = new THREE.Scene(), effects = createAnimeImpactEffects(scene);
  t.after(() => effects.dispose());
  return { scene, effects, mesh: scene.getObjectByName('anime-authoritative-contacts') };
}

test('real melee, guard, parry, grapple and projectile recordings produce exactly their authoritative contacts', t => {
  const { effects } = setup(t);
  for (const data of [buildHeavyCase('light'), buildHeavyCase('series'), buildHeavyCase('block'), buildHeavyCase('parry'),
    buildGrappleCase('two'), buildSpecialCase(), buildSpecialCase({ variant: 'shockwave' }), buildHeavyCase('whiff'), buildGrappleCase('whiff')]) {
    effects.clear();
    for (const snapshot of data.snapshots) {
      // Deliberately feed the repeated server event tail, not prefiltered mocks.
      for (const event of snapshot.events) effects.emit(event, snapshot);
      effects.update(1 / 60, snapshot);
    }
    const actual = data.events.filter(event => ['hit', 'grabStrike', 'block', 'parry'].includes(event.type)
      && !(event.type === 'hit' && event.variant === 'grab'));
    assert.equal(effects.getStats().emitted, actual.length, `events: ${actual.map(e => e.type + '/' + e.variant).join(', ')}`);
    assert.equal(effects.getStats().active, 0, 'short marks fully expire after the recorded exchange');
  }
});

test('contact anchors belong to struck armor; parry is located on its defending event.player and mirrors the incoming direction', t => {
  const { effects, mesh } = setup(t), current = state();
  current.players[1].damageAnchors = { head: new THREE.Vector3(1.4, 2.1, .1), core: new THREE.Vector3(.78, 1.16, .63),
    rear: new THREE.Vector3(.78, 1.16, -.4), corrupt: new THREE.Vector3(NaN, 1, 0) };
  current.players[0].damageAnchors = { core: new THREE.Vector3(-1.2, 1.12, .42) };
  assert.equal(effects.emit(contact(), current), true);
  const center = mesh.geometry.attributes.aCenter.array.slice(0, 3);
  for (const [value, expected] of [...center].map((v, i) => [v, [.78, 1.16, .72][i]])) assert.ok(Math.abs(value - expected) < 1e-6);
  current.players[1].damageAnchors.core.x = 9;
  effects.update(.05, current);
  assert.deepEqual(mesh.geometry.attributes.aCenter.array.slice(0, 3), center, 'knockback does not drag the impact across the screen');
  effects.emit(contact(2, { type: 'parry', x: -1.1 }), current);
  assert.ok(Math.abs(mesh.geometry.attributes.aCenter.array[3] + 1.2) < 1e-6);
  assert.equal(mesh.geometry.attributes.aFacing.array[1], -1, 'parry direction reverses the defender facing');
  assert.equal(mesh.geometry.attributes.aInfo.array[7], 2, 'parry uses crossed deflection artwork');
  effects.emit(contact(3, { type: 'block', facing: -1 }), current);
  assert.equal(mesh.geometry.attributes.aFacing.array[2], -1);
  assert.equal(mesh.geometry.attributes.aInfo.array[11], 1, 'block uses an open guard, not a hit star');
  effects.emit(contact(4, { type: 'block', guardBreak: true }), current);
  assert.equal(mesh.geometry.attributes.aInfo.array[15], 3, 'a broken guard has its own fractured silhouette');
});

test('history, paused contacts, stale packets and invalid events never flare later on resume', t => {
  const { effects, mesh } = setup(t), current = state();
  effects.emit(contact(1, { presentationHistorical: true }), current);
  effects.emit(contact(1), current);
  effects.emit(contact(2), { ...current, phase: 'paused' });
  effects.emit(contact(2), current);
  effects.emit(contact(3, { at: 2.4 }), current);
  effects.emit(contact(4, { type: 'attack' }), current);
  effects.emit(contact(5, { damage: 0 }), current);
  effects.emit(contact(6, { variant: 'grab' }), current);
  effects.emit(contact(7, { target: 'missing' }), current);
  effects.emit(contact(undefined, { id: undefined }), current);
  assert.equal(effects.getStats().active, 0); assert.equal(mesh.visible, false);
  assert.equal(effects.getStats().historical, 3);
  assert.equal(effects.emit(contact(8), current), true);
  const before = [...mesh.geometry.attributes.aInfo.array];
  for (let i = 0; i < 120; i++) effects.update(.05, { ...current, phase: 'paused' });
  assert.deepEqual([...mesh.geometry.attributes.aInfo.array], before, 'pause holds one quiet mark, never animates or re-emits it');
  effects.update(.05, current); assert.ok(mesh.geometry.attributes.aInfo.array[0] > before[0]);
  effects.update(0, { ...current, round: 2 });
  assert.equal(mesh.visible, false); assert.equal(effects.getStats().historySize, 0);
  assert.equal(effects.emit(contact(1), { ...current, round: 2 }), true);
  effects.update(0, { ...current, round: 2, visualSeekToken: 'seek' });
  assert.equal(mesh.visible, false);
});

test('one fixed draw and constant history survive spam, quality changes, calm fades and invalid dt', t => {
  const { effects, scene, mesh } = setup(t), current = state();
  const allocations = { geometry: mesh.geometry, material: mesh.material, buffers: Object.values(mesh.geometry.attributes).map(a => a.array) };
  for (let id = 1; id <= 4096; id++) effects.emit(contact(id), current);
  assert.equal(scene.children.length, 1); assert.equal(effects.getStats().active, ANIME_IMPACT_LIMITS.contacts);
  assert.equal(mesh.geometry.instanceCount, ANIME_IMPACT_LIMITS.contacts);
  assert.equal(effects.getStats().historySize, 1);
  assert.equal(effects.emit(contact(1), current), false, 'an old duplicate cannot return after a bounded Set would evict it');
  effects.setQuality('low');
  assert.equal(effects.getStats().active, ANIME_IMPACT_LIMITS.low);
  effects.setReducedMotion(true);
  assert.equal(effects.getStats().active, ANIME_IMPACT_LIMITS.reduced);
  assert.equal(mesh.material.uniforms.calm.value, 1, 'calm shader disables movement and speed streaks, retaining only fade');
  const centers = [...mesh.geometry.attributes.aCenter.array];
  for (const dt of [NaN, Infinity, -.1, 0]) effects.update(dt, current);
  assert.deepEqual([...mesh.geometry.attributes.aCenter.array], centers);
  for (let frame = 0; frame < 40; frame++) effects.update(1 / 60, current);
  assert.equal(mesh.visible, false); assert.equal(mesh.geometry.instanceCount, 0);
  assert.equal(effects.getStats().drawCalls, 0);
  assert.equal(mesh.geometry, allocations.geometry); assert.equal(mesh.material, allocations.material);
  Object.values(mesh.geometry.attributes).forEach((attribute, i) => {
    assert.equal(attribute.array, allocations.buffers[i]); assert.ok(attribute.array.every(Number.isFinite));
  });
});

test('combat facade emits anime contacts before ability early returns and forwards lifecycle/quality', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
  const scene = new THREE.Scene(), effects = createCombatEffects(scene);
  t.after(() => { effects.dispose(); if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const current = state(); current.projectiles = [];
  effects.emit(contact(1, { variant: 'bolt', damage: 28, action: 'special' }), current);
  assert.equal(effects.getEffectsStats().abilities.contacts, 1);
  assert.equal(effects.getEffectsStats().anime.emitted, 1, 'ability contact did not swallow anime contact');
  effects.emit(contact(2, { type: 'block' }), current);
  assert.equal(effects.getEffectsStats().anime.blocks, 1, 'mechanical early return did not swallow guard contact');
  effects.setQuality('low'); effects.setReducedMotion(true);
  assert.equal(effects.getEffectsStats().anime.low, true); assert.equal(effects.getEffectsStats().anime.reduced, true);
  effects.update(.05, 1, current); effects.clear();
  assert.equal(effects.getEffectsStats().anime.active, 0);
  effects.dispose(); assert.equal(scene.children.length, 0);
});

test('resources release once; calls after disposal stay inert', t => {
  const { effects, scene, mesh } = setup(t), current = state();
  let geometryDisposed = 0, materialDisposed = 0;
  mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
  mesh.material.addEventListener('dispose', () => materialDisposed++);
  effects.emit(contact(), current); effects.dispose(); effects.dispose();
  effects.emit(contact(2), current); effects.update(.016, current); effects.clear(); effects.setQuality('low'); effects.setReducedMotion(true);
  assert.equal(scene.children.length, 0); assert.equal(effects.getStats().active, 0);
  assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1);
});
