import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMechanicalEffects } from '../src/mechanical-effects.js';
import { slamChoreography, slamRenderHeight, createSlamRootFollower } from '../src/slam-choreography.js';
import { buildSlamCase, SLAM_CASES } from '../scripts/slam-review.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
const originalLoad = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await loadRobotAssets();
GLTFLoader.prototype.loadAsync = originalLoad;

function bounds(robot) {
  robot.group.updateMatrixWorld(true);
  const box = new THREE.Box3(), feet = {}, point = new THREE.Vector3();
  robot.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.toArray().every(Number.isFinite));
      box.expandByPoint(point);
      const bone = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(i)].name;
      if (/leg_.._foot/.test(bone)) feet[bone] = Math.min(feet[bone] ?? Infinity, point.y);
    }
  });
  return { box, feet };
}

for (const facing of [-1, 1]) {
  test(`real jump → slam keeps authoritative contact and original geometry supported, facing ${facing}`, () => {
    for (const type of Object.keys(SLAM_CASES)) {
      const data = buildSlamCase(type, facing), contact = data.contacts[0];
      assert.equal(data.contacts.length, 1, `${type}: exactly one landing impact`);
      const damage = data.events.filter(event => event.type === 'hit' && event.variant === 'slam');
      assert.equal(damage.length, ['block', 'airMiss', 'miss'].includes(type) ? 0 : 1);
      if (type === 'block') assert.equal(data.events.filter(event => event.type === 'block' && event.variant === 'slam').length, 1);
      const robot = createRobot({ skin: facing === 1 ? 'amber' : 'cyan' });
      let previous;
      for (let frame = 0; frame <= contact.frame + 28; frame++) {
        const player = data.snapshots[frame].players[0];
        robot.group.position.set(player.x, player.y, 0);
        robot.update(player, 1 / 60, frame / 60);
        assert.deepEqual(robot.group.position.toArray(), [player.x, player.y, 0], 'articulation never overrides server root');
        const shape = bounds(robot), center = shape.box.getCenter(new THREE.Vector3()).sub(robot.group.position);
        assert.ok(shape.box.min.y >= -.0001, `${type}/${frame}: original skinned surface clips the floor`);
        if (frame === contact.frame) assert.ok(shape.box.min.y < .04, `${type}: impact occurs while feet hover ${shape.box.min.y}`);
        if (previous) assert.ok(center.distanceTo(previous) < .15, `${type}/${frame}: local silhouette jumps ${center.distanceTo(previous)}`);
        previous = center;
        if (frame >= contact.frame + 4 && frame <= contact.frame + 12) {
          for (const [leg, y] of Object.entries(shape.feet)) assert.ok(y < .075, `${type}/${frame}: ${leg} not bearing weight (${y})`);
        }
      }
      const player = data.snapshots[contact.frame + 4].players[0];
      robot.group.position.set(player.x, player.y, 0);
      robot.update({ ...player, visualPaused: true }, 0, contact.frame / 60);
      const pose = [];
      robot.group.traverse(o => { if (o.isBone) pose.push(...o.position, ...o.quaternion); });
      for (let frame = 0; frame < 20; frame++) robot.update({ ...player, visualPaused: true }, 0, 100 + frame);
      const frozen = [];
      robot.group.traverse(o => { if (o.isBone) frozen.push(...o.position, ...o.quaternion); });
      assert.deepEqual(frozen, pose, 'paused contact pose does not continue settling');
      robot.dispose();
    }
  });
}

test('deployment responds to remaining height and settles inside the existing recovery', () => {
  const high = slamChoreography({ elapsed: .10, y: 1.4, vy: -9.5 });
  const low = slamChoreography({ elapsed: .10, y: .18, vy: -9.5 });
  assert.ok(high.front.y > low.front.y + .4, 'a low dive must deploy its toes instead of hitting in a tuck');
  const full = slamChoreography({ elapsed: .257, landedTime: .20 });
  const reduced = slamChoreography({ elapsed: .257, landedTime: .20, reducedMotion: true });
  assert.equal(full.compression, reduced.compression, 'reduced motion preserves weight and support');
  const settled = slamChoreography({ elapsed: .62, landedTime: .20 });
  assert.equal(settled.brace, 0);
  assert.ok(Math.abs(settled.bob) < 1e-8);
});

