import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRobotMaterialResources, createRobotSurfaceAssetCache } from '../src/robot-materials.js';

function sourceMaterial() {
  const source = new THREE.MeshStandardMaterial();
  source.name = 'Automaton_Armor_PBR';
  source.map = new THREE.Texture({ width: 1024, height: 1024 });
  source.map.colorSpace = THREE.SRGBColorSpace; source.map.flipY = false;
  source.normalMap = new THREE.Texture({ width: 1024, height: 1024 });
  source.normalScale.set(.7, .7);
  source.roughnessMap = new THREE.Texture({ width: 512, height: 512 });
  source.metalnessMap = source.roughnessMap;
  return source;
}

function disposalCounter(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}

test('armour preserves authored map channels, UV convention and source images', () => {
  const source = sourceMaterial(), resources = createRobotMaterialResources(null);
  const armor = resources.cloneArmor(source, 'amber');
  assert.equal(armor.roughness, 1); assert.equal(armor.metalness, 1);
  assert.equal(armor.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(armor.roughnessMap.colorSpace, THREE.NoColorSpace);
  assert.equal(armor.map.flipY, false);
  assert.equal(armor.roughnessMap, armor.metalnessMap);
  assert.notEqual(armor.map, source.map);
  assert.equal(armor.map.source, source.map.source);
  assert.deepEqual(armor.normalScale.toArray(), [.7, .7]);
  assert.equal(armor.normalMap.image, source.normalMap.image);
  assert.equal(source.map.anisotropy, 1); assert.equal(armor.map.anisotropy, 4);
  assert.equal(source.envMap, null);
  assert.equal(armor.color.getHex(), 0xffedcf);
  armor.dispose(); resources.disposeTextures();
});

test('per-robot copies share packed channels without cloning decoded images or changing template', () => {
  const source = sourceMaterial(), resources = createRobotMaterialResources(null);
  const a = resources.cloneArmor(source), b = resources.cloneArmor(source, 'cyan');
  assert.equal(a.map, b.map); assert.equal(a.roughnessMap, b.metalnessMap);
  assert.notEqual(a.color, b.color); assert.notEqual(a.normalScale, source.normalScale);
  b.normalScale.x = .2;
  assert.equal(source.normalScale.x, .7);
  assert.equal(b.color.getHex(), 0xd3ecff);
  a.dispose(); b.dispose(); resources.disposeTextures();
});

test('optional high resolution maps replace only colour and packed material channels', () => {
  const source = sourceMaterial();
  const map = new THREE.Texture({ width: 2048, height: 2048 });
  const packed = new THREE.Texture({ width: 1024, height: 1024 });
  const resources = createRobotMaterialResources({ map, roughnessMap: packed, metalnessMap: packed });
  const armor = resources.cloneArmor(source), fragment = armor.clone();
  assert.equal(armor.map.image, map.image); assert.equal(armor.normalMap.image, source.normalMap.image);
  assert.equal(armor.roughnessMap, armor.metalnessMap);
  assert.equal(fragment.map, armor.map); assert.equal(fragment.envMap, armor.envMap);
  assert.equal(fragment.metalness, 1);
  armor.dispose(); fragment.dispose(); resources.disposeTextures();
});

test('private textures dispose once; shared GLB and optional source textures remain intact', () => {
  const source = sourceMaterial(), resources = createRobotMaterialResources(null);
  const armor = resources.cloneArmor(source);
  const sourceCounts = [source.map, source.normalMap, source.roughnessMap].map(disposalCounter);
  const copyCounts = [armor.map, armor.normalMap, armor.roughnessMap].map(disposalCounter);
  armor.dispose(); resources.disposeTextures(); resources.disposeTextures();
  assert.deepEqual(copyCounts.map(read => read()), [1, 1, 1]);
  assert.deepEqual(sourceCounts.map(read => read()), [0, 0, 0]);
  assert.throws(() => resources.cloneArmor(source), /disposed/);
});

test('robots share one bounded reflection probe until its final owner releases it', () => {
  const source = sourceMaterial();
  const a = createRobotMaterialResources(null), b = createRobotMaterialResources(null);
  const first = a.cloneArmor(source), second = b.cloneArmor(source);
  assert.equal(first.envMap, second.envMap);
  assert.equal(first.envMap.image.width, 128); assert.equal(first.envMap.image.height, 64);
  const disposed = disposalCounter(first.envMap);
  first.dispose(); a.disposeTextures(); assert.equal(disposed(), 0);
  second.dispose(); b.disposeTextures(); assert.equal(disposed(), 1);
  const next = createRobotMaterialResources(null), third = next.cloneArmor(source);
  assert.notEqual(third.envMap, first.envMap);
  third.dispose(); next.disposeTextures();
});

test('optional surface loader caches requests and configures linear packed maps', async () => {
  const fetched = [];
  const cache = createRobotSurfaceAssetCache(async url => {
    fetched.push(url); return new THREE.Texture({ width: 1, height: 1 });
  });
  const first = cache.load(), second = cache.load();
  assert.equal(first, second);
  const textures = await first;
  assert.equal(fetched.length, 2);
  assert.equal(textures.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(textures.roughnessMap.colorSpace, THREE.NoColorSpace);
  assert.equal(textures.roughnessMap, textures.metalnessMap);
  assert.equal(textures.map.flipY, false);
  const count = disposalCounter(textures.roughnessMap);
  cache.dispose(); cache.dispose(); assert.equal(count(), 1);
  assert.equal(await cache.load(), null);
});

test('partial optional-asset failure falls back and releases the image that did load', async () => {
  const loaded = new THREE.Texture(), count = disposalCounter(loaded);
  const cache = createRobotSurfaceAssetCache(async url => {
    if (url.includes('base-color')) return loaded;
    throw new Error('offline');
  });
  assert.equal(await cache.load(), null); assert.equal(count(), 1);
  cache.dispose(); assert.equal(count(), 1);
});

test('timed-out high resolution requests release late results', async () => {
  const resolvers = [], textures = [new THREE.Texture(), new THREE.Texture()];
  const counts = textures.map(disposalCounter);
  const cache = createRobotSurfaceAssetCache(() => new Promise(resolve => resolvers.push(resolve)), 5);
  assert.equal(await cache.load(), null);
  resolvers.forEach((resolve, index) => resolve(textures[index]));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(counts.map(read => read()), [1, 1]);
  assert.equal(cache.textures, null); cache.dispose();
});

test('a timed-out sibling releases an already loaded texture immediately', async () => {
  const loaded = new THREE.Texture(), count = disposalCounter(loaded);
  const cache = createRobotSurfaceAssetCache(url => url.includes('base-color') ? Promise.resolve(loaded) : new Promise(() => {}), 5);
  assert.equal(await cache.load(), null);
  assert.equal(count(), 1);
  cache.dispose(); assert.equal(count(), 1);
});

test('disposing a cache during a pending load does not publish orphaned textures', async () => {
  const resolvers = [], textures = [new THREE.Texture(), new THREE.Texture()];
  const counts = textures.map(disposalCounter);
  const cache = createRobotSurfaceAssetCache(() => new Promise(resolve => resolvers.push(resolve)));
  const pending = cache.load(); await Promise.resolve(); cache.dispose();
  resolvers.forEach((resolve, index) => resolve(textures[index]));
  assert.equal(await pending, null);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(counts.map(read => read()), [1, 1]);
  assert.equal(cache.textures, null);
});
