import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHeavyCase } from '../scripts/heavy-review.js';
import { createMechanicalEffects } from '../src/mechanical-effects.js';
import { V5_ATTACKS } from '../shared/constants.js';
import { buildHeavyAdvantageCase } from '../scripts/heavy-advantage-cases.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
const originalLoad = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); };
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
await loadRobotAssets(); GLTFLoader.prototype.loadAsync = originalLoad;

function bounds(robot) {
  const box = new THREE.Box3(), point = new THREE.Vector3(); robot.group.updateMatrixWorld(true);
  robot.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      assert.ok(point.toArray().every(Number.isFinite)); box.expandByPoint(point);
    }
  });
  return box;
}

for (const facing of [1, -1]) test(`actual heavy rig reaches the opponent and follows the supported hops through all links, facing ${facing}`, () => {
  const robots = [createRobot(), createRobot({ skin: 'cyan' })], data = buildHeavyCase('series', facing);
  const hits = new Map(data.events.filter(e => e.type === 'hit').map(e => [e.frame, e]));
  const links = new Set(data.events.filter(e => e.type === 'attack' && e.chain > 1).map(e => e.frame));
  const silhouettes = [];
  let previous;
  for (let frame = 0; frame < data.snapshots.length; frame++) {
    const state = data.snapshots[frame];
    for (let n = 0; n < 2; n++) {
      const p = state.players[n]; robots[n].group.position.set(p.x, p.y, 0); robots[n].update(p, 1 / 60, frame / 60);
      assert.equal(robots[n].group.position.x, p.x, 'the rig must never replace authoritative travel');
    }
    if (frame % 3 === 0) {
      const box = bounds(robots[0]); assert.ok(box.min.y >= -.0001, 'all original vertices clear the floor');
      const floorMargin = state.players[0].y < .02 ? .075 : .25;
      assert.ok(box.min.y < floorMargin + state.players[0].y, `frame ${frame}: support ${box.min.y} / root ${state.players[0].y}`);
    }
    const current = robots[0].getCombatAnchors();
    if (links.has(frame)) {
      for (const key of ['leftClaw', 'rightClaw']) assert.ok(current[key].distanceTo(previous[key]) < .23, 'a combo link must preserve its hand-off pose, never pop back to neutral');
    }
    previous = { leftClaw: current.leftClaw.clone(), rightClaw: current.rightClaw.clone() };
    if (hits.has(frame)) {
      const event = hits.get(frame), anchors = robots[0].getCombatAnchors();
      const claw = event.variant === 'heavyDrive' ? anchors.rightClaw : anchors.leftClaw;
      const target = bounds(robots[1]);
      assert.ok(target.distanceToPoint(claw) < .35, `${event.variant} does not touch its victim: ${target.distanceToPoint(claw)}`);
      assert.ok(claw.y > .35 && claw.y < 1.6, 'a heavy hits the mechanism, not the floor');
      silhouettes.push([anchors.leftClaw.y.toFixed(1), anchors.rightClaw.y.toFixed(1)].join(':'));
    }
  }
  assert.equal(new Set(silhouettes).size, 3, 'contact poses keep distinct single-claw and double-claw silhouettes');
  robots.forEach(r => r.dispose());
});

test('heavy ribbons follow only the striking claw and the authoritative active interval', () => {
  for (const variant of ['heavyDrive', 'heavyHook', 'heavyPress']) {
    const scene = new THREE.Scene(), fx = createMechanicalEffects(scene, { spark() {} });
    const player = { id: 'p1', action: 'heavy', variant, skin: 'amber', combatAnchors: {} };
    const state = { room: 'ribbon', round: 1, phase: 'fight', players: [player] };
    let observed = false;
    for (let frame = 0; frame < 60; frame++) {
      const t = frame / 60; player.actionTime = t;
      for (const side of ['left', 'right']) {
        player.combatAnchors[`${side}Claw`] = new THREE.Vector3(side === 'left' ? -2 : 2, 1, t * 2);
        player.combatAnchors[`${side}ClawBase`] = new THREE.Vector3(side === 'left' ? -2 : 2, .8, t * 2 - .2);
      }
      fx.update(1 / 60, t, state);
      const geometry = scene.getObjectByName('claw-contact-trails').geometry;
      if (t < V5_ATTACKS[variant].startup - .045) assert.equal(geometry.drawRange.count, 0, 'no ribbon during the load pose');
      if (geometry.drawRange.count) {
        observed = true;
        const xs = Array.from({ length: geometry.drawRange.count }, (_, i) => geometry.attributes.position.getX(i));
        if (variant === 'heavyDrive') assert.ok(xs.every(x => x > 0), 'drive uses the right claw');
        if (variant === 'heavyHook') assert.ok(xs.every(x => x < 0), 'hook uses the left claw');
        if (variant === 'heavyPress') assert.ok(xs.some(x => x < 0) && xs.some(x => x > 0), 'press uses both claws');
      }
    }
    assert.ok(observed); assert.equal(fx.getStats().trailVertices, 0, 'ribbons expire after recovery'); fx.dispose();
  }
});

for (const facing of [-1, 1]) test(`heavy microstagger and shallow slam bounce preserve original victim supports, facing ${facing}`, t => {
  let worstStep = 0, minBelly = Infinity, maxFoot = 0;
  for (const type of ['series', 'slam']) {
    const data = buildHeavyAdvantageCase(type, facing), robot = createRobot({ skin: 'cyan' });
    let previous;
    for (let frame = 0; frame < 160; frame++) {
      const player = data.snapshots[frame].players[1]; robot.group.position.set(player.x, player.y, 0); robot.update(player, 1 / 60, frame / 60);
      assert.deepEqual(robot.group.position.toArray(), [player.x, player.y, 0]);
      const box = bounds(robot), center = box.getCenter(new THREE.Vector3()).sub(robot.group.position);
      assert.ok(box.min.y >= -.0001, `${type}/${frame}: original geometry clips the deck`);
      if (previous) worstStep = Math.max(worstStep, center.distanceTo(previous)); previous = center;
      if (player.action === 'hit' && player.y === 0) {
        const minima = {}, point = new THREE.Vector3();
        robot.group.traverse(mesh => {
          if (!mesh.isSkinnedMesh) return;
          for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
            const name = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(i)].name;
            if (name !== 'chassis' && !/leg_.._foot/.test(name)) continue;
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); minima[name] = Math.min(minima[name] ?? Infinity, point.y);
          }
        });
        minBelly = Math.min(minBelly, minima.chassis); assert.ok(minima.chassis > .015, `${type}/${frame}: belly replaces the feet`);
        for (const [name, value] of Object.entries(minima)) if (name !== 'chassis') {
          maxFoot = Math.max(maxFoot, value); assert.ok(value < .07, `${type}/${frame}: ${name} not supporting (${value})`);
        }
      }
    }
    const contact = data.contacts[0].frame;
    const player = { ...data.snapshots[contact + 4].players[1], visualPaused: true, visualSeekToken: 1 };
    robot.group.position.set(player.x, player.y, 0); robot.update(player, 0, (contact + 4) / 60);
    const before = bounds(robot); for (let i = 0; i < 10; i++) robot.update(player, 0, 100 + i);
    assert.ok(bounds(robot).min.distanceTo(before.min) < .00001, 'paused new reaction remains frozen'); robot.dispose();
  }
  assert.ok(worstStep < .15, `local silhouette frame step ${worstStep}`);
  t.diagnostic(`Worst local frame step ${worstStep.toFixed(4)}m; grounded belly ${minBelly.toFixed(4)}m; feet ${maxFoot.toFixed(4)}m.`);
});
