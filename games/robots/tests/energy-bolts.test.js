import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEnergyBolts, BOLT_CAPACITY } from '../src/energy-bolts.js';
import { buildProjectileCase } from '../scripts/projectile-review.js';

function setup(t) {
  const scene = new THREE.Scene();
  const amber = new THREE.Color('#ffbd5c'), cyan = new THREE.Color('#6bdfff');
  const effect = createEnergyBolts(scene, (owner, state) => state.players.find(p => p.id === owner)?.skin === 'cyan' ? cyan : amber);
  t.after(() => effect.dispose());
  const mesh = scene.getObjectByName('energy-bolts');
  return { scene, effect, mesh, amber, cyan };
}
const shot = (id = 1, direction = 1) => ({ id, owner: direction === 1 ? 'p1' : 'p2', x: 1, y: 1.35, direction, speed: 10.5 });
const snapshot = (projectiles = [shot()], phase = 'fight') => ({ projectiles, phase, players: [{ id: 'p1', skin: 'amber' }, { id: 'p2', skin: 'cyan' }] });
const attributes = mesh => Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)]));

test('bolt presentation preserves server anchors, speed cap and mirrored team direction', t => {
  const { effect, mesh, amber, cyan } = setup(t);
  const state = snapshot([shot(1), shot(2, -1)]);
  effect.update(1 / 60, state);
  const anchor = mesh.geometry.attributes.aAnchor, color = mesh.geometry.attributes.aColor;
  assert.equal(mesh.geometry.instanceCount, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(anchor.getX(i), 1);
    assert.ok(Math.abs(anchor.getY(i) - 1.35) < .00001);
    assert.equal(anchor.getZ(i), i === 0 ? 1 : -1);
    const tint = i === 0 ? amber : cyan;
    assert.ok(Math.abs(color.getX(i) - tint.r) < .00001 && Math.abs(color.getY(i) - tint.g) < .00001 && Math.abs(color.getZ(i) - tint.b) < .00001);
  }
  effect.update(1 / 60, state);
  assert.ok(Math.abs(anchor.getX(0) - 1.175) < .00001);
  assert.ok(Math.abs(anchor.getX(1) - .825) < .00001);
  for (let i = 0; i < 300; i++) effect.update(1 / 60, state);
  assert.ok(Math.abs(anchor.getX(0) - 1.4725) < .00001, 'same snapshot never extrapolates beyond the existing 45ms cap');
  assert.deepEqual(state.projectiles, [shot(1), shot(2, -1)], 'visual updates never mutate gameplay');
});

test('pause and zero dt freeze every bolt buffer, while explicit seek changes pose', t => {
  const { effect, mesh } = setup(t);
  const state = snapshot();
  effect.update(.016, state); effect.update(.016, state);
  const before = attributes(mesh);
  for (let frame = 0; frame < 180; frame++) effect.update(0, state);
  assert.deepEqual(attributes(mesh), before);
  state.phase = 'paused';
  for (let frame = 0; frame < 180; frame++) effect.update(.016, state);
  assert.deepEqual(attributes(mesh), before);
  state.projectiles = [{ ...state.projectiles[0], x: -2 }];
  effect.update(.016, state);
  assert.deepEqual(attributes(mesh), before, 'a paused replacement snapshot cannot make an existing bolt drift');
  state.visualSeekToken = 'scrub-2'; effect.update(0, state);
  assert.equal(mesh.geometry.attributes.aAnchor.getX(0), -2);
  assert.equal(mesh.geometry.attributes.aPhase.getX(0), 0);
});

