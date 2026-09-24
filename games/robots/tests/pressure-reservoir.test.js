import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPressureReservoirs } from '../src/pressure-reservoir.js';

test('pressure receivers remain behind combat and inside the existing side-prop footprint', () => {
  const { group, dispose } = createPressureReservoirs();
  const bounds = new THREE.Box3().setFromObject(group);
  assert.ok(bounds.min.y >= -.005 && bounds.max.y <= 2.50, 'feet sit on the deck; inlet meets the existing pipe');
  assert.ok(bounds.min.z >= -3.02 && bounds.max.z <= -1.75, 'instruments do not project into the fight lane');
  assert.ok(bounds.min.x >= -8.39 && bounds.max.x <= 8.39);
  for (const mesh of group.children) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      assert.ok(Math.abs(position.getX(i)) > 6.70, 'all geometry belongs to a side assembly');
      assert.ok(Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i)) && Number.isFinite(position.getZ(i)));
    }
  }
  dispose();
});

test('instruments and fasteners have a bounded shared mobile budget and release resources once', () => {
  const receiver = createPressureReservoirs(), { group } = receiver;
  assert.equal(group.children.length, 7, 'seven finishes for both tanks, independent of bolt count');
  assert.equal(group.userData.receiverCount, 2);
  assert.ok(group.userData.triangles < 16000);
  const resources = new Set();
  for (const mesh of group.children) {
    assert.ok(mesh.isMesh && !Array.isArray(mesh.material));
    resources.add(mesh.geometry); resources.add(mesh.material);
    if (mesh.material.map) resources.add(mesh.material.map);
  }
  const dial = group.getObjectByName('pressure-receiver-dial');
  assert.equal(dial.geometry.attributes.position.count, 4 * 40 * 3, 'all four dials use circular faces');
  for (const uv of dial.geometry.attributes.uv.array) assert.ok(uv > 0 && uv < 1, 'inset atlas coordinates avoid edge bleeding');
  let disposed = 0; for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
  const parent = new THREE.Group(); parent.add(group); receiver.dispose(); receiver.dispose();
  assert.equal(disposed, resources.size); assert.equal(parent.children.length, 0);
});
