import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildOverloadCase } from '../scripts/overload-review-cases.js';
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
const bytes = await fs.readFile(new URL('../public/assets/automaton.glb', import.meta.url));
const original = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = function () { return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); };
const { loadRobotAssets, createRobot } = await import('../src/robot.js'); await loadRobotAssets(); GLTFLoader.prototype.loadAsync = original;
function bounds(robot) {
  robot.group.updateMatrixWorld(true); const box = new THREE.Box3(), point = new THREE.Vector3();
  robot.group.traverse(mesh => { if (!mesh.isSkinnedMesh || !mesh.visible) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); assert.ok(point.toArray().every(Number.isFinite)); box.expandByPoint(point);
    }
  }); return box;
}
for (const facing of [-1, 1]) test(`actual overload charge, hit locks and round shutdown retain floor support (${facing})`, t => {
  const robots = [createRobot(), createRobot({ skin: 'cyan' })]; t.after(() => robots.forEach(r => r.dispose()));
  const recording = buildOverloadCase('contact', facing);
  for (let frame = 0; frame < 185; frame++) {
    const state = recording.snapshots[frame];
    state.players.forEach((p, i) => {
      const r = robots[i]; r.group.position.set(p.x, p.y, 0); r.update(p, 1 / 60, frame / 60);
      if (frame % 4 === 0) {
        const box = bounds(r); assert.ok(box.min.y >= -.001, `frame ${frame}: ${box.min.y} below floor`);
        assert.ok(box.max.y - box.min.y > 1.9, 'vertical chassis silhouette remains intact');
        assert.ok(r.getContactShadow().height < .07, `frame ${frame}: grounded machine cannot levitate`);
      }
    });
  }
});