test('a fixed pool survives thousands of replacements, mixed waves, duplicates and overload input', t => {
  const { scene, effect, mesh } = setup(t);
  const buffers = Object.values(mesh.geometry.attributes).map(a => a.array);
  const geometry = mesh.geometry, material = mesh.material;
  for (let frame = 0; frame < 2000; frame++) {
    const shots = Array.from({ length: 20 }, (_, i) => shot(frame * 20 + i));
    shots.unshift({ ...shot('ground'), variant: 'shockwave' });
    effect.update(1 / 60, snapshot(shots));
    assert.equal(scene.children.length, 1);
    assert.equal(mesh.geometry.instanceCount, BOLT_CAPACITY);
    assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
    Object.values(mesh.geometry.attributes).forEach((a, i) => assert.equal(a.array, buffers[i]));
  }
  effect.update(.016, snapshot([shot(1), shot(1)]));
  assert.equal(mesh.geometry.instanceCount, 1, 'duplicate IDs cannot create duplicate visuals');
  effect.update(.016, snapshot([{ ...shot(2), x: NaN }, { ...shot(3), y: Infinity }]));
  assert.equal(mesh.visible, false);
  assert.ok(Object.values(mesh.geometry.attributes).every(a => a.array.every(Number.isFinite)));
});

test('absence, reconnect, same-id variant changes and clear remove bolts immediately', t => {
  const { scene, effect, mesh } = setup(t);
  effect.update(.016, snapshot());
  effect.update(0, snapshot([], 'paused'));
  assert.equal(mesh.visible, false); assert.equal(mesh.geometry.instanceCount, 0);
  effect.update(.016, snapshot()); effect.update(0, null);
  assert.equal(mesh.visible, false);
  effect.update(.016, snapshot()); effect.update(.016, snapshot([{ ...shot(), variant: 'shockwave' }]));
  assert.equal(mesh.visible, false, 'ground wave is handled only by its existing renderer');
  effect.update(0, snapshot());
  assert.equal(mesh.geometry.attributes.aAnchor.getX(0), 1, 'reconnect starts at current server pose without a historical emission');
  effect.clear(); assert.equal(mesh.visible, false); assert.equal(scene.children.length, 1);
});

test('quality and calm settings never change positions or allocate resources, all GPU buffers dispose once', t => {
  const { effect, mesh, scene } = setup(t);
  effect.update(.016, snapshot());
  const before = attributes(mesh);
  for (const mode of ['low', 'high', 'low']) {
    effect.setQuality(mode); effect.setReducedMotion(true); effect.update(0, snapshot());
    assert.deepEqual(attributes(mesh), before);
    assert.equal(mesh.material.uniforms.detail.value, mode === 'low' ? 0 : 1);
    assert.equal(mesh.material.uniforms.calm.value, 1);
  }
  let geometries = 0, materials = 0;
  mesh.geometry.addEventListener('dispose', () => geometries++);
  mesh.material.addEventListener('dispose', () => materials++);
  effect.dispose(); effect.dispose(); effect.update(.016, snapshot());
  assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(scene.children.length, 0);
});

test('actual CombatRoom launch and contact produce exactly their authoritative visible flight in both skins and facings', t => {
  const { effect, mesh } = setup(t);
  for (const facing of [-1, 1]) for (const skin of ['amber', 'cyan']) for (const block of [false, true]) {
    effect.clear(); const data = buildProjectileCase({ facing, skin, block });
    assert.ok(data.flight > 0 && data.contact > data.flight);
    const original = JSON.stringify(data.snapshots);
    for (let i = 0; i < data.snapshots.length; i++) {
      const state = data.snapshots[i]; effect.update(1 / 60, state);
      assert.equal(mesh.visible, state.projectiles.length > 0);
      if (mesh.visible) {
        assert.ok(Math.abs(mesh.geometry.attributes.aAnchor.getX(0) - state.projectiles[0].x) < .00001);
        assert.equal(mesh.geometry.attributes.aAnchor.getZ(0), facing);
      }
    }
    assert.equal(JSON.stringify(data.snapshots), original);
    assert.equal(data.events.filter(e => e.type === (block ? 'block' : 'hit')).length, 1);
  }
});
