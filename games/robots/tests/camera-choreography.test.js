import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraContactProfile, createCameraChoreography, projectCameraPoint, CAMERA_LIMITS } from '../src/camera-choreography.js';
import { buildHeavyCase } from '../scripts/heavy-review.js';
import { buildSlamCase } from '../scripts/slam-review.js';
import { buildV5Case } from '../scripts/combat-v5-cases.js';

const players = [{ id: 'p1', x: -1.25, y: 0, facing: 1 }, { id: 'p2', x: 1.25, y: 0, facing: -1 }];
const heavy = { id: 1, type: 'hit', player: 'p1', target: 'p2', variant: 'heavyDrive', damage: 13 };

test('framing projection agrees with actual Three camera at arbitrary translation and tilt', () => {
  const frame = { x: 1.4, y: 4.2, z: 13, tx: 1.1, ty: 1.7, tz: -.2 }, aspect = 844 / 390;
  const camera = new THREE.PerspectiveCamera(36, aspect, .1, 70);
  camera.position.set(frame.x, frame.y, frame.z); camera.lookAt(frame.tx, frame.ty, frame.tz); camera.updateMatrixWorld();
  for (const point of [{ x: 4, y: 2, z: .85 }, { x: -2, y: 4, z: -.8 }, { x: 0, y: 0, z: 0 }]) {
    const actual = new THREE.Vector3(point.x, point.y, point.z).project(camera), result = projectCameraPoint(point, frame, aspect);
    assert.ok(Math.abs(actual.x - result.x) < 1e-12); assert.ok(Math.abs(actual.y - result.y) < 1e-12);
  }
});

test('heavy accents have direction, lift and compression; reversal mirrors only horizontal force', () => {
  const drive = cameraContactProfile(heavy, players);
  const hook = cameraContactProfile({ ...heavy, variant: 'heavyHook' }, players);
  const press = cameraContactProfile({ ...heavy, variant: 'heavyPress' }, players);
  assert.ok(drive.x > hook.x && drive.x > press.x);
  assert.ok(hook.y > 0 && press.y < 0 && press.z > drive.z);
  const mirrored = cameraContactProfile(heavy, players.map(p => ({ ...p, x: -p.x, facing: -p.facing })));
  assert.equal(mirrored.x, -drive.x); assert.equal(mirrored.y, drive.y); assert.equal(mirrored.z, drive.z);
  assert.equal(cameraContactProfile({ ...heavy, variant: 'grab' }, players), null);
  assert.equal(cameraContactProfile({ ...heavy, type: 'launch' }, players), null);
});

test('camera has no idle motion; single contact ends in exact rest, with only a small return lobe', () => {
  const camera = createCameraChoreography(), idle = camera.update(0, players);
  for (let i = 0; i < 120; i++) assert.deepEqual(camera.update(1 / 60, players), idle);
  camera.contact(heavy, players);
  let peak = 0, negative = 0;
  for (let i = 0; i < 120; i++) { const frame = camera.update(1 / 60, players); peak = Math.max(peak, frame.x - idle.x); negative = Math.min(negative, frame.x - idle.x); }
  assert.ok(peak > .05 && peak < .1);
  assert.ok(Math.abs(negative) < peak * .16);
  assert.deepEqual(camera.stats().frame, idle);
  assert.equal(camera.stats().activeImpulses, 0);
});

test('render-rate independence at 30, 60 and 120 Hz; impact age is continuous', () => {
  const values = [30, 60, 120].map(hz => {
    const camera = createCameraChoreography(); camera.update(0, players); camera.contact(heavy, players);
    for (let i = 0; i < hz / 5; i++) camera.update(1 / hz, players);
    return camera.stats().frame;
  });
  for (const frame of values.slice(1)) for (const key of Object.keys(frame)) assert.ok(Math.abs(frame[key] - values[0][key]) < 1e-10, `${key}: frame rate drift`);
});

test('critical framing spring reaches the same moving-target response at every render rate', () => {
  const shifted = players.map(p => ({ ...p, x: p.x + 2 }));
  const samples = [30, 60, 120].map(hz => {
    const camera = createCameraChoreography(); camera.update(0, players);
    for (let i = 0; i < hz / 2; i++) camera.update(1 / hz, shifted);
    return camera.stats().frame;
  });
  for (const frame of samples) { assert.ok(frame.x > 1.8 && frame.x < 2); assert.ok(Math.abs(frame.x - samples[0].x) < 1e-10); }
});