test('live 30 Hz snapshots land on the actual contact without exponential lag or a final snap', t => {
  let worstStep = 0, worstContactStep = 0, worstReconciliation = 0;
  for (const type of ['early', 'apex', 'late']) for (const fps of [30, 60, 120]) for (const phase of [0, 1]) {
    const data = buildSlamCase(type), contact = data.contacts[0].frame;
    const follower = createSlamRootFollower();
    let y = 0, priorPredicted = null, priorPlayer = null, priorAge = 0;
    for (let frame = 0; frame < (contact + 8) * fps / 60; frame++) {
      const serverFrame = Math.floor(frame * 60 / fps);
      const snapshotFrame = Math.max(0, serverFrame - (serverFrame + phase) % 2);
      const player = data.snapshots[snapshotFrame].players[0];
      const age = frame / fps - snapshotFrame / 60;
      const target = Math.max(0, player.y + player.vy * age);
      const animationDt = snapshotFrame >= contact ? 1 / fps * .05 : 1 / fps;
      const followedY = y + (target - y) * (1 - Math.exp(-animationDt * 23));
      const predicted = follower.update(player, age, followedY);
      const next = predicted ?? followedY;
      if (player.variant === 'slam') worstStep = Math.max(worstStep, Math.abs(next - y) * fps / 60);
      if (snapshotFrame >= contact && snapshotFrame <= contact + 1) {
        assert.equal(next, 0, 'hitstop must begin on the floor, never suspended above it');
        if (priorPredicted !== null) worstContactStep = Math.max(worstContactStep, Math.abs(next - y) * fps / 60);
        if (priorPlayer) worstReconciliation = Math.max(worstReconciliation, slamRenderHeight(priorPlayer, priorAge + 1 / fps) ?? 0);
      }
      y = next; priorPredicted = predicted; priorPlayer = player; priorAge = age;
    }
  }
  // A frame of real descent can be 0.21 m at 60 fps. The same bound holds at
  // the handoff from normal jump interpolation; no extra end-of-dive snap.
  assert.ok(worstStep < .23, `root frame step ${worstStep}`);
  assert.ok(worstContactStep < .22, `last contact-frame step ${worstContactStep}`);
  assert.ok(worstReconciliation < .025, `extra contact reconciliation ${worstReconciliation}`);
  assert.equal(slamRenderHeight({ variant: '', y: 1, vy: -10 }), null, 'ordinary jumps retain their existing interpolation');
  t.diagnostic(`At 30/60/120 fps: maximum root speed ${worstStep.toFixed(4)} m per 1/60 s; final contact step ${worstContactStep.toFixed(4)} m per 1/60 s (includes descent); residual prediction correction ${worstReconciliation.toFixed(4)} m.`);
});

test('one contact gives low floor debris; duplicate, paused and reconnect history remain quiet', () => {
  const scene = new THREE.Scene(), sparks = [];
  const effects = createMechanicalEffects(scene, { spark: (...args) => sparks.push(args) });
  const data = buildSlamCase('apex'), contact = data.contacts[0], state = data.snapshots[contact.frame];
  const land = data.events.find(event => event.type === 'land' && event.player === 'p1');
  assert.equal(effects.emit(land, state), 0, 'companion land event must not double the slam');
  effects.emit(contact, state);
  const count = sparks.length, stats = effects.getStats();
  assert.equal(count, 20);
  assert.equal(stats.waveActive, 1);
  assert.equal(stats.plumesEmitted, 8);
  assert.ok(sparks.every(s => s[1] < .1 && s[4] < 1.81 && s[8] <= .125), 'debris stays shallow and below the fighters');
  effects.emit(contact, state);
  assert.equal(sparks.length, count);
  effects.clear();
  effects.emit(contact, { ...state, phase: 'paused' });
  assert.equal(effects.getStats().waveActive, 0);
  effects.clear();
  effects.emit(contact, data.snapshots[contact.frame + 20]);
  assert.equal(effects.getStats().plumesEmitted, 0, 'late reconnection must not repeat the floor impact');
  effects.clear(); effects.setQuality('low'); effects.setReducedMotion(true);
  effects.emit(contact, { ...state, players: state.players.map(player => player.id === 'p1' ? { ...player, y: .3 } : player) });
  assert.equal(effects.getStats().plumesEmitted, 4);
  assert.equal(effects.getStats().waveActive, 1);
  effects.dispose();
});
