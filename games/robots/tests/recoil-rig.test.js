import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { recoilChoreography } from '../src/recoil-choreography.js';
import { buildRecoilCase, RECOIL_CASES } from '../scripts/recoil-review.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
const originalLoad = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await loadRobotAssets();
GLTFLoader.prototype.loadAsync = originalLoad;

function shape(robot) {
  robot.group.updateMatrixWorld(true);
  const box = new THREE.Box3(), feet = {}, point = new THREE.Vector3();
  let belly = Infinity;
  robot.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.toArray().every(Number.isFinite)); box.expandByPoint(point);
      const bone = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(i)].name;
      if (/leg_.._foot/.test(bone)) feet[bone] = Math.min(feet[bone] ?? Infinity, point.y);
      if (bone === 'chassis') belly = Math.min(belly, point.y);
    }
  });
  return { box, feet, belly };
}

test('ordinary damage begins at contact and all targets settle within canonical stun, including anti-juggle 50 ms', () => {
  for (const duration of [.05, .18, .22, .26, .30, .40, .43, .52, .60]) {
    const start = recoilChoreography({ elapsed: 0, duration });
    for (const name of ['bob', 'thrust', 'lean', 'roll', 'twist', 'headPitch', 'headYaw', 'headRoll']) {
      assert.equal(Math.abs(start[name]), 0, `${duration}: no anticipation`);
      for (const elapsed of [duration, duration + .2]) assert.equal(Math.abs(recoilChoreography({ elapsed, duration })[name]), 0, `${duration}: ${name} overran control recovery`);
    }
  }
  const light = recoilChoreography({ elapsed: .08, duration: .26 });
  const heavy = recoilChoreography({ elapsed: .08, duration: .52 });
  assert.ok(Math.abs(heavy.bob) > Math.abs(light.bob) * 2);
  assert.ok(Math.abs(heavy.thrust) > Math.abs(light.thrust) * 2);
  assert.equal(recoilChoreography({ elapsed: .08, duration: .52, reducedMotion: true }).bob, heavy.bob);
});

for (const facing of [-1, 1]) test(`real GLB catches all recorded hits on supports without local teleports, facing ${facing}`, t => {
  let worstFeet = 0, worstStep = 0, lowestBelly = Infinity, interruptionCount = 0;
  for (const type of Object.keys(RECOIL_CASES)) {
    const data = buildRecoilCase(type, facing), robot = createRobot({ skin: 'cyan' });
    assert.equal(data.contacts.length, ['jab', 'drive'].includes(type) ? 1 : type === 'cross' ? 2 : 3);
    let previous, previousAction;
    for (let frame = 0; frame < data.snapshots.length; frame++) {
      const player = data.snapshots[frame].players[1];
      robot.group.position.set(player.x, player.y, 0);
      robot.update(player, 1 / 60, frame / 60);
      assert.deepEqual(robot.group.position.toArray(), [player.x, player.y, 0]);
      if (frame % 2 === 0 || data.contacts.some(event => Math.abs(frame - event.frame) <= 1)) {
        const current = shape(robot), center = current.box.getCenter(new THREE.Vector3()).sub(robot.group.position);
        assert.ok(current.box.min.y >= -.0001, `${type}/${frame}: surface beneath deck`);
        if (previous) worstStep = Math.max(worstStep, center.distanceTo(previous));
        previous = center;
        if (player.action === 'hit' && player.y === 0) {
          lowestBelly = Math.min(lowestBelly, current.belly);
          for (const value of Object.values(current.feet)) worstFeet = Math.max(worstFeet, value);
          assert.ok(current.belly > .035, `${type}/${frame}: chassis rests on belly ${current.belly}`);
          for (const [leg, value] of Object.entries(current.feet)) assert.ok(value < .075, `${type}/${frame}: ${leg} floats ${value}`);
        }
      }
      if (data.contacts.some(event => event.frame === frame) && previousAction === 'hit') interruptionCount++;
      previousAction = player.action;
    }
    robot.dispose();
  }
  assert.ok(worstStep < .17, `two-frame local bounds change ${worstStep}`);
  assert.ok(interruptionCount > 0, 'the real sequence must include another hit during an unfinished reaction');
  t.diagnostic(`Maximum support height ${worstFeet.toFixed(4)} m, belly clearance ${lowestBelly.toFixed(4)} m, two-frame local silhouette step ${worstStep.toFixed(4)} m; ${interruptionCount} interrupted reactions.`);
});

test('accumulated springs return by control recovery, while turret follows chassis later', t => {
  for (const duration of [.26, .30, .40, .52]) {
    const robot = createRobot(), body = robot.group.getObjectByName('chassis'), head = robot.group.getObjectByName('turret');
    for (let i = 0; i < 30; i++) robot.update({ action: 'idle', facing: 1 }, 1 / 60, 0);
    let bodyPeak = 0, headPeak = 0, bodyAt = 0, headAt = 0;
    for (let frame = 0; frame <= Math.ceil(duration * 60); frame++) {
      const elapsed = Math.min(duration, frame / 60);
      robot.update({ action: 'hit', actionTime: elapsed, actionDuration: duration, facing: 1 }, 1 / 60, 0);
      const bodyAngle = -new THREE.Euler().setFromQuaternion(body.quaternion).x;
      const headAngle = -new THREE.Euler().setFromQuaternion(head.quaternion).x;
      if (bodyAngle > bodyPeak) { bodyPeak = bodyAngle; bodyAt = elapsed; }
      if (headAngle > headPeak) { headPeak = headAngle; headAt = elapsed; }
    }
    assert.ok(headAt >= bodyAt + .015, `duration ${duration}: head must follow the load rather than move as a rigid prop`);
    assert.ok(body.quaternion.angleTo(new THREE.Quaternion()) < .035);
    assert.ok(head.quaternion.angleTo(new THREE.Quaternion()) < .05);
    t.diagnostic(`${duration}s stun: chassis peak ${bodyAt.toFixed(3)}s, turret peak ${headAt.toFixed(3)}s; end angles ${body.quaternion.angleTo(new THREE.Quaternion()).toFixed(3)}/${head.quaternion.angleTo(new THREE.Quaternion()).toFixed(3)} rad.`);
    robot.dispose();
  }
});

test('paused seeks freeze the actual rig and revisiting the same hit is deterministic', () => {
  const robot = createRobot(), pose = () => {
    const values = []; robot.group.traverse(o => { if (o.isBone) values.push(...o.position, ...o.quaternion); }); return values;
  };
  const player = { action: 'hit', variant: '', actionTime: .115, actionDuration: .52, facing: -1, hp: 60, visualPaused: true, visualSeekToken: 1 };
  robot.update(player, 0, 1); const initial = pose();
  for (let i = 0; i < 25; i++) robot.update(player, 0, 30 + i);
  assert.deepEqual(pose(), initial, 'paused recoil must not continue oscillating');
  robot.update({ ...player, actionTime: .4, visualSeekToken: 2 }, 0, 1);
  robot.update({ ...player, visualSeekToken: 3 }, 0, 1); const replayed = pose();
  assert.ok(Math.max(...replayed.map((value, index) => Math.abs(value - initial[index]))) < .002, 'rewind must not retain a later hit pose');
  robot.dispose();
});
