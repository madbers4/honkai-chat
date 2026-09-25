import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withRobotAssetFixture } from './robot-asset-fixture.js';

// The real GLB, rig and fragment builder; decoding pixel data does not require
// a GPU for these material ownership and destruction lifecycle assertions.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.ProgressEvent = class { constructor(type, properties) { Object.assign(this, properties); this.type = type; } };
const textureLoad = THREE.TextureLoader.prototype.loadAsync;
const highResolutionSources = [];
THREE.TextureLoader.prototype.loadAsync = async function (url) {
  const size = url.includes('base-color') ? 2048 : 1024;
  const texture = new THREE.Texture({ width: size, height: size });
  highResolutionSources.push(texture); return texture;
};
const { loadRobotAssets, createRobot } = await import('../src/robot.js');
let template;
try { template = await withRobotAssetFixture(loadRobotAssets); }
finally { THREE.TextureLoader.prototype.loadAsync = textureLoad; }

const counter = resource => {
  let count = 0; resource.addEventListener('dispose', () => count++); return () => count;
};
const armorOf = robot => {
  let material;
  robot.group.traverse(mesh => { if (mesh.isSkinnedMesh && mesh.material.name === 'Automaton_Armor_PBR') material = mesh.material; });
  return material;
};

test('real destruction retains upgraded original UV materials and disposes them without harming the second robot', () => {
  let source;
  template.traverse(mesh => { if (mesh.isMesh && mesh.material.name === 'Automaton_Armor_PBR') source = mesh.material; });
  const sharedCounts = [source, source.map, source.normalMap, source.roughnessMap, ...highResolutionSources].map(counter);
  const first = createRobot(), second = createRobot({ skin: 'cyan' });
  const armor = armorOf(first), survivor = armorOf(second);
  const probeCount = counter(armor.envMap);
  assert.equal(armor.envMap, survivor.envMap);
  assert.notEqual(armor.map, survivor.map);
  assert.equal(armor.map.source, survivor.map.source);
  assert.equal(armor.map.image.width, 2048);
  for (let frame = 0; frame <= 129; frame++) first.update({ action: 'defeated', variant: 'overload', actionTime: frame / 60, actionDuration: 3.7, hp: 0, facing: 1 }, 1 / 60, frame / 60);
  first.update({ action: 'destroyed', variant: 'overload', destructionTime: 1.4, hp: 0, facing: 1 }, 1 / 60, 3.55);
  const fragments = [];
  first.group.traverse(mesh => { if (mesh.userData.originalRobotFragment && mesh.material.name === 'Automaton_Armor_PBR') fragments.push(mesh); });
  assert.ok(fragments.length >= 18, 'the actual original mechanical pieces must be visible');
  const fragmentMaterials = new Set(fragments.map(mesh => mesh.material));
  for (const material of fragmentMaterials) {
    assert.notEqual(material, armor);
    assert.equal(material.map, armor.map); assert.equal(material.normalMap, armor.normalMap);
    assert.equal(material.roughnessMap, armor.roughnessMap); assert.equal(material.metalnessMap, armor.metalnessMap);
    assert.equal(material.envMap, armor.envMap); assert.equal(material.metalness, armor.metalness);
  }
  for (const fragment of fragments) assert.ok(fragment.geometry.attributes.uv.count > 0);
  const privateCounts = [armor, armor.map, armor.normalMap, armor.roughnessMap, ...fragmentMaterials].map(counter);
  first.dispose(); first.dispose();
  assert.ok(privateCounts.every(read => read() === 1));
  assert.equal(probeCount(), 0);
  assert.ok(sharedCounts.every(read => read() === 0));
  second.update({ action: 'light', variant: 'jab', actionTime: .12, actionDuration: .34, hp: 55, facing: -1 }, 1 / 60, 4);
  assert.equal(armorOf(second).map.image.width, 2048);
  second.dispose(); assert.equal(probeCount(), 1);
  assert.ok(sharedCounts.every(read => read() === 0));
});
