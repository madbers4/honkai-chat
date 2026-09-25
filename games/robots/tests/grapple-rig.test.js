import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';
import { buildGrappleCase } from '../scripts/grapple-cases.js';
import { grappleBeat } from '../src/grapple-choreography.js';
import { V5_RULES } from '../shared/constants.js';
import { pairedRoot } from '../src/paired-root.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await withRobotAssetFixture(loadRobotAssets);

function bounds(robot) {
  const box = new THREE.Box3(), point = new THREE.Vector3();
  robot.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.toArray().every(Number.isFinite)); box.expandByPoint(point);
    }
  });
  return box;
}

// Distance to actual deformed triangles, not to the very forgiving combined
// robot AABB (which includes the opponent's extended feet and empty space).
function housingDistance(robot, point) {
  const tri = new THREE.Triangle(), nearest = new THREE.Vector3();
  let distance = Infinity;
  robot.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? mesh.geometry.attributes.position.count); i += 3) {
      const ids = [0, 1, 2].map(n => index ? index.getX(i + n) : i + n);
      if (mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(ids[0])].name !== 'chassis') continue;
      for (const [n, vertex] of [tri.a, tri.b, tri.c].entries()) mesh.getVertexPosition(ids[n], vertex).applyMatrix4(mesh.matrixWorld);
      tri.closestPointToPoint(point, nearest); distance = Math.min(distance, nearest.distanceTo(point));
    }
  });
  return distance;
}

function updatePair(robots, state, frame, paused = false) {
  for (let n = 0; n < 2; n++) {
    const player = state.players[n], partner = state.players[1 - n];
    robots[n].group.position.set(player.x, player.y, 0);
    robots[n].update({ ...player, grabPartnerX: partner.x, grabPartnerY: partner.y, visualPaused: paused }, paused ? 0 : 1 / 60, frame / 60);
    assert.deepEqual(robots[n].group.position.toArray(), [player.x, player.y, 0], 'choreography cannot move authoritative roots');
  }
}

for (const facing of [-1, 1]) for (const separation of [1.8, 2.1, 2.45]) {
  test(`paired lock and two pummels touch original housing (${facing}, ${separation})`, () => {
    const robots = [createRobot(), createRobot({ skin: 'cyan' })], data = buildGrappleCase('two', facing, separation);
    const near = facing === 1 ? 'leftClaw' : 'rightClaw', far = facing === 1 ? 'rightClaw' : 'leftClaw';
    const impacts = new Set(data.events.filter(e => e.type === 'grabStrike').map(e => e.frame));
    const contactHeights = [], loadDistances = [];
    let previous, maxGripGap = 0;
    for (let frame = 0; frame < data.snapshots.length; frame++) {
      const state = data.snapshots[frame], p = state.players[0]; updatePair(robots, state, frame);
      const anchors = robots[0].getCombatAnchors();
      if (frame % 3 === 0) for (const robot of robots) assert.ok(bounds(robot).min.y >= -.0001, 'all articulated source geometry must clear the floor');
      if (previous) for (const side of [near, far]) assert.ok(anchors[side].distanceTo(previous[side]) < .235, `claw pops between phases at frame ${frame}`);
      previous = { [near]: anchors[near].clone(), [far]: anchors[far].clone() };
      if (p.grabTarget && p.grabHoldTime > .15 && frame % 3 === 0) maxGripGap = Math.max(maxGripGap, housingDistance(robots[1], anchors[far]));
      if (p.grabStrikeTime > .05 && p.grabStrikeTime < .075) loadDistances.push(housingDistance(robots[1], anchors[near]));
      if (impacts.has(frame)) {
        assert.ok(housingDistance(robots[1], anchors[near]) < .09, 'server damage must coincide with a claw on the original housing');
        assert.ok(anchors[near].y > .5 && anchors[near].y < 1.0, 'pummel contacts the exposed chassis belt');
        assert.ok(anchors[near].z > 0, 'the active arm remains visible on either side of the arena');
        contactHeights.push(anchors[near].y);
      }
    }
    assert.ok(maxGripGap < .125, `supporting claw loses contact: ${maxGripGap}`);
    assert.equal(contactHeights.length, 2);
    assert.ok(contactHeights[1] - contactHeights[0] > .085, 'second strike must visibly rise from its lower preparation');
    assert.ok(loadDistances.every(distance => distance > .16), 'each hit must have a readable withdrawal before contact');
    robots.forEach(robot => robot.dispose());
  });
}

