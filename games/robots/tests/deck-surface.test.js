import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { applyDeckUV, createDeckSurface, rasterizeDeckSurface, DECK_SURFACE } from '../src/deck-surface.js';

test('a metre has identical UV scale on a real panel and the continuous backing floor', () => {
  const panel = new RoundedBoxGeometry(2.275, .1, 1.035, 2, .023);
  panel.translate(DECK_SURFACE.firstCenterX, -.057, .53);
  const floor = new THREE.PlaneGeometry(72, 42).rotateX(-Math.PI / 2).translate(0, -.12, 1.5);
  for (const geometry of [panel, floor]) {
    applyDeckUV(geometry);
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      assert.ok(Math.abs((uv.getX(i) - .5) * DECK_SURFACE.width - position.getX(i)) < .000005);
      assert.ok(Math.abs((uv.getY(i) - .5) * DECK_SURFACE.depth - position.getZ(i)) < .000005);
    }
    geometry.dispose();
  }
});

test('surface stays matte, wear exposes metal locally, and normal/low budgets are bounded', () => {
  for (const [request, expected] of [[1, 512], [512, 512], [1024, 1024], [8192, 1024]]) {
    const raster = rasterizeDeckSurface(request);
    assert.equal(raster.width, expected); assert.equal(raster.height, expected / 2);
    assert.ok(raster.albedo.byteLength + raster.properties.byteLength <= 4 * 1024 * 1024);
    let minRough = 255, maxRough = 0, minMetal = 255, maxMetal = 0, dry = 0;
    for (let i = 0; i < raster.properties.length; i += 4) {
      const rough = raster.properties[i + 1], metal = raster.properties[i + 2];
      minRough = Math.min(minRough, rough); maxRough = Math.max(maxRough, rough);
      minMetal = Math.min(minMetal, metal); maxMetal = Math.max(maxMetal, metal);
      if (rough >= 185 && metal <= 45) dry++;
      assert.equal(raster.properties[i + 3], 255);
    }
    assert.ok(minRough > 145 && maxRough >= 205, 'even bare wear avoids mirror polish');
    assert.ok(minMetal < 40 && maxMetal > 135, 'paint and exposed steel are not one uniform metal');
    assert.ok(dry / (raster.width * raster.height) > .82, 'most floor remains quiet, dry paint');
  }
});

test('deck maps share one physical scale and two GPU allocations, with exact disposal', () => {
  const deck = createDeckSurface({ resolution: 512 });
  assert.equal(deck.textures.length, 2);
  assert.equal(deck.material.bumpMap, deck.material.roughnessMap);
  assert.equal(deck.material.roughnessMap, deck.material.metalnessMap);
  assert.ok(deck.material.bumpScale <= .002, 'relief cannot fake a hole under a robot foot');
  assert.equal(deck.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(deck.material.roughnessMap.colorSpace, THREE.NoColorSpace);
  for (const map of deck.textures) {
    assert.deepEqual(map.repeat.toArray(), [1, 1]);
    assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(map.generateMipmaps, true);
  }
  let disposed = 0;
  for (const resource of [deck.material, ...deck.textures]) resource.addEventListener('dispose', () => disposed++);
  deck.dispose(); deck.dispose();
  assert.equal(disposed, 3);
});
