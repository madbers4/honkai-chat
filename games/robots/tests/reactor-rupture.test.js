import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createReactorRupture } from '../src/reactor-rupture.js';
import { createMechanicalEffects } from '../src/mechanical-effects.js';
import { buildV5Case } from '../scripts/combat-v5-cases.js';

const player = () => ({ id: 'p2', action: 'defeated', facing: -1, combatAnchors: { core: new THREE.Vector3(1, 1.2, .3) } });
function rig(t) {
  const scene = new THREE.Scene(), sparks = [], plumes = [];
  const fx = createReactorRupture(scene, { spark: (...p) => sparks.push(p), plume: (p, data) => plumes.push({ origin: p.clone(), ...data }), pressure() {} });
  t.after(() => fx.dispose()); return { scene, fx, sparks, plumes };
}

test('pre-release heat follows the real moving core, freezes in pause and times out without inventing a blast', t => {
  const { scene, fx, sparks } = rig(t), target = player(), state = { phase: 'finishing', players: [target] };
  fx.prime({ target: target.id, duration: .9 }, target, target.combatAnchors.core);
  for (let i = 0; i < 30; i++) fx.update(1 / 60, state);
  target.combatAnchors.core.set(2.3, 1.8, -.2); fx.update(1 / 60, state);
  const mesh = scene.getObjectByName('compact-reactor-release');
  const center = mesh.geometry.attributes.aCenter.array;
  assert.ok(Math.abs(center[0] - 2.3) < 1e-6 && Math.abs(center[1] - 1.8) < 1e-6);
  const frozen = [...mesh.geometry.attributes.aLife.array], count = sparks.length;
  state.phase = 'paused'; for (let i = 0; i < 120; i++) fx.update(1 / 30, state);
  assert.deepEqual([...mesh.geometry.attributes.aLife.array], frozen); assert.equal(sparks.length, count);
  state.phase = 'finishing'; for (let i = 0; i < 90; i++) fx.update(1 / 60, state);
  assert.equal(fx.getStats().active, 0); assert.equal(fx.getStats().releases, 0);
});

test('blast is anchored once, remains compact and uses bounded disposable resources across modes', t => {
  const { scene, fx, sparks, plumes } = rig(t), target = player(), state = { phase: 'finishing', players: [target] };
  const mesh = scene.getObjectByName('compact-reactor-release');
  let disposed = 0; mesh.geometry.addEventListener('dispose', () => disposed++); mesh.material.addEventListener('dispose', () => disposed++);
  const counts = [];
  for (const mode of ['high', 'low', 'reduced']) {
    fx.clear(); sparks.length = 0; plumes.length = 0; fx.setQuality(mode); fx.setReducedMotion(mode === 'reduced');
    fx.release({ target: target.id, variant: 'overload' }, target, target.combatAnchors.core);
    const origin = target.combatAnchors.core.clone(); target.combatAnchors.core.x += 5;
    fx.update(.04, state);
    assert.ok(Math.abs(mesh.geometry.attributes.aCenter.getX(0) - origin.x) < 1e-6, 'rupture stays where the casing opened');
    assert.ok(plumes.every(p => p.size < .6), 'individual fire/dust volumes do not cover the robot');
    assert.ok(sparks.every(p => p.slice(0, 6).every(Number.isFinite)));
    counts.push(sparks.length);
    for (let i = 0; i < 180; i++) fx.update(1 / 60, state);
    assert.equal(fx.getStats().active, 0);
    assert.ok(mesh.geometry.attributes.aLife.array.every(x => x === 0));
    assert.equal(scene.children.length, 1);
    assert.equal(mesh.geometry.instanceCount, 16);
  }
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2]);
  fx.dispose(); fx.dispose(); assert.equal(disposed, 2); assert.equal(scene.children.length, 0);
});

for (const type of ['finish', 'overload', 'brutality']) test(`real ${type} recording owns one charge and one rupture; old history stays quiet`, () => {
  const data = buildV5Case(type), scene = new THREE.Scene();
  const fx = createMechanicalEffects(scene, { spark() {} });
  const seen = new Set();
  for (const state of data.snapshots) {
    state.players.forEach(p => { p.combatAnchors = { core: new THREE.Vector3(p.x, p.y + .8, .3) }; });
    for (const event of state.events) { fx.emit(event, state); seen.add(event.type); }
    fx.update(1 / 60, 0, state);
  }
  assert.equal(fx.getStats().rupture.primes, 1); assert.equal(fx.getStats().rupture.releases, 1);
  assert.equal(fx.getStats().rupture.active, 0);
  const state = data.snapshots.at(-1), event = data.events.find(e => e.type === 'destruction');
  fx.clear(); fx.emit(event, state); fx.update(.01, 0, state);
  assert.equal(fx.getStats().rupture.releases, 0);
  fx.dispose(); assert.equal(scene.children.length, 0);
});