for (const facing of [-1, 1]) for (const type of ['one', 'hold', 'early', 'back', 'tech', 'whiff']) {
  test(`grapple ${type} preserves support, continuity and pause, facing ${facing}`, () => {
    const robots = [createRobot(), createRobot({ skin: 'cyan' })], data = buildGrappleCase(type, facing);
    let previous;
    for (let frame = 0; frame < data.snapshots.length; frame++) {
      const state = data.snapshots[frame]; updatePair(robots, state, frame);
      const current = robots.map(robot => ({ leftClaw: robot.getCombatAnchors().leftClaw.clone().sub(robot.group.position), rightClaw: robot.getCombatAnchors().rightClaw.clone().sub(robot.group.position) }));
      if (previous) for (let n = 0; n < 2; n++) {
        const paired = player => ['grab', 'grabbed', 'grabBreak', 'thrown'].includes(player.variant);
        // Generic idle/jump auto-facing after a back throw is separate from
        // the paired rig. Its turn is documented for a locomotion pass. A
        // release to thrown, however, must always retain its previous pose.
        const prior = data.snapshots[frame - 1].players[n];
        if (!paired(state.players[n]) && (!paired(prior) || prior.facing !== state.players[n].facing)) continue;
        for (const side of ['leftClaw', 'rightClaw']) assert.ok(current[n][side].distanceTo(previous[n][side]) < .29, `${type} actor ${n} discontinuity at frame ${frame}`);
      }
      previous = current;
      if (frame % 6 === 0) for (const robot of robots) assert.ok(bounds(robot).min.y >= -.0001);
      if (data.contacts.some(contact => contact.frame === frame)) {
        updatePair(robots, state, frame, true);
        const stopped = robots.map(robot => robot.getCombatAnchors().leftClaw.clone());
        for (let i = 0; i < 8; i++) updatePair(robots, state, frame, true);
        robots.forEach((robot, n) => assert.ok(robot.getCombatAnchors().leftClaw.distanceTo(stopped[n]) < 1e-10, 'a paused grip must not continue settling'));
      }
    }
    const strikes = data.events.filter(event => event.type === 'grabStrike');
    assert.equal(strikes.length, type === 'one' ? 1 : type === 'back' ? 2 : 0);
    if (type === 'whiff') assert.ok(!data.events.some(event => ['throw', 'grab'].includes(event.type)));
    robots.forEach(robot => robot.dispose());
  });
}

test('a held opponent is still between contacts and never recoils before authoritative damage', () => {
  for (const grabStrikes of [1, 2]) for (let t = 0; t < V5_RULES.grabStrikeImpact; t += .001) {
    assert.equal(grappleBeat({ grabStrikeTime: t, grabStrikes }).recoil, 0);
  }
  const robot = createRobot({ skin: 'cyan' });
  const player = { action: 'hit', variant: 'grabbed', facing: -1, actionTime: .4, grabHoldTime: .4, grabbedBy: 'p1', hp: 100 };
  for (let i = 0; i < 60; i++) robot.update(player, 1 / 60, i / 60);
  const poses = [];
  for (let i = 60; i < 120; i++) {
    robot.update({ ...player, actionTime: i / 60, grabHoldTime: i / 60 }, 1 / 60, i / 60);
    poses.push(robot.getCombatAnchors().head.clone());
  }
  assert.ok(poses.every(point => point.distanceTo(poses[0]) < .0001), 'holding alone cannot jitter the victim every frame');
  robot.dispose();
});

for (const facing of [-1, 1]) test(`seeking from completed back throw to windup keeps the pair together (${facing})`, () => {
  const robots = [createRobot(), createRobot({ skin: 'cyan' })], data = buildGrappleCase('back', facing);
  // Same update ordering as arena: actor zero seeks before actor one's visual
  // root has moved. The old root is now on the opposite side of the holder.
  for (let frame = 0; frame <= 160; frame++) updatePair(robots, data.snapshots[frame], frame);
  const state = data.snapshots[85], oldVisuals = robots.map(robot => ({ x: robot.group.position.x, y: robot.group.position.y }));
  assert.ok((oldVisuals[1].x - oldVisuals[0].x) * facing < 0);
  for (let n = 0; n < 2; n++) {
    const p = state.players[n], root = pairedRoot(oldVisuals[1 - n], state.players[1 - n], true);
    robots[n].group.position.set(p.x, p.y, 0);
    robots[n].update({ ...p, grabPartnerX: root.x, grabPartnerY: root.y, visualPaused: true, visualSeekToken: 1 }, 0, 85 / 60);
  }
  for (const claw of ['leftClaw', 'rightClaw']) assert.ok(housingDistance(robots[1], robots[0].getCombatAnchors()[claw]) < .13, `windup loses ${claw} after late-frame seek`);
  const live = pairedRoot({ x: .75, y: .25 }, { x: 1, y: .5 }, false);
  assert.deepEqual(live, { x: .75, y: .25 }, 'ordinary playback keeps interpolated contact');
  robots.forEach(robot => robot.dispose());
});
