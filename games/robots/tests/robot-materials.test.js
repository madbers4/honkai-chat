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
  assert.equal(armor.map.image, source.map.image);
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

test('a fast boot fallback keeps one bounded opportunity for late HD completion', async t => {
  const resolvers = [], textures = [new THREE.Texture(), new THREE.Texture()];
  const counts = textures.map(disposalCounter);
  const cache = createRobotSurfaceAssetCache(() => new Promise(resolve => resolvers.push(resolve)), 5, 1000);
  t.after(() => cache.dispose());
  let published = 0; cache.subscribe(() => published++);
  assert.equal(await cache.load(), null);
  resolvers.forEach((resolve, index) => resolve(textures[index]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(counts.map(read => read()), [0, 0]);
  assert.equal(cache.textures.map, textures[0]); assert.equal(published, 1);
  assert.equal(await cache.load(), cache.textures, 'subsequent loads see the completed HD set');
  cache.dispose(); assert.deepEqual(counts.map(read => read()), [1, 1]);
});

test('a nonsettling sibling is cancelled at the final deadline and partial images are released', async t => {
  const loaded = new THREE.Texture(), count = disposalCounter(loaded);
  let aborted; const deadline = new Promise(resolve => { aborted = resolve; });
  let calls = 0, published = 0;
  const cache = createRobotSurfaceAssetCache((url, { signal }) => {
    calls++;
    if (url.includes('base-color')) return Promise.resolve(loaded);
    signal.addEventListener('abort', aborted, { once: true });
    return new Promise(() => {});
  }, 5, 35);
  t.after(() => cache.dispose());cache.subscribe(() => published++);
  assert.equal(await cache.load(), null);assert.equal(count(), 0, 'boot fallback does not prematurely discard a loaded HD image');
  await deadline;
  assert.equal(count(), 1);assert.equal(published, 0);assert.equal(await cache.load(), null);assert.equal(calls, 2, 'deadline cannot trigger retry loops');
  cache.dispose();assert.equal(count(), 1);
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


const nextMicrotasks = () => new Promise(resolve => setImmediate(resolve));
function delayedCache(t, deadlineMs = 1000) {
  const resolve = [], signals = [], images = [new THREE.Texture({ width: 2048, height: 2048 }), new THREE.Texture({ width: 1024, height: 1024 })];
  const cache = createRobotSurfaceAssetCache((_url, { signal }) => {
    signals.push(signal);return new Promise(done => resolve.push(done));
  }, 5, deadlineMs);
  t.after(() => cache.dispose());
  return { cache, images, resolve, signals, finish: async () => { resolve.forEach((done,i) => done(images[i]));await nextMicrotasks(); } };
}

test('late HD upgrades live armor and its material clones in place without changing the GLB or customization', async t => {
  const delayed = delayedCache(t);assert.equal(await delayed.cache.load(), null);
  const source = sourceMaterial(), originalSource = source.map.source, originalImage = source.map.image;
  source.map.offset.set(.13,.27);source.map.repeat.set(.75,.5);source.map.rotation=.2;source.map.channel=1;source.map.updateMatrix();
  const resources = createRobotMaterialResources(undefined, {cache:delayed.cache});t.after(() => resources.disposeTextures());
  const armor = resources.cloneArmor(source), fragment = armor.clone();
  const initialMap = armor.map, initialPacked = armor.roughnessMap, initialNormal = armor.normalMap;
  const initialVersion = initialMap.version, retiredSource = initialMap.source;
  armor.color.set('#29ba5f');fragment.color.set('#bf647b');fragment.opacity=.4;
  const disposeObservations=[];initialMap.addEventListener('dispose',()=>disposeObservations.push(initialMap.source));
  await delayed.finish();
  assert.equal(armor.map, initialMap);assert.equal(fragment.map, initialMap);
  assert.equal(armor.roughnessMap, initialPacked);assert.equal(fragment.metalnessMap, initialPacked);
  assert.equal(armor.map.image, delayed.images[0].image);assert.equal(initialPacked.image, delayed.images[1].image);
  assert.notEqual(armor.map.source, retiredSource);assert.notEqual(armor.map.source, delayed.images[0].source);
  assert.deepEqual(disposeObservations,[retiredSource],'old GPU allocation is retired before its Source changes');
  assert.ok(initialMap.version>initialVersion);assert.equal(initialMap.anisotropy,4);
  assert.deepEqual(initialMap.offset.toArray(),[.13,.27]);assert.deepEqual(initialMap.repeat.toArray(),[.75,.5]);
  assert.equal(initialMap.rotation,.2);assert.equal(initialMap.channel,1);assert.deepEqual(initialMap.matrix.toArray(),source.map.matrix.toArray());
  assert.equal(armor.normalMap,initialNormal);assert.equal(initialNormal.image,source.normalMap.image);assert.deepEqual(armor.normalScale.toArray(),[.7,.7]);
  assert.equal(source.map.source,originalSource);assert.equal(source.map.image,originalImage);assert.equal(source.map.image.width,1024);
  assert.equal(armor.color.getHex(),0x29ba5f);assert.equal(fragment.color.getHex(),0xbf647b);assert.equal(fragment.opacity,.4);
  const later = resources.cloneArmor(source,'cyan');
  assert.equal(later.map, initialMap);assert.equal(later.roughnessMap, initialPacked);assert.equal(later.metalnessMap,initialPacked);
  armor.dispose();fragment.dispose();later.dispose();
});

test('multiple live robots upgrade independently, and a new resource owner starts directly in HD', async t => {
  const delayed=delayedCache(t);await delayed.cache.load();const source=sourceMaterial();
  const owners=Array.from({length:2},()=>createRobotMaterialResources(undefined,{cache:delayed.cache}));
  const robots=owners.map((owner,i)=>owner.cloneArmor(source,i?'cyan':'amber'));
  t.after(()=>owners.forEach(owner=>owner.disposeTextures()));
  assert.notEqual(robots[0].map,robots[1].map);
  await delayed.finish();
  assert.equal(robots[0].map.image,delayed.images[0].image);assert.equal(robots[1].map.image,delayed.images[0].image);
  assert.notEqual(robots[0].map.source,robots[1].map.source);
  assert.equal(robots[0].color.getHex(),0xffedcf);assert.equal(robots[1].color.getHex(),0xd3ecff);
  const next=createRobotMaterialResources(undefined,{cache:delayed.cache});owners.push(next);
  const fresh=next.cloneArmor(source);assert.equal(fresh.map.image,delayed.images[0].image);assert.equal(fresh.roughnessMap,fresh.metalnessMap);
  robots.forEach(robot=>robot.dispose());fresh.dispose();
});

test('disposed resource owners unsubscribe and cannot be revived by late images', async t => {
  const delayed=delayedCache(t);await delayed.cache.load();const source=sourceMaterial();
  const resources=createRobotMaterialResources(undefined,{cache:delayed.cache});
  const armor=resources.cloneArmor(source), fallbackImage=armor.map.image, fallbackVersion=armor.map.version;
  const mapDisposals=disposalCounter(armor.map);armor.dispose();resources.disposeTextures();
  assert.equal(mapDisposals(),1);await delayed.finish();
  assert.equal(armor.map.image,fallbackImage);assert.equal(armor.map.version,fallbackVersion);assert.equal(mapDisposals(),1);
  assert.throws(()=>resources.cloneArmor(source),/disposed/);
});

test('upgraded aliases dispose each private texture once at final owner cleanup', async t => {
  const delayed=delayedCache(t);await delayed.cache.load();
  const source=sourceMaterial(),resources=createRobotMaterialResources(undefined,{cache:delayed.cache});
  const armor=resources.cloneArmor(source), fragment=armor.clone();
  const originalCounts=[source.map,source.normalMap,source.roughnessMap,...delayed.images].map(disposalCounter);
  const counts=[armor.map,armor.normalMap,armor.roughnessMap].map(disposalCounter);
  await delayed.finish();assert.deepEqual(counts.map(read=>read()),[1,0,1],'one GPU retirement for each resized map');
  armor.dispose();fragment.dispose();resources.disposeTextures();resources.disposeTextures();
  assert.deepEqual(counts.map(read=>read()),[2,1,2],'upgraded alias keys do not double-dispose final textures');
  assert.deepEqual(originalCounts.map(read=>read()),[0,0,0,0,0]);
});

test('final deadline disposes late results and never notifies unsubscribed or terminal listeners', async t => {
  const delayed=delayedCache(t,30);let calls=0;
  const unsubscribe=delayed.cache.subscribe(()=>calls++);unsubscribe();
  delayed.cache.subscribe(()=>calls++);await delayed.cache.load();
  await new Promise(resolve=>delayed.signals[0].addEventListener('abort',resolve,{once:true}));
  const counts=delayed.images.map(disposalCounter);await delayed.finish();
  assert.deepEqual(counts.map(read=>read()),[1,1]);assert.equal(delayed.cache.textures,null);assert.equal(calls,0);
  delayed.cache.subscribe(()=>calls++);assert.equal(calls,0);
});

test('disposing during publication prevents all further cache events', async t => {
  const delayed=delayedCache(t);let first=0,second=0;
  delayed.cache.subscribe(()=>{first++;delayed.cache.dispose();});delayed.cache.subscribe(()=>second++);
  await delayed.cache.load();await delayed.finish();
  assert.equal(first,1);assert.equal(second,0);assert.equal(delayed.cache.textures,null);
  delayed.cache.subscribe(()=>second++);assert.equal(second,0);
});
