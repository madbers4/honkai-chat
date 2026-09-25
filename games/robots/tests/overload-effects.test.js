import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOverloadEffects, overloadChargeRadius } from '../src/overload-effects.js';
import { ATTACKS, ULTIMATE_PULSES } from '../shared/constants.js';
function setup(t) {
  const scene = new THREE.Scene(), fx = createOverloadEffects(scene);
  const state = { room: 'A', round: 1, phase: 'fight', players: [
    { id: 'p1', x: -2, y: 0, facing: 1, action: 'ultimate', actionTime: ATTACKS.ultimate.startup, skin: 'amber' },
    { id: 'p2', x: 2, y: 0, facing: -1, action: 'hit', variant: 'overloadHit', actionTime: 0, skin: 'cyan' }] };
  t.after(() => fx.dispose()); return { fx, scene, state };
}
test('overload pulses and current cages freeze while paused; no snapshot can invent a discharge', t => {
  const { fx, scene, state } = setup(t);
  for (const time of [.2, ...ULTIMATE_PULSES.map(p => p.time), ATTACKS.ultimate.duration]) { state.players[0].actionTime = time; fx.update(1 / 60, time, state); }
  assert.equal(fx.getStats().pulses, 0);
  state.players[0].actionTime = ATTACKS.ultimate.startup;
  const event = { id: 1, type: 'ultimatePulse', player: 'p1', pulse: 0, facing: 1, range: 5.2 };
  fx.emit(event, state); fx.emit(event, state); assert.equal(fx.getStats().pulses, 1);
  fx.emit({ id: 2, type: 'hit', variant: 'overload', player: 'p1', target: 'p2' }, state); fx.update(.02, 1, state);
  const beam = scene.getObjectByName('ultimate-pulse-0'), cage = scene.children.find(o => o.name === 'overload-victim-current' && o.visible);
  const before = beam.children[0].material.uniforms.age.value, position = Array.from(cage.geometry.attributes.position.array);
  state.phase = 'paused'; for (let i = 0; i < 120; i++) fx.update(1 / 60, i, state);
  assert.equal(beam.children[0].material.uniforms.age.value, before); assert.deepEqual(Array.from(cage.geometry.attributes.position.array), position);
  fx.emit({ ...event, id: 3 }, state); assert.equal(fx.getStats().pulses, 1);
});
test('historical events, old timestamps and changing room/round cannot replay overload bursts', t => {
  const { fx, state } = setup(t);
  const event = { id: 1, type: 'ultimatePulse', player: 'p1', pulse: 0 };
  fx.emit({ ...event, presentationHistorical: true }, state); assert.equal(fx.getStats().pulses, 0);
  state.players[0].actionTime = ATTACKS.ultimate.startup + .7; fx.emit(event, state); assert.equal(fx.getStats().pulses, 0);
  state.players[0].actionTime = ATTACKS.ultimate.startup; fx.emit({ ...event, id: 2 }, state); assert.equal(fx.getStats().activePulses, 1);
  state.round = 2; state.players[0].action = 'idle'; fx.update(0, 0, state); assert.equal(fx.getStats().activePulses, 0);
});
test('thousands of overload events use a fixed pool, finite geometry, HDR materials and two bounded lights', t => {
  const { fx, scene, state } = setup(t), baseline = scene.children.length, resourceCount = fx.getStats().resources;
  for (let i = 0; i < 1200; i++) {
    fx.emit({ id: i, type: 'ultimatePulse', player: 'p1', pulse: 0, facing: i % 2 ? 1 : -1 }, state);
    fx.update(1 / 120, i / 120, state);
  }
  assert.equal(scene.children.length, baseline); assert.equal(fx.getStats().resources, resourceCount);
  assert.equal(fx.getStats().capacity, 6); assert.equal(fx.getStats().lights, 2);
  let hdr = 0;
  scene.traverse(object => {
    assert.ok([...object.position, ...object.quaternion, ...object.scale].every(Number.isFinite));
    if (object.geometry) assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
    if (object.material?.userData.glowSource) hdr++;
  }); assert.ok(hdr > 10);
  fx.setQuality('low'); fx.setReducedMotion(true); fx.update(.02, 20, state);
  assert.ok(scene.children.filter(o => o.isPointLight).every(light => light.intensity === 0));
  for (let i = 0; i < 120; i++) fx.update(1 / 60, i, { ...state, players: state.players.map(p => ({ ...p, action: 'idle' })) });
  assert.equal(fx.getStats().activePulses, 0); fx.dispose(); assert.equal(scene.children.length, 0);
});

for (const quality of ['high', 'low']) for (const reduced of [false, true]) test(`${quality}/${reduced}: warning ring shrinks through the entire authoritative charge, lane stays grounded`, t => {
  const { fx, scene, state } = setup(t); fx.setQuality(quality); fx.setReducedMotion(reduced);
  const group = scene.getObjectByName('overload-capacitor-0'), ring = group.children[0], lane = scene.getObjectByName('overload-danger-zone');
  let previous = Infinity;
  for (let i = 0; i < 111; i++) {
    const time = i / 60; state.players[0].actionTime = time; fx.update(1 / 60, time, state);
    assert.ok(group.visible && ring.visible && lane.visible, `countdown disappeared at ${time}`);
    assert.ok(ring.scale.x < previous, `the countdown grew at ${time}`); previous = ring.scale.x;
    assert.equal(ring.scale.x, overloadChargeRadius(time));
    assert.ok(group.position.y + ring.position.y - ring.scale.y >= .074, 'the large early countdown never intersects the deck');
    assert.equal(lane.position.y, .052); assert.equal(lane.scale.x, ATTACKS.ultimate.range);
    assert.equal(fx.getStats().pulses, 0, 'charge never invents a beam');
  }
  assert.ok(previous < .21, 'the ring meets the core before the first pulse');
  state.players[0].actionTime = ATTACKS.ultimate.startup; fx.update(0, 2, state);
  assert.ok(!ring.visible && lane.visible, 'deadline removes the ring while the firing lane remains');
  assert.ok(scene.children.filter(o => o.isPointLight).every(light => light.visible), 'quality never changes the shader light count');
});

test('interrupting a charge removes the warning immediately and neither an early nor cancelled packet invents a beam', t => {
  const { fx, scene, state } = setup(t);
  const source = state.players[0], event = { type: 'ultimatePulse', player: source.id, pulse: 0 };
  source.actionTime = ATTACKS.ultimate.startup - .30;
  fx.update(0, 0, state); fx.emit({ ...event, id: 1 }, state);
  assert.equal(fx.getStats().pulses, 0);
  source.action = 'hit'; source.actionTime = 0; fx.update(0, 0, state); fx.emit({ ...event, id: 2 }, state);
  for (const name of ['overload-capacitor-0', 'overload-danger-zone', 'overload-charge-ring']) assert.equal(scene.getObjectByName(name).visible, false);
  assert.equal(fx.getStats().activePulses, 0);
});