test('pause preserves a live kick exactly and resumes without collecting paused time', () => {
  const camera = createCameraChoreography(); camera.update(0, players); camera.contact(heavy, players);
  const stopped = camera.update(1 / 60, players);
  for (let i = 0; i < 120; i++) assert.deepEqual(camera.update(1 / 60, players, { paused: true }), stopped);
  const resumed = camera.update(1 / 60, players);
  const uninterrupted = createCameraChoreography(); uninterrupted.update(0, players); uninterrupted.contact(heavy, players); uninterrupted.update(2 / 60, players);
  assert.deepEqual(resumed, uninterrupted.stats().frame);
});

test('duplicate, historical and reduced-motion contacts do not restart or retain feedback', () => {
  const camera = createCameraChoreography(), idle = camera.update(0, players);
  camera.contact(heavy, players, { historical: true }); camera.contact(heavy, players);
  assert.deepEqual(camera.update(.1, players), idle);
  camera.contact({ ...heavy, id: 2 }, players, { reduced: true });
  assert.deepEqual(camera.update(.1, players, { reduced: true }), idle);
  camera.contact({ ...heavy, id: 3 }, players); camera.update(.05, players);
  assert.deepEqual(camera.update(.05, players, { reduced: true }), idle);
  camera.clearFeedback(); assert.equal(camera.stats().activeImpulses, 0);
});

test('pathological contact batch stays within a fixed pool and translation budget', () => {
  const camera = createCameraChoreography(), idle = camera.update(0, players);
  for (let i = 0; i < 200; i++) camera.contact({ ...heavy, id: i, type: 'destruction' }, players);
  assert.equal(camera.stats().activeImpulses, CAMERA_LIMITS.slots);
  const frame = camera.update(.05, players);
  for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(frame[key] - idle[key]) <= CAMERA_LIMITS[key] + 1e-9, `${key} exceeds budget`);
});

for (const [label, build] of [['heavy', () => buildHeavyCase('series')], ['backthrow', () => buildV5Case('backthrow')], ['slam', () => buildSlamCase('apex')], ['finisher', () => buildV5Case('finish')], ['air', () => buildV5Case('air')]]) {
  test(`${label}: actual CombatRoom frames keep both bodies inside 844×390 and 16:9 viewports`, t => {
    const data = build();
    for (const aspect of [844 / 390, 16 / 9]) for (const hz of [30, 60, 120]) {
      const camera = createCameraChoreography(), emitted = new Set();
      const stats = { minDistance: 99, maxDistance: 0, maxDistanceStep: 0, xExtent: 0, yExtent: 0 }; let previous;
      for (let i = 0; i < data.snapshots.length * hz / 60; i++) {
        const state = data.snapshots[Math.min(data.snapshots.length - 1, Math.floor(i * 60 / hz))];
        for (const e of state.events) if (!emitted.has(e.id)) { emitted.add(e.id); camera.contact(e, state.players); }
        const frame = camera.update(1 / hz, state.players, { aspect });
        stats.minDistance = Math.min(stats.minDistance, frame.z); stats.maxDistance = Math.max(stats.maxDistance, frame.z);
        if (previous) stats.maxDistanceStep = Math.max(stats.maxDistanceStep, Math.abs(frame.z - previous.z)); previous = frame;
        for (const p of state.players) for (const x of [p.x - 1.4, p.x + 1.4]) for (const y of [p.y, p.y + 2.7]) {
          const q = projectCameraPoint({ x, y, z: .8 }, frame, aspect);
          stats.xExtent = Math.max(stats.xExtent, Math.abs(q.x)); stats.yExtent = Math.max(stats.yExtent, Math.abs(q.y));
          assert.ok(Math.abs(q.x) < .90, `${label} x=${q.x}, frame ${i}, ${hz}Hz`);
          assert.ok(q.y > -.80 && q.y < .78, `${label} y=${q.y}, frame ${i}, ${hz}Hz`);
          assert.ok(frame.z <= CAMERA_LIMITS.maxDistance);
        }
      }
      if (aspect === 844 / 390 && hz === 60) t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value.toFixed(4))]))));
    }
  });
}
