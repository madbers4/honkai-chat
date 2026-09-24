import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAbilityEffects, ABILITY_LIMITS } from '../src/ability-effects.js';
import { buildSpecialCase } from '../scripts/special-review.js';

function setup(t) {
  const scene = new THREE.Scene(), tint = new THREE.Color('#56d4ed'), sparks = [];
  const effects = createAbilityEffects(scene, { colorFor: () => tint, spark: (...args) => sparks.push(args) });
  t.after(() => effects.dispose()); return { scene, effects, sparks };
}
const mine = (age = .05, id = 1) => ({ id, x: 0, age, owner: 'p1', variant: 'shockwave', radius: 3.65 });
const state = (projectiles = [mine()]) => ({ round: 1, phase: 'fight', players: [], projectiles });
const visual = scene => scene.children.map(o => ({ visible: o.visible, position: o.position.toArray(),
  children: o.children.map(c => ({ scale: c.scale.toArray(), age: c.material?.uniforms?.age.value })),
  age: o.material?.uniforms?.age.value, intensity: o.intensity }));

test('mine reconstructs its authoritative age without historical sparks and pauses exactly', t => {
  const { effects, scene, sparks } = setup(t);
  effects.update(.016, state([mine(.22)])); assert.equal(sparks.length, 0);
  const paused = { ...state([mine(.22)]), phase: 'paused' }; effects.update(.016, paused);
  const before = visual(scene);
  for (let i = 0; i < 180; i++) effects.update(.016, paused);
  assert.deepEqual(visual(scene), before);
  assert.equal(sparks.length, 0);
  effects.update(0, { ...paused, visualSeekToken: 'next', projectiles: [mine(.3)] });
  assert.notDeepEqual(visual(scene), before); assert.equal(sparks.length, 0);
});

test('live mine emits one bounded detonation and pool allocation never grows', t => {
  const { effects, scene, sparks } = setup(t);
  const children = [...scene.children];
  for (let i = 0; i < 25; i++) effects.update(1/60, state([mine(i / 60)]));
  assert.equal(effects.getStats().bursts, 1); assert.equal(sparks.length, 28);
  for (let f = 0; f < 1000; f++) effects.update(.016, state(Array.from({ length: 20 }, (_, i) => mine(.05, f * 20 + i))));
  assert.deepEqual(scene.children, children); assert.ok(effects.getStats().mines <= ABILITY_LIMITS.mines);
  assert.ok(effects.getStats().lights <= ABILITY_LIMITS.lights);
});

test('duplicate/current/historical contacts are bounded; low and calm keep physical location', t => {
  const { effects, scene } = setup(t);
  const current = { ...state([]), players: [{ id: 'p2', actionTime: 0, x: 2, y: 0, action: 'hit' }] };
  const event = { id: 42, type: 'hit', variant: 'bolt', player: 'p1', target: 'p2', x: 2, y: 1.35 };
  effects.emit({ ...event, presentationHistorical: true }, current); assert.equal(effects.getStats().contacts, 0);
  effects.emit(event, current); effects.emit(event, current); effects.update(0, current);
  assert.equal(effects.getStats().contacts, 1);
  const pos = scene.getObjectByName('special-ion-contact').position.toArray();
  effects.setQuality('low'); effects.setReducedMotion(true); effects.update(0, current);
  assert.deepEqual(scene.getObjectByName('special-ion-contact').position.toArray(), pos); assert.equal(effects.getStats().lights, 0);
  effects.update(.05, { ...current, round: 2 }); assert.equal(effects.getStats().contacts, 0);
});

test('current actual special snapshots show a mine only for its lifetime; mirrored side has same damage', t => {
  const { effects } = setup(t);
  for (const facing of [-1,1]) {
    const data = buildSpecialCase({ variant: 'shockwave', facing }); effects.clear();
    for (const snapshot of data.snapshots) {
      effects.update(1 / 60, snapshot);
      assert.equal(effects.getStats().mines, snapshot.projectiles.length);
      assert.ok(effects.getStats().emitters <= 1);
    }
    assert.equal(data.snapshots.at(-1).players[1].hp, 138);
  }
});

test('all resources release exactly once and disposed abilities remain inert', t => {
  const { scene, effects } = setup(t); const uniqueMaterials = new Set(), uniqueGeometry = new Set();
  scene.traverse(o => { if (o.material) uniqueMaterials.add(o.material); if (o.geometry) uniqueGeometry.add(o.geometry); });
  let disposed = 0; for (const resource of [...uniqueMaterials,...uniqueGeometry]) resource.addEventListener('dispose', () => disposed++);
  effects.dispose(); effects.dispose(); effects.update(.016,state());
  assert.equal(disposed, uniqueMaterials.size + uniqueGeometry.size); assert.equal(scene.children.length,0);
});
